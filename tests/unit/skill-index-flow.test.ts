import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import vscode from 'vscode';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../src/consts';
import type { SkillIndexSettings } from '../../src/config';
import { processSkillIndex, renderSkillIndexStub } from '../../src/provider/skills';
import { SKILL_INDEX_NOTICE_START } from '../../src/provider/tools/consts';

type Message = vscode.LanguageModelChatRequestMessage;

const SYSTEM_ROLE = LANGUAGE_MODEL_CHAT_SYSTEM_ROLE as vscode.LanguageModelChatMessageRole;

function skill(name: string, description: string): string {
	return `<skill>\n<name>${name}</name>\n<description>${description}</description>\n<file>c:\\Users\\user\\.agents\\skills\\${name}\\SKILL.md</file>\n</skill>`;
}

const SKILLS = [
	skill('database-migration', 'Plan zero-downtime database migrations and rollbacks.'),
	skill('api-design-reviewer', 'Review REST API design for breaking changes.'),
	skill('frontend-design', 'Guidance for distinctive UI visual design.'),
	skill('数据库迁移助手', '为数据库迁移生成迁移脚本与回滚方案。'),
];
const SKILLS_BLOCK = ['<skills>', 'Here is a list of skills.', ...SKILLS, '</skills>'].join('\n');
const SYSTEM_PREFIX = '<instructions>\nYou are an expert.\n</instructions>\n\n<instructions>\n';
const SYSTEM_SUFFIX =
	'\n</instructions>\n\n<agents>\n<agent>\n<name>Upgrade</name>\n</agent>\n</agents>';
const SYSTEM_TEXT = SYSTEM_PREFIX + SKILLS_BLOCK + SYSTEM_SUFFIX;

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}
function system(value: string): Message {
	return { role: SYSTEM_ROLE, name: undefined, content: [text(value)] };
}
function user(...parts: Message['content'][number][]): Message {
	return { role: vscode.LanguageModelChatMessageRole.User, name: undefined, content: parts };
}
function assistant(value: string): Message {
	return {
		role: vscode.LanguageModelChatMessageRole.Assistant,
		name: undefined,
		content: [text(value)],
	};
}
function request(prompt: string): Message {
	return user(
		text(
			`<context>\nThe current date is 2026-09-09.\n</context>\n<reminderInstructions>\nx\n</reminderInstructions>\n<userRequest>\n${prompt}\n</userRequest>\n`,
		),
	);
}
function toolResult(): Message {
	return user(new vscode.LanguageModelToolResultPart('call-1', [text('ok')]));
}
function textOf(message: Message): string {
	return message.content
		.filter((part): part is vscode.LanguageModelTextPart =>
			part instanceof vscode.LanguageModelTextPart
		)
		.map((part) => part.value)
		.join('');
}

const ENV = user(text('<environment_info>\nwin32\n</environment_info>'));
const SETTINGS: SkillIndexSettings = { mode: 'auto', threshold: 2, maxRelevant: 12 };

function conversation(): Message[] {
	return [
		system(SYSTEM_TEXT),
		ENV,
		request('Plan the database migration for this service'),
		assistant('Sure.'),
		toolResult(),
		request('继续'),
	];
}

beforeEach(() => {
	__vscodeMock.reset();
});

test('mode off returns the same messages reference', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: { ...SETTINGS, mode: 'off' },
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'off');
	assert.equal(result.initialResponseNotice, undefined);
});

test('non main-agent requests are left alone', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'background',
		settings: SETTINGS,
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'not-applicable');
});

test('no skills block means absent', () => {
	const messages = [system('<instructions>\nplain\n</instructions>'), request('hi')];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'absent');
});

test('at or below the threshold the prompt passes through untouched', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: { ...SETTINGS, threshold: 4 },
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'passthrough');
	assert.equal(result.stats.totalCount, 4);
});

