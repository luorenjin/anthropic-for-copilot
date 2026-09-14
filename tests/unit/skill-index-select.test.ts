import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillIndexEntry } from '../../src/provider/skills/parse';
import {
	buildSkillIndexModel,
	selectRelevantSkills,
	tokenize,
} from '../../src/provider/skills/select';

function entry(name: string, description: string): SkillIndexEntry {
	return {
		name,
		description,
		file: `c:\\skills\\${name}\\SKILL.md`,
		raw: `<skill>\n<name>${name}</name>\n<description>${description}</description>\n<file>c:\\skills\\${name}\\SKILL.md</file>\n</skill>`,
	};
}

function names(entries: SkillIndexEntry[]): string[] {
	return entries.map((item) => item.name);
}

test('tokenize splits kebab-case names into sub-words', () => {
	assert.deepEqual(tokenize('api-design-reviewer'), ['api', 'design', 'reviewer']);
	assert.deepEqual(tokenize('snake_case_name'), ['snake', 'case', 'name']);
});

test('tokenize lower-cases and drops single-character latin tokens and stop words', () => {
	assert.deepEqual(tokenize('Use when the user asks to Design a Schema'), ['design', 'schema']);
	assert.deepEqual(tokenize('a b cd'), ['cd']);
	assert.deepEqual(tokenize('version 2026 release'), ['version', '2026', 'release']);
});

test('tokenize turns Han runs into bigrams and drops bigrams with stop characters', () => {
	assert.deepEqual(tokenize('数据库迁移'), ['数据', '据库', '库迁', '迁移']);
	assert.deepEqual(tokenize('帮我做数据库迁移'), ['数据', '据库', '库迁', '迁移']);
	assert.deepEqual(tokenize('继续'), []);
	assert.deepEqual(tokenize('库'), ['库']);
});

test('tokenize separates mixed latin and Han runs', () => {
	assert.deepEqual(tokenize('vue组件重构'), ['vue', '组件', '件重', '重构']);
});

test('idf demotes template words shared by every description', () => {
	const model = buildSkillIndexModel([
		entry('alpha', 'Use when the user asks for help with widgets and a gadget'),
		entry('beta', 'Use when the user asks for help with widgets and a sprocket'),
		entry('gamma', 'Use when the user asks for help with widgets'),
	]);
	const picked = selectRelevantSkills(model, { current: 'widgets gadget' }, 10);
	assert.deepEqual(names(picked), ['alpha', 'beta', 'gamma']);
	// 'widgets' appears in all three: it must not separate beta from gamma,
	// so those two fall back to the name tie-break.
	const tie = selectRelevantSkills(model, { current: 'widgets' }, 10);
	assert.deepEqual(names(tie), ['alpha', 'beta', 'gamma']);
});

test('a name hit outweighs a description hit', () => {
	const model = buildSkillIndexModel([
		entry('misc', 'deploy helper tool'),
		entry('deploy-helper', 'misc'),
	]);
	assert.deepEqual(names(selectRelevantSkills(model, { current: 'deploy' }, 10)), [
		'deploy-helper',
		'misc',
	]);
});

test('results are deterministic and tie-break on name then index', () => {
	const model = buildSkillIndexModel([
		entry('zeta', 'rust toolchain'),
		entry('alpha', 'rust toolchain'),
		entry('mid', 'rust toolchain'),
	]);
	const first = selectRelevantSkills(model, { current: 'rust' }, 10);
	const second = selectRelevantSkills(model, { current: 'rust' }, 10);
	assert.deepEqual(names(first), ['alpha', 'mid', 'zeta']);
	assert.deepEqual(first, second);
});

test('maxRelevant caps the result and zero scores are excluded', () => {
	const model = buildSkillIndexModel([
		entry('a-rust', 'rust'),
		entry('b-rust', 'rust'),
		entry('c-rust', 'rust'),
		entry('python', 'python only'),
	]);
	assert.deepEqual(names(selectRelevantSkills(model, { current: 'rust' }, 2)), ['a-rust', 'b-rust']);
	assert.deepEqual(selectRelevantSkills(model, { current: 'cobol' }, 5), []);
	assert.deepEqual(selectRelevantSkills(model, { current: '' }, 5), []);
	assert.deepEqual(selectRelevantSkills(model, { current: 'rust' }, 0), []);
});

test('previous request tokens count at half weight', () => {
	// alpha only matches the previous query, in its name (3 × 0.5 = 1.5);
	// beta matches the current query, in its description (1 × 1 = 1).
	const nameModel = buildSkillIndexModel([entry('alpha-tool', 'x'), entry('y', 'beta tool')]);
	assert.deepEqual(names(selectRelevantSkills(nameModel, { current: 'beta', previous: 'alpha' }, 10)), [
		'alpha-tool',
		'y',
	]);
	// Move alpha into the description (1 × 0.5 = 0.5) and beta wins.
	const descriptionModel = buildSkillIndexModel([entry('z', 'alpha'), entry('y', 'beta tool')]);
	assert.deepEqual(
		names(selectRelevantSkills(descriptionModel, { current: 'beta', previous: 'alpha' }, 10)),
		['y', 'z'],
	);
});

test('a follow-up made only of stop words still selects via the previous request', () => {
	const model = buildSkillIndexModel([
		entry('数据库迁移助手', '为数据库迁移生成迁移脚本与回滚方案。'),
		entry('frontend-design', 'Guidance for distinctive UI visual design.'),
	]);
	const picked = selectRelevantSkills(model, { current: '继续', previous: '帮我做数据库迁移' }, 10);
	assert.deepEqual(names(picked), ['数据库迁移助手']);
});

test('query text beyond 2000 characters is ignored', () => {
	const model = buildSkillIndexModel([entry('needle-skill', 'needle')]);
	const padding = 'filler '.repeat(400); // 2800 chars of a word no entry contains
	assert.deepEqual(selectRelevantSkills(model, { current: padding + 'needle' }, 5), []);
	assert.deepEqual(names(selectRelevantSkills(model, { current: 'needle ' + padding }, 5)), [
		'needle-skill',
	]);
});
