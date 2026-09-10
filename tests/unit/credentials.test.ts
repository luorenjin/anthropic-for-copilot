import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildSdkAuth,
	buildSystemWithClaudeCodeIdentity,
	CLAUDE_CODE_IDENTITY_SYSTEM_PROMPT,
	isOAuthAccessToken,
	resolveCredentialScheme,
} from '../../src/credentials';

// --- scheme resolution -------------------------------------------------

test('a token from ANTHROPIC_AUTH_TOKEN is sent as a bearer token', () => {
	assert.equal(resolveCredentialScheme('auth-token-env', 'http://relay.example', 'auto'), 'bearer');
});

test('a key from ANTHROPIC_API_KEY is sent as x-api-key', () => {
	assert.equal(resolveCredentialScheme('api-key-env', 'http://relay.example', 'auto'), 'x-api-key');
});

test('a stored credential defaults to x-api-key on the official endpoint', () => {
	assert.equal(
		resolveCredentialScheme('secret-storage', 'https://api.anthropic.com', 'auto'),
		'x-api-key',
	);
});

test('a stored credential defaults to bearer on a relay endpoint', () => {
	assert.equal(
		resolveCredentialScheme('secret-storage', 'http://claude.app.zkcrm.vip', 'auto'),
		'bearer',
	);
});

test('an explicit scheme setting overrides the source-derived default', () => {
	assert.equal(
		resolveCredentialScheme('api-key-env', 'http://relay.example', 'bearer'),
		'bearer',
	);
	assert.equal(
		resolveCredentialScheme('auth-token-env', 'http://relay.example', 'x-api-key'),
		'x-api-key',
	);
});

// --- SDK auth option assembly ------------------------------------------

test('a bearer credential is passed as authToken', () => {
	const auth = buildSdkAuth({ value: 'tok', scheme: 'bearer', origin: 'setting' }, {});
	assert.equal(auth.authToken, 'tok');
});

test('an x-api-key credential is passed as apiKey', () => {
	const auth = buildSdkAuth({ value: 'key', scheme: 'x-api-key', origin: 'setting' }, {});
	assert.equal(auth.apiKey, 'key');
});

// The SDK falls back to reading ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from
// the environment when these are `undefined`, so the unused one must be an
// explicit null or a stray env var silently becomes the credential.
test('the unused credential field is explicitly null, never undefined', () => {
	const bearer = buildSdkAuth({ value: 'tok', scheme: 'bearer', origin: 'setting' }, {});
	assert.strictEqual(bearer.apiKey, null);

	const apiKey = buildSdkAuth({ value: 'key', scheme: 'x-api-key', origin: 'setting' }, {});
	assert.strictEqual(apiKey.authToken, null);
});

// This is the regression under test: a relay side-channel header such as
// x-litellm-api-key authenticates the caller *to the relay* and coexists with
// the Anthropic credential. Treating it as a replacement stripped the
// credential entirely and the relay answered "credit balance is too low".
test('a relay side-channel header does not suppress the Anthropic credential', () => {
	const auth = buildSdkAuth({ value: 'tok', scheme: 'bearer', origin: 'auth-token-env' }, {
		'x-litellm-api-key': 'Bearer relay-key',
	});

	assert.equal(auth.authToken, 'tok');
	assert.equal(auth.defaultHeaders['x-litellm-api-key'], 'Bearer relay-key');
	assert.ok(
		!('authorization' in auth.defaultHeaders),
		'authorization must not be nulled out by a side-channel header',
	);
});

test('a user supplied authorization header takes over from the credential', () => {
	const auth = buildSdkAuth({ value: 'tok', scheme: 'bearer', origin: 'setting' }, {
		authorization: 'Bearer explicit',
	});

	assert.strictEqual(auth.authToken, null);
	assert.strictEqual(auth.apiKey, null);
	assert.equal(auth.defaultHeaders['authorization'], 'Bearer explicit');
});

test('a user supplied x-api-key header takes over from the credential', () => {
	const auth = buildSdkAuth({ value: 'tok', scheme: 'bearer', origin: 'setting' }, {
		'X-Api-Key': 'explicit',
	});

	assert.strictEqual(auth.authToken, null);
	assert.strictEqual(auth.apiKey, null);
});

test('with no credential the SDK is told auth is deliberately absent', () => {
	const auth = buildSdkAuth(undefined, { 'x-litellm-api-key': 'Bearer relay-key' });

	assert.strictEqual(auth.apiKey, null);
	assert.strictEqual(auth.authToken, null);
	assert.strictEqual(auth.defaultHeaders['x-api-key'], null);
});

// --- Claude Code identity requirement -----------------------------------

// Anthropic's backend answers every request made with a Claude subscription
// OAuth access token with 429 rate_limit_error unless the request's system
// prompt identifies the caller as Claude Code — confirmed by direct testing
// to be unrelated to headers entirely. This detects which credentials need it.
test('an OAuth access token (sk-ant-oat...) is recognized as needing the Claude Code identity', () => {
	assert.equal(isOAuthAccessToken('sk-ant-oat01-abc123'), true);
});

test('a regular API key is not recognized as an OAuth access token', () => {
	assert.equal(isOAuthAccessToken('sk-ant-api03-abc123'), false);
});

// Confirmed live against the relay: concatenating the identity into a single
// string with the rest of the system prompt still 429s — only an isolated
// leading block at system[0] satisfies the check. See describeSystem() in
// client/core.ts, which flags a regression back to the concatenated form as
// identity=loose instead of identity=strict.
test('with no extra system content, the identity is the sole block', () => {
	const system = buildSystemWithClaudeCodeIdentity(undefined);
	assert.deepEqual(system, [{ type: 'text', text: CLAUDE_CODE_IDENTITY_SYSTEM_PROMPT }]);
});

test('extra system content is kept in a separate block, never merged into the identity block', () => {
	const system = buildSystemWithClaudeCodeIdentity("You are a helpful pair programmer.");

	assert.equal(system.length, 2);
	assert.deepEqual(system[0], { type: 'text', text: CLAUDE_CODE_IDENTITY_SYSTEM_PROMPT });
	assert.deepEqual(system[1], { type: 'text', text: "You are a helpful pair programmer." });
});

test('an empty string system prompt is treated the same as undefined', () => {
	const system = buildSystemWithClaudeCodeIdentity('');
	assert.equal(system.length, 1);
});
