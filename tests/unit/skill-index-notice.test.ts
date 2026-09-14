import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import vscode from 'vscode';
import {
	SKILL_INDEX_NOTICE_END,
	SKILL_INDEX_NOTICE_START,
} from '../../src/provider/tools/consts';
import {
	createSkillIndexNotice,
	filterProviderNotices,
} from '../../src/provider/tools/notices';

beforeEach(() => {
	__vscodeMock.reset();
});

test('notice is wrapped in its markers and carries both numbers', () => {
	const notice = createSkillIndexNotice(1551, 12);
	assert.ok(notice.includes(SKILL_INDEX_NOTICE_START));
	assert.ok(notice.includes(SKILL_INDEX_NOTICE_END));
	assert.ok(notice.includes('1551'));
	assert.ok(notice.includes('12'));
	assert.ok(notice.includes('docs/notices/skill-index.en.md'));
	assert.ok(notice.split('\n').some((line) => line.startsWith('> ')));
});

test('notice is localized to Simplified Chinese', () => {
	__vscodeMock.language = 'zh-cn';
	const notice = createSkillIndexNotice(43, 12);
	assert.ok(notice.includes('43'));
	assert.ok(notice.includes('docs/notices/skill-index.zh.md'));
});

test('filterProviderNotices strips the notice from assistant history', () => {
	const notice = createSkillIndexNotice(1551, 12);
	const assistant: vscode.LanguageModelChatRequestMessage = {
		role: vscode.LanguageModelChatMessageRole.Assistant,
		name: undefined,
		content: [new vscode.LanguageModelTextPart(notice + 'Here is the answer.')],
	};
	const user: vscode.LanguageModelChatRequestMessage = {
		role: vscode.LanguageModelChatMessageRole.User,
		name: undefined,
		content: [new vscode.LanguageModelTextPart('<userRequest>hi</userRequest>')],
	};
	const filtered = filterProviderNotices([user, assistant]);
	assert.equal(filtered.length, 2);
	assert.equal(filtered[0], user);
	const part = filtered[1].content[0];
	assert.ok(part instanceof vscode.LanguageModelTextPart);
	assert.equal(part.value, 'Here is the answer.');
});
