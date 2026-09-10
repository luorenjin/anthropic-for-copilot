import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readClaudeCodeEnv } from '../../src/claude-code';

function withSettings(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'cc-settings-'));
	const file = join(dir, 'settings.json');
	writeFileSync(file, contents, 'utf8');
	return file;
}

test('reads the env block from a Claude Code settings file', () => {
	const file = withSettings(
		JSON.stringify({
			env: {
				ANTHROPIC_BASE_URL: 'http://claude.app.zkcrm.vip',
				ANTHROPIC_AUTH_TOKEN: 'sk-ant-example',
			},
			model: 'opus',
		}),
	);

	assert.deepEqual(readClaudeCodeEnv(file), {
		ANTHROPIC_BASE_URL: 'http://claude.app.zkcrm.vip',
		ANTHROPIC_AUTH_TOKEN: 'sk-ant-example',
	});
	rmSync(file, { force: true });
});

test('a missing file yields no values rather than throwing', () => {
	assert.deepEqual(readClaudeCodeEnv(join(tmpdir(), 'definitely-absent-settings.json')), {});
});

test('malformed JSON yields no values rather than throwing', () => {
	const file = withSettings('{ this is not json');
	assert.deepEqual(readClaudeCodeEnv(file), {});
	rmSync(file, { force: true });
});

test('a settings file without an env block yields no values', () => {
	const file = withSettings(JSON.stringify({ model: 'opus' }));
	assert.deepEqual(readClaudeCodeEnv(file), {});
	rmSync(file, { force: true });
});

test('non-string env values are ignored', () => {
	const file = withSettings(
		JSON.stringify({ env: { GOOD: 'yes', BAD: 42, ALSO_BAD: { nested: true } } }),
	);
	assert.deepEqual(readClaudeCodeEnv(file), { GOOD: 'yes' });
	rmSync(file, { force: true });
});

// Claude Code tolerates comments in its settings file, so a hand-edited file
// must not silently disable the whole integration.
test('comments and trailing commas are tolerated', () => {
	const file = withSettings(`{
		// the relay we use
		"env": {
			"ANTHROPIC_BASE_URL": "http://relay.example", /* inline */
			"ANTHROPIC_AUTH_TOKEN": "sk-ant-example",
		},
	}`);

	assert.deepEqual(readClaudeCodeEnv(file), {
		ANTHROPIC_BASE_URL: 'http://relay.example',
		ANTHROPIC_AUTH_TOKEN: 'sk-ant-example',
	});
	rmSync(file, { force: true });
});

// A URL contains '//' and must not be mistaken for a line comment.
test('a URL value is not truncated by comment stripping', () => {
	const file = withSettings('{"env":{"ANTHROPIC_BASE_URL":"https://relay.example/v1"}}');
	assert.deepEqual(readClaudeCodeEnv(file), {
		ANTHROPIC_BASE_URL: 'https://relay.example/v1',
	});
	rmSync(file, { force: true });
});
