import assert from 'node:assert/strict';
import test from 'node:test';
import vscode from 'vscode';
import { convertMessages } from '../../src/provider/convert';
import type { AnthropicContentBlock, AnthropicMessage } from '../../src/types';

// Anthropic rejects the whole request with HTTP 400
// `messages: text content blocks must be non-empty` when any text block in
// `messages` has an empty string. Copilot Agent mode replays each historical
// assistant tool-calling turn as an empty LanguageModelTextPart followed by the
// tool call, so the count of empty blocks grows with every tool round until a
// relay or the API rejects the turn. See tests/unit/convert-empty-text.test.ts.

type Message = vscode.LanguageModelChatRequestMessage;

function userText(value: string): Message {
	return {
		role: vscode.LanguageModelChatMessageRole.User,
		content: [new vscode.LanguageModelTextPart(value)],
		name: undefined,
	} as unknown as Message;
}

function assistantToolTurn(text: string, callId: string, name: string): Message {
	return {
		role: vscode.LanguageModelChatMessageRole.Assistant,
		content: [
			new vscode.LanguageModelTextPart(text),
			new vscode.LanguageModelToolCallPart(callId, name, {}),
		],
		name: undefined,
	} as unknown as Message;
}

function toolResult(callId: string, value: string): Message {
	return {
		role: vscode.LanguageModelChatMessageRole.User,
		content: [
			new vscode.LanguageModelToolResultPart(callId, [
				new vscode.LanguageModelTextPart(value),
			]),
		],
		name: undefined,
	} as unknown as Message;
}

function blocksOf(message: AnthropicMessage): AnthropicContentBlock[] {
	assert.ok(Array.isArray(message.content), 'expected structured content blocks');
	return message.content;
}

function emptyTextBlocks(messages: AnthropicMessage[]): AnthropicContentBlock[] {
	return messages.flatMap((message) =>
		(Array.isArray(message.content) ? message.content : []).filter(
			(block) => block.type === 'text' && block.text.length === 0,
		),
	);
}

test('drops the empty text part Copilot replays before a historical tool call', () => {
	const { messages } = convertMessages(
		[
			userText('build the thing'),
			assistantToolTurn('', 'toolu_1', 'run_in_terminal'),
			toolResult('toolu_1', 'ok'),
		],
		false,
		false,
	);

	assert.deepEqual(emptyTextBlocks(messages), []);

	const assistant = messages.find((message) => message.role === 'assistant');
	assert.ok(assistant, 'the assistant tool call must survive');
	assert.deepEqual(
		blocksOf(assistant).map((block) => block.type),
		['tool_use'],
	);
});

test('no empty text block survives a multi-round agent conversation', () => {
	const rounds = 4;
	const history: Message[] = [userText('build the thing')];
	for (let round = 1; round <= rounds; round += 1) {
		history.push(assistantToolTurn('', `toolu_${round}`, 'run_in_terminal'));
		history.push(toolResult(`toolu_${round}`, `result ${round}`));
	}

	const { messages } = convertMessages(history, false, false);

	assert.deepEqual(emptyTextBlocks(messages), []);
	assert.equal(
		messages.filter((message) => message.role === 'assistant').length,
		rounds,
		'every tool-calling turn must still be present',
	);
});

test('keeps assistant text that is not empty', () => {
	const { messages } = convertMessages(
		[userText('hi'), assistantToolTurn('running the build', 'toolu_1', 'run_in_terminal')],
		false,
		false,
	);

	const assistant = messages.find((message) => message.role === 'assistant');
	assert.ok(assistant);
	assert.deepEqual(blocksOf(assistant), [
		{ type: 'text', text: 'running the build' },
		{ type: 'tool_use', id: 'toolu_1', name: 'run_in_terminal', input: {} },
	]);
});

test('an assistant turn whose only text is empty is dropped entirely', () => {
	const { messages } = convertMessages(
		[
			userText('hi'),
			{
				role: vscode.LanguageModelChatMessageRole.Assistant,
				content: [new vscode.LanguageModelTextPart('')],
				name: undefined,
			} as unknown as Message,
		],
		false,
		false,
	);

	assert.deepEqual(
		messages.map((message) => message.role),
		['user'],
	);
});

test('drops an empty user text part instead of sending an empty block', () => {
	const { messages } = convertMessages(
		[userText(''), userText('real question')],
		false,
		false,
	);

	assert.deepEqual(emptyTextBlocks(messages), []);
	assert.equal(messages.length, 1);
	assert.deepEqual(blocksOf(messages[0]), [{ type: 'text', text: 'real question' }]);
});
