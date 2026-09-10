import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessagesEndpoint, normalizeSdkBaseUrl } from '../../src/client';

// The Anthropic SDK posts to '/v1/messages' relative to baseURL, so the
// normalized base URL must never already carry a '/v1' segment.

test('official endpoint does not gain a duplicate /v1 segment', () => {
	assert.equal(normalizeSdkBaseUrl('https://api.anthropic.com'), 'https://api.anthropic.com');
});

test('relay root is preserved as-is', () => {
	assert.equal(normalizeSdkBaseUrl('http://claude.app.zkcrm.vip'), 'http://claude.app.zkcrm.vip');
});

test('trailing /v1 is stripped so the SDK can append its own', () => {
	assert.equal(normalizeSdkBaseUrl('http://relay.example/v1'), 'http://relay.example');
});

test('explicit /v1/messages path is stripped back to the root', () => {
	assert.equal(normalizeSdkBaseUrl('http://relay.example/v1/messages'), 'http://relay.example');
});

test('bare /messages path is stripped back to the root', () => {
	assert.equal(normalizeSdkBaseUrl('http://relay.example/messages'), 'http://relay.example');
});

test('trailing slashes are trimmed', () => {
	assert.equal(normalizeSdkBaseUrl('http://relay.example///'), 'http://relay.example');
});

test('a relay served from a sub-path keeps that path', () => {
	assert.equal(normalizeSdkBaseUrl('http://relay.example/anthropic'), 'http://relay.example/anthropic');
});

test('messages endpoint matches what the SDK actually requests', () => {
	assert.equal(
		buildMessagesEndpoint('https://api.anthropic.com'),
		'https://api.anthropic.com/v1/messages',
	);
	assert.equal(
		buildMessagesEndpoint('http://claude.app.zkcrm.vip'),
		'http://claude.app.zkcrm.vip/v1/messages',
	);
});
