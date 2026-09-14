import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import vscode from 'vscode';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../src/consts';
import type { SkillIndexSettings } from '../../src/config';
import type { SkillIndexFlowResult } from '../../src/provider/skills';
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
/** Part-by-part description, so a change in part order or count is caught too. */
function describeParts(message: Message): string[] {
	return message.content.map((part) => {
		if (part instanceof vscode.LanguageModelTextPart) {
			return `text:${part.value}`;
		}
		if (part instanceof vscode.LanguageModelToolResultPart) {
			return `toolResult:${part.callId}`;
		}
		return `other:${JSON.stringify(part)}`;
	});
}
/** Every message of the earlier turn must reproduce byte for byte in the later turn. */
function assertReproducesEarlierTurn(later: SkillIndexFlowResult, earlier: SkillIndexFlowResult) {
	assert.equal(earlier.stats.action, 'trimmed');
	assert.equal(later.stats.action, 'trimmed');
	assert.ok(later.messages.length > earlier.messages.length, 'the later turn must have grown');
	for (const [index, message] of earlier.messages.entries()) {
		assert.deepEqual(
			describeParts(later.messages[index]),
			describeParts(message),
			`message #${index}`,
		);
	}
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

/** Three `<userRequest>` messages, so at least one has a real earlier query as its `previous`. */
function deepConversation(): Message[] {
	return [
		...conversation(),
		assistant('Done.'),
		request('Now review the REST API design for breaking changes'),
	];
}

/** A surface that ships the index without wrapping prompts in `<userRequest>`. */
function fallbackConversation(): Message[] {
	return [
		system(SYSTEM_TEXT),
		user(text('Review the REST API design')),
		assistant('ok'),
		user(text('now the database migration plan')),
		toolResult(),
	];
}

function run(messages: Message[]): SkillIndexFlowResult {
	return processSkillIndex({
		messages,
		rawMessages: messages,
		requestKind: 'main-agent',
		settings: SETTINGS,
	});
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
	const one = run(deepConversation());
	const two = run([
		...deepConversation(),
		assistant('Reviewed.'),
		request('Guidance for distinctive UI visual design of the dashboard'),
	]);

	assert.equal(one.stats.requestMessages, 3);
	assert.equal(two.stats.requestMessages, 4);
	// The second request ("继续") only matches through its `previous`, so a regression
	// in the previousQuery chain changes its bytes between the two turns.
	assert.ok(one.stats.injectedCounts?.[1]);
	assertReproducesEarlierTurn(two, one);
});

test('the no-<userRequest> fallback is stable across turns too', () => {
	const one = run(fallbackConversation());
	const two = run([
		...fallbackConversation(),
		assistant('done'),
		user(text('and the frontend visual design')),
	]);

	assertReproducesEarlierTurn(two, one);
	assert.equal(one.stats.requestMessages, 2);
	assert.equal(two.stats.requestMessages, 3);
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

test('without <userRequest> every text-bearing user message is a request, scored on its own text', () => {
	const messages = fallbackConversation();
	const result = run(messages);

	assert.equal(result.stats.action, 'trimmed');
	assert.equal(result.stats.requestMessages, 2);
	assert.equal(result.stats.injectedCounts?.length, 2);
	assert.ok(result.stats.injectedCounts?.every((count) => count > 0));

	// Each request message carries its own block, reflecting its own text rather
	// than the last message's.
	const first = result.messages[1];
	assert.equal(first.content.length, messages[1].content.length + 1);
	assert.ok(textOf(first).includes('<name>api-design-reviewer</name>'));
	assert.ok(!textOf(first).includes('<name>database-migration</name>'));

	const second = result.messages[3];
	assert.equal(second.content.length, messages[3].content.length + 1);
	assert.ok(textOf(second).includes('<name>database-migration</name>'));

	// The tool-result message has no text parts and is forwarded by reference.
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