test('above the threshold the system prompt keeps only the stub and requests get relevant skills', () => {
	const messages = conversation();
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.notEqual(result.messages, messages);
	assert.equal(result.stats.action, 'trimmed');
	assert.equal(result.stats.totalCount, 4);
	assert.equal(result.stats.requestMessages, 2);
	assert.deepEqual(result.stats.injectedCounts, [1, 1]);
	assert.equal(result.stats.systemCharsBefore, SYSTEM_TEXT.length);

	const systemText = textOf(result.messages[0]);
	assert.equal(systemText, SYSTEM_PREFIX + renderSkillIndexStub(4) + SYSTEM_SUFFIX);
	assert.ok(!systemText.includes('<name>api-design-reviewer</name>'));
	assert.equal(result.stats.systemCharsAfter, systemText.length);

	// Untouched messages keep their identity.
	assert.equal(result.messages[1], messages[1]);
	assert.equal(result.messages[3], messages[3]);
	assert.equal(result.messages[4], messages[4]);

	// Request messages get exactly one appended text part.
	const first = result.messages[2];
	assert.equal(first.content.length, messages[2].content.length + 1);
	const appended = first.content[first.content.length - 1];
	assert.ok(appended instanceof vscode.LanguageModelTextPart);
	assert.ok(appended.value.startsWith('\n<relevant_skills>\n<skill>'));
	assert.ok(appended.value.includes('<name>database-migration</name>'));
	assert.ok(!appended.value.includes('<name>frontend-design</name>'));

	// "继续" has no topic words of its own and inherits the previous request.
	const second = result.messages[5];
	assert.equal(second.content.length, messages[5].content.length + 1);
	assert.ok(textOf(second).includes('<name>database-migration</name>'));
});

test('re-running on the next turn reproduces the earlier turn byte for byte', () => {
	const turnOne = conversation().slice(0, 4);
	const turnTwo = conversation();
	const one = processSkillIndex({
		messages: turnOne,
		rawMessages: turnOne,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	const two = processSkillIndex({
		messages: turnTwo,
		rawMessages: turnTwo,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(one.stats.action, 'trimmed');
	assert.equal(two.stats.action, 'trimmed');
	for (let index = 0; index < one.messages.length; index += 1) {
		assert.equal(textOf(two.messages[index]), textOf(one.messages[index]), `message #${index}`);
	}
});

test('the notice is returned once and suppressed when history already carries it', () => {
	const messages = conversation();
	const fresh = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.ok(fresh.initialResponseNotice);
	assert.ok(fresh.initialResponseNotice.includes(SKILL_INDEX_NOTICE_START));

	const raw = [...messages];
	raw[3] = assistant(
		`\n${SKILL_INDEX_NOTICE_START}\n\n> shown before\n\n[anthropic-copilot-skill-index-notice-end]: #\n\nSure.`,
	);
	const repeat = processSkillIndex({
		messages,
		rawMessages: raw,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(repeat.initialResponseNotice, undefined);
	assert.equal(repeat.stats.action, 'trimmed');
});

test('without <userRequest> only the last text-bearing user message is used, with its full text', () => {
	const messages = [
		system(SYSTEM_TEXT),
		user(text('Review the REST API design')),
		assistant('ok'),
		user(text('now the database migration plan')),
		toolResult(),
	];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.stats.action, 'trimmed');
	assert.equal(result.stats.requestMessages, 1);
	assert.equal(result.messages[1], messages[1]);
	assert.ok(textOf(result.messages[3]).includes('<name>database-migration</name>'));
	assert.equal(result.messages[4], messages[4]);
});

test('a request with no matching skill gets no appended block', () => {
	const messages = [system(SYSTEM_TEXT), request('cobol mainframe accounting')];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.stats.action, 'trimmed');
	assert.deepEqual(result.stats.injectedCounts, [0]);
	assert.equal(result.messages[1], messages[1]);
});

test('an internal failure forwards the messages unchanged instead of throwing', () => {
	const broken = { role: SYSTEM_ROLE, name: undefined, content: null } as unknown as Message;
	const messages = [broken, request('hi')];
	const result = processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
	assert.equal(result.messages, messages);
	assert.equal(result.stats.action, 'error');
});
