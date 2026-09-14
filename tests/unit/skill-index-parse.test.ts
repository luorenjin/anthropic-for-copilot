import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTag, parseSkillIndex } from '../../src/provider/skills/parse';

// Fixture mirrors the exact shape Copilot Chat injects (see the spec §1):
// intro sentences, then <skill> entries with <name>/<description>/<file>,
// wrapped in <instructions>, followed by an <agents> block.
const ENTRY_SECURITY = [
	'<skill>',
	'<name>007</name>',
	'<description>Security audit, hardening, threat modeling (STRIDE/PASTA), Red/Blue Team.</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\007\\SKILL.md</file>',
	'</skill>',
].join('\n');
const ENTRY_SPANISH = [
	'<skill>',
	'<name>10-andruia-skill-smith</name>',
	'<description>Ingeniero de Sistemas de Andru.ia. Diseña y despliega nuevas habilidades.</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\10-andruia-skill-smith\\SKILL.md</file>',
	'</skill>',
].join('\n');
const ENTRY_CHINESE = [
	'<skill>',
	'<name>数据库迁移助手</name>',
	'<description>为数据库迁移生成迁移脚本与回滚方案。</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\db-migration\\SKILL.md</file>',
	'</skill>',
].join('\n');
const ENTRY_NO_NAME = [
	'<skill>',
	'<description>Broken entry without a name tag.</description>',
	'<file>c:\\Users\\user\\.agents\\skills\\broken\\SKILL.md</file>',
	'</skill>',
].join('\n');

const SKILLS_BLOCK = [
	'<skills>',
	'Here is a list of skills that contain domain specific knowledge on a variety of topics.',
	"When a user asks you to perform a task that falls within the domain of a skill, use the 'read_file' tool to acquire the full instructions from the file URI.",
	ENTRY_SECURITY,
	ENTRY_SPANISH,
	ENTRY_CHINESE,
	ENTRY_NO_NAME,
	'</skills>',
].join('\n');

const PREFIX = '<instructions>\nYou are an expert AI programming assistant.\n</instructions>\n\n<instructions>\n';
const SUFFIX = '\n</instructions>\n\n<agents>\n<agent>\n<name>Upgrade</name>\n</agent>\n</agents>';
const SYSTEM_TEXT = PREFIX + SKILLS_BLOCK + SUFFIX;

test('parses every well-formed entry and keeps raw bytes intact', () => {
	const parsed = parseSkillIndex(SYSTEM_TEXT);
	assert.ok(parsed);
	assert.equal(parsed.totalCount, 4);
	assert.equal(parsed.entries.length, 3);

	assert.deepEqual(parsed.entries[0], {
		name: '007',
		description: 'Security audit, hardening, threat modeling (STRIDE/PASTA), Red/Blue Team.',
		file: 'c:\\Users\\user\\.agents\\skills\\007\\SKILL.md',
		raw: ENTRY_SECURITY,
	});
	assert.equal(parsed.entries[1].name, '10-andruia-skill-smith');
	assert.equal(parsed.entries[1].raw, ENTRY_SPANISH);
	assert.equal(parsed.entries[2].name, '数据库迁移助手');
	assert.equal(parsed.entries[2].description, '为数据库迁移生成迁移脚本与回滚方案。');
	assert.equal(parsed.entries[2].raw, ENTRY_CHINESE);
});

test('block offsets slice exactly the <skills>…</skills> range', () => {
	const parsed = parseSkillIndex(SYSTEM_TEXT);
	assert.ok(parsed);
	assert.equal(SYSTEM_TEXT.slice(parsed.blockStart, parsed.blockEnd), SKILLS_BLOCK);
	assert.equal(SYSTEM_TEXT.slice(0, parsed.blockStart), PREFIX);
	assert.equal(SYSTEM_TEXT.slice(parsed.blockEnd), SUFFIX);
	assert.match(parsed.hash, /^[0-9a-f]{10}$/);
});

test('hash is stable for identical input and differs for different input', () => {
	const a = parseSkillIndex(SYSTEM_TEXT);
	const b = parseSkillIndex(SYSTEM_TEXT);
	const c = parseSkillIndex(PREFIX + SKILLS_BLOCK.replace('007', '008') + SUFFIX);
	assert.ok(a && b && c);
	assert.equal(a.hash, b.hash);
	assert.notEqual(a.hash, c.hash);
});

test('returns undefined when there is no <skills> block', () => {
	assert.equal(parseSkillIndex('<instructions>\nno skills here\n</instructions>'), undefined);
	assert.equal(parseSkillIndex(''), undefined);
});

test('returns undefined when the block is not closed', () => {
	assert.equal(parseSkillIndex(PREFIX + '<skills>\n' + ENTRY_SECURITY), undefined);
});

test('returns undefined when more than one <skills> block exists', () => {
	assert.equal(parseSkillIndex(SYSTEM_TEXT + '\n' + SKILLS_BLOCK), undefined);
});

test('an empty block parses with zero entries', () => {
	const parsed = parseSkillIndex('<skills>\n</skills>');
	assert.ok(parsed);
	assert.equal(parsed.totalCount, 0);
	assert.deepEqual(parsed.entries, []);
});

test('extractTag returns trimmed inner text or undefined', () => {
	assert.equal(extractTag('<a>\n hello \n</a>', 'a'), 'hello');
	assert.equal(extractTag('<a>x</a><a>y</a>', 'a'), 'x');
	assert.equal(extractTag('<a>unterminated', 'a'), undefined);
	assert.equal(extractTag('nothing', 'a'), undefined);
});
