import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicClient } from '../../src/client';
import type { AnthropicRequest, StreamCallbacks } from '../../src/types';

// The test process inherits ANTHROPIC_* variables from whatever shell launched
// it; clear them so the assertions describe the extension's own resolution.
for (const name of [
	'ANTHROPIC_API_KEY',
	'ANTHROPIC_AUTH_TOKEN',
	'ANTHROPIC_CUSTOM_HEADERS',
	'CLAUDE_API_KEY',
	'CLAUDE_AUTH_TOKEN',
]) {
	delete process.env[name];
}

const SSE = [
	'event: message_start',
	'data: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"m","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}',
	'',
	'event: content_block_start',
	'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
	'',
	'event: content_block_delta',
	'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
	'',
	'event: content_block_stop',
	'data: {"type":"content_block_stop","index":0}',
	'',
	'event: message_delta',
	'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
	'',
	'event: message_stop',
	'data: {"type":"message_stop"}',
	'',
	'',
].join('\n');

interface Captured {
	url: string;
	headers: Record<string, string>;
}

// The SDK resolves its fetch implementation in the constructor, so the stub
// has to be installed before the client is built.
async function capture(
	build: () => AnthropicClient,
	request: Partial<AnthropicRequest> = {},
): Promise<Captured> {
	const original = globalThis.fetch;
	let captured: Captured | undefined;

	globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
		captured = {
			url: String(input),
			headers: Object.fromEntries(new Headers(init?.headers).entries()),
		};
		return new Response(SSE, {
			status: 200,
			headers: { 'content-type': 'text/event-stream' },
		});
	}) as typeof globalThis.fetch;

	const callbacks: StreamCallbacks = {
		onContent: () => {},
		onThinking: () => {},
		onToolCall: () => {},
		onError: (error) => {
			throw error;
		},
		onDone: () => {},
	};

	try {
		await build().streamChatCompletion(
			{
				model: 'claude-sonnet-5',
				max_tokens: 16,
				stream: true,
				messages: [{ role: 'user', content: 'hi' }],
				...request,
			},
			callbacks,
		);
	} finally {
		globalThis.fetch = original;
	}

	assert.ok(captured, 'expected a request to be issued');
	return captured;
}

test.beforeEach(() => {
	globalThis.__vscodeMock.reset();
	// Keep the developer's real ~/.claude/settings.json out of these assertions.
	globalThis.__vscodeMock.config['anthropic-copilot.useClaudeCodeSettings'] = false;
});

test('a bearer credential is sent as an Authorization header', async () => {
	const build = () => new AnthropicClient('http://relay.example', {
		value: 'tok',
		scheme: 'bearer',
		origin: 'auth-token-env',
	});

	const { headers } = await capture(build);

	assert.equal(headers['authorization'], 'Bearer tok');
	assert.equal(headers['x-api-key'], undefined);
});

test('an x-api-key credential is sent as an x-api-key header', async () => {
	const build = () => new AnthropicClient('http://relay.example', {
		value: 'key',
		scheme: 'x-api-key',
		origin: 'api-key-env',
	});

	const { headers } = await capture(build);

	assert.equal(headers['x-api-key'], 'key');
	assert.equal(headers['authorization'], undefined);
});

// The exact failure that produced "Your credit balance is too low": configuring
// a relay side-channel header stripped the Anthropic credential from the
// request, so the relay billed an account that had none.
test('configuring a relay side-channel header still sends the credential', async () => {
	globalThis.__vscodeMock.config['anthropic-copilot.customHeaders'] = {
		'x-litellm-api-key': 'Bearer relay-key',
	};

	const build = () => new AnthropicClient('http://relay.example', {
		value: 'tok',
		scheme: 'bearer',
		origin: 'auth-token-env',
	});

	const { headers } = await capture(build);

	assert.equal(headers['authorization'], 'Bearer tok');
	assert.equal(headers['x-litellm-api-key'], 'Bearer relay-key');
});

test('an explicit authorization header in settings overrides the credential', async () => {
	globalThis.__vscodeMock.config['anthropic-copilot.customHeaders'] = {
		authorization: 'Bearer explicit',
	};

	const build = () => new AnthropicClient('http://relay.example', {
		value: 'tok',
		scheme: 'bearer',
		origin: 'setting',
	});

	const { headers } = await capture(build);

	assert.equal(headers['authorization'], 'Bearer explicit');
});

test('requests go to /v1/messages exactly once', async () => {
	const build = () => new AnthropicClient('https://api.anthropic.com', {
		value: 'key',
		scheme: 'x-api-key',
		origin: 'setting',
	});

	const { url } = await capture(build);

	assert.equal(url, 'https://api.anthropic.com/v1/messages');
});

test('requested betas are sent as an anthropic-beta header', async () => {
	const build = () => new AnthropicClient('http://relay.example', {
		value: 'tok',
		scheme: 'bearer',
		origin: 'setting',
	});

	const { headers } = await capture(build, { betas: ['context-1m-2025-08-07'] });

	assert.equal(headers['anthropic-beta'], 'context-1m-2025-08-07');
});

test('no anthropic-beta header is sent when no betas are requested', async () => {
	const build = () => new AnthropicClient('http://relay.example', {
		value: 'tok',
		scheme: 'bearer',
		origin: 'setting',
	});

	const { headers } = await capture(build);

	assert.equal(headers['anthropic-beta'], undefined);
});
