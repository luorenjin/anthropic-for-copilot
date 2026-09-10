import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTEXT_1M_BETA, parseModelId } from '../../src/model-id';

// '[1M]' is a Claude Code client-side convention. Anthropic itself answers
// 404 not_found_error for 'claude-sonnet-5[1M]', so the suffix must be
// translated into the context-1m beta header instead of being sent verbatim.

test('a plain model id requests no betas', () => {
	assert.deepEqual(parseModelId('claude-sonnet-5'), {
		model: 'claude-sonnet-5',
		betas: [],
	});
});

test('[1M] suffix is stripped and becomes the 1M context beta', () => {
	assert.deepEqual(parseModelId('claude-sonnet-5[1M]'), {
		model: 'claude-sonnet-5',
		betas: [CONTEXT_1M_BETA],
	});
});

test('lowercase [1m] suffix is treated the same', () => {
	assert.deepEqual(parseModelId('claude-opus-5[1m]'), {
		model: 'claude-opus-5',
		betas: [CONTEXT_1M_BETA],
	});
});

test('surrounding whitespace is ignored', () => {
	assert.deepEqual(parseModelId('  claude-opus-5[1M]  '), {
		model: 'claude-opus-5',
		betas: [CONTEXT_1M_BETA],
	});
});

test('a dotted model name keeps its dots', () => {
	assert.deepEqual(parseModelId('claude-fable-5.1[1M]'), {
		model: 'claude-fable-5.1',
		betas: [CONTEXT_1M_BETA],
	});
});

test('an unrelated bracket suffix is left alone', () => {
	assert.deepEqual(parseModelId('custom-model[preview]'), {
		model: 'custom-model[preview]',
		betas: [],
	});
});
