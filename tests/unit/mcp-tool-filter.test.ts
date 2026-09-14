import assert from 'node:assert/strict';
import test from 'node:test';
import { filterUnsupportedMcpTools } from '../../src/provider/tools/mcp-filter';

// The Claude-subscription OAuth gateway 400s the *entire* request when `tools`
// contains a Copilot-style lowercase `mcp_<server>_<tool>` name, classifying
// it as third-party usage. Confirmed live 2026-09-11/14 by single-tool probes
// against the real gateway — see src/provider/tools/mcp-filter.ts.

function tool(name: string): { name: string } {
	return { name };
}

test('does nothing when the credential is not an OAuth access token', () => {
	const tools = [tool('mcp_upgrade_open_dashboard')];
	const result = filterUnsupportedMcpTools(tools, false);
	assert.equal(result.tools, tools);
	assert.deepEqual(result.removedNames, []);
});

test('does nothing when there are no tools', () => {
	assert.deepEqual(filterUnsupportedMcpTools(undefined, true), {
		tools: undefined,
		removedNames: [],
	});
	const empty: { name: string }[] = [];
	const result = filterUnsupportedMcpTools(empty, true);
	assert.equal(result.tools, empty);
	assert.deepEqual(result.removedNames, []);
});

test('drops Copilot-style lowercase mcp_<server>_<tool> names for OAuth tokens', () => {
	const kept = tool('read_file');
	const tools = [
		kept,
		tool('mcp_upgrade_open_dashboard'),
		tool('mcp_jstsupgradeas_typescript_compile_package'),
		tool('mcp_a_b'),
		tool('mcp_upgrade'),
		tool('mcp_a1'),
	];

	const result = filterUnsupportedMcpTools(tools, true);

	assert.deepEqual(result.tools, [kept]);
	assert.deepEqual(result.removedNames, [
		'mcp_upgrade_open_dashboard',
		'mcp_jstsupgradeas_typescript_compile_package',
		'mcp_a_b',
		'mcp_upgrade',
		'mcp_a1',
	]);
});

test('keeps names that only look similar to the rejected shape', () => {
	const tools = [
		tool('mcp__a__b'), // Claude Code's own double-underscore MCP naming
		tool('mcp_a_B'), // uppercase letter anywhere breaks the match
		tool('mcp_pylance_mcp_s_pylanceAnalyze'),
		tool('Mcp_upgrade'), // must start with lowercase "mcp_"
		tool('mcp-a-b'), // hyphen, not underscore
		tool('mcp_9'), // first char after "mcp_" must be a-z, not a digit
		tool('mcp_'), // needs at least one a-z char after "mcp_"
	];

	const result = filterUnsupportedMcpTools(tools, true);

	assert.equal(result.tools, tools);
	assert.deepEqual(result.removedNames, []);
});

test('returns the original array reference when nothing is removed', () => {
	const tools = [tool('read_file'), tool('mcp__a__b')];
	const result = filterUnsupportedMcpTools(tools, true);
	assert.equal(result.tools, tools);
});
