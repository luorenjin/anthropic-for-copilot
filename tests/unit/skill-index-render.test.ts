import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillIndexEntry } from '../../src/provider/skills/parse';
import {
	extractUserRequestText,
	renderRelevantSkillsBlock,
	renderSkillIndexStub,
} from '../../src/provider/skills/render';

const RAW_A = '<skill>\n<name>a</name>\n<description>A.</description>\n<file>c:\\a\\SKILL.md</file>\n</skill>';
const RAW_B = '<skill>\n<name>b</name>\n<description>B.</description>\n<file>c:\\b\\SKILL.md</file>\n</skill>';
const A: SkillIndexEntry = { name: 'a', description: 'A.', file: 'c:\\a\\SKILL.md', raw: RAW_A };
const B: SkillIndexEntry = { name: 'b', description: 'B.', file: 'c:\\b\\SKILL.md', raw: RAW_B };

test('stub is the exact spec text with the count filled in', () => {
	assert.equal(
		renderSkillIndexStub(1551),
		[
			'<skills>',
			'1551 skills with domain-specific instructions are available in this workspace.',
			'To keep this prompt compact, only the skills most relevant to each user request are listed inside a <relevant_skills> block appended to that request, using the same <skill> format.',
			"When a task falls within the domain of a listed skill, use the 'read_file' tool to acquire the full instructions from the file path.",
			'If the user names a skill that is not listed, ask them for its file path.',
			'</skills>',
		].join('\n'),
	);
});

test('relevant skills block re-emits raw entries verbatim in order', () => {
	assert.equal(
		renderRelevantSkillsBlock([B, A]),
		'<relevant_skills>\n' + RAW_B + '\n' + RAW_A + '\n</relevant_skills>',
	);
	assert.equal(renderRelevantSkillsBlock([]), '<relevant_skills>\n</relevant_skills>');
});

test('extractUserRequestText returns the trimmed inner text of the first <userRequest>', () => {
	const message =
		'<context>\nThe current date is 2026-09-09.\n</context>\n<reminderInstructions>\nx\n</reminderInstructions>\n<userRequest>\n帮我做数据库迁移\n</userRequest>\n';
	assert.equal(extractUserRequestText(message), '帮我做数据库迁移');
	assert.equal(extractUserRequestText('<userRequest></userRequest>'), '');
	assert.equal(extractUserRequestText('<environment_info>win32</environment_info>'), undefined);
	assert.equal(extractUserRequestText('<userRequest>unterminated'), undefined);
});
