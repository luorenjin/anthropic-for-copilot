import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { getSkillIndexSettings } from '../../src/config';

beforeEach(() => {
	__vscodeMock.reset();
	// Keep config.ts away from the developer's real ~/.claude/settings.json.
	__vscodeMock.config['anthropic-copilot.useClaudeCodeSettings'] = false;
});

test('defaults match the spec', () => {
	assert.deepEqual(getSkillIndexSettings(), { mode: 'auto', threshold: 32, maxRelevant: 12 });
});

test('mode accepts off and treats unknown values as auto', () => {
	__vscodeMock.config['anthropic-copilot.skillIndex.mode'] = 'off';
	assert.equal(getSkillIndexSettings().mode, 'off');
	__vscodeMock.config['anthropic-copilot.skillIndex.mode'] = 'sometimes';
	assert.equal(getSkillIndexSettings().mode, 'auto');
});

test('threshold is clamped to a non-negative integer', () => {
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = -5;
	assert.equal(getSkillIndexSettings().threshold, 0);
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = 7.9;
	assert.equal(getSkillIndexSettings().threshold, 7);
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = 'many';
	assert.equal(getSkillIndexSettings().threshold, 32);
	__vscodeMock.config['anthropic-copilot.skillIndex.threshold'] = 0;
	assert.equal(getSkillIndexSettings().threshold, 0);
});

test('maxRelevant is clamped to 1..64', () => {
	__vscodeMock.config['anthropic-copilot.skillIndex.maxRelevant'] = 0;
	assert.equal(getSkillIndexSettings().maxRelevant, 1);
	__vscodeMock.config['anthropic-copilot.skillIndex.maxRelevant'] = 999;
	assert.equal(getSkillIndexSettings().maxRelevant, 64);
	__vscodeMock.config['anthropic-copilot.skillIndex.maxRelevant'] = Number.NaN;
	assert.equal(getSkillIndexSettings().maxRelevant, 12);
});
