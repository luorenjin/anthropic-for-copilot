import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicClient } from '../src/client';
import type { AnthropicRequest, StreamCallbacks } from '../src/types';

test('AnthropicClient proxy request - sends hello and verifies HTTP 200 stream response', async (t) => {
	const baseUrl = process.env.ANTHROPIC_BASE_URL || 'http://claude.app.zkcrm.vip';
	
	// Strict 2-choose-1 (互斥二选一): ANTHROPIC_AUTH_TOKEN takes precedence; ignore ANTHROPIC_API_KEY if ANTHROPIC_AUTH_TOKEN is present
	let tokenSource = 'none';
	let apiKey = '';

	const authToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.CLAUDE_AUTH_TOKEN;
	const apiKeyVal = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

	if (authToken?.trim()) {
		tokenSource = 'ANTHROPIC_AUTH_TOKEN (exclusive)';
		apiKey = authToken.trim();
	} else if (apiKeyVal?.trim()) {
		tokenSource = 'ANTHROPIC_API_KEY (exclusive)';
		apiKey = apiKeyVal.trim();
	}

	const model = process.env.ANTHROPIC_TEST_MODEL || 'claude-sonnet-5';

	console.log(`\n=== Running CC-Switch Proxy Integration Test (Mutually Exclusive Token Mode) ===`);
	console.log(`Base URL:     ${baseUrl}`);
	console.log(`Model:        ${model}`);
	console.log(`Token Source: ${tokenSource}`);
	console.log(`Auth Token:   ${apiKey ? apiKey.slice(0, 8) + '***' : 'NONE'}\n`);

	if (!apiKey) {
		assert.fail(
			'No Auth Token provided! Set ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY environment variable before running test.',
		);
	}

	const client = new AnthropicClient(baseUrl, apiKey);

	const request: AnthropicRequest = {
		model,
		max_tokens: 1024,
		stream: true,
		messages: [
			{
				role: 'user',
				content: '你好',
			},
		],
	};

	let receivedContent = '';
	let receivedThinking = '';
	let completed = false;
	let errorOccurred: Error | undefined = undefined;

	console.log('Sending message: "你好" ...\n--- Proxy Response Start ---');

	const callbacks: StreamCallbacks = {
		onContent: (text: string) => {
			receivedContent += text;
			process.stdout.write(text);
		},
		onThinking: (thinking: string) => {
			receivedThinking += thinking;
		},
		onToolCall: (toolCall) => {
			console.log('\n[Tool Call]:', toolCall.function.name, toolCall.function.arguments);
		},
		onDone: () => {
			completed = true;
			console.log('\n--- Proxy Response End ---');
		},
		onError: (err: Error) => {
			errorOccurred = err;
			console.error('\n--- Proxy Response Error ---', err.message);
		},
		onUsage: (usage) => {
			console.log('\n[Usage Stats]:', usage);
		},
	};

	try {
		await client.streamChatCompletion(request, callbacks);
	} catch (err: any) {
		errorOccurred = err;
	}

	if (errorOccurred) {
		assert.fail(`Proxy request failed with HTTP error: ${errorOccurred.message}`);
	}

	assert.strictEqual(completed, true, 'Stream request must complete with HTTP 200 (onDone called)');
	assert.ok(
		receivedContent.length > 0 || receivedThinking.length > 0,
		`Expected non-empty response content from proxy, but received 0 chars.`,
	);

	console.log(`\n✅ TEST SUCCESS: Received ${receivedContent.length} chars of AI response from proxy!\n`);
});
