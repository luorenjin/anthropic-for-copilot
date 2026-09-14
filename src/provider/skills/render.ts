import { RELEVANT_SKILLS_TAG, USER_REQUEST_TAG } from './consts';
import { extractTag, type SkillIndexEntry } from './parse';

/**
 * Replaces Copilot's full index in the system prompt. Fixed text apart from
 * the count, so it only changes when the index itself changes.
 */
export function renderSkillIndexStub(totalCount: number): string {
	return [
		'<skills>',
		`${totalCount} skills with domain-specific instructions are available in this workspace.`,
		`To keep this prompt compact, only the skills most relevant to each user request are listed inside a <${RELEVANT_SKILLS_TAG}> block appended to that request, using the same <skill> format.`,
		"When a task falls within the domain of a listed skill, use the 'read_file' tool to acquire the full instructions from the file path.",
		'If the user names a skill that is not listed, ask them for its file path.',
		'</skills>',
	].join('\n');
}

/** The selected entries, byte-identical to Copilot's own `<skill>` markup. */
export function renderRelevantSkillsBlock(entries: readonly SkillIndexEntry[]): string {
	return [
		`<${RELEVANT_SKILLS_TAG}>`,
		...entries.map((entry) => entry.raw),
		`</${RELEVANT_SKILLS_TAG}>`,
	].join('\n');
}

/** The user's actual prompt inside a Copilot user message, without the surrounding context blocks. */
export function extractUserRequestText(messageText: string): string | undefined {
	return extractTag(messageText, USER_REQUEST_TAG);
}
