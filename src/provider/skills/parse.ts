import { createHash } from 'crypto';
import {
	SKILL_ENTRY_CLOSE,
	SKILL_ENTRY_OPEN,
	SKILLS_BLOCK_CLOSE,
	SKILLS_BLOCK_OPEN,
} from './consts';

export interface SkillIndexEntry {
	name: string;
	description: string;
	file: string;
	/** The `<skill>…</skill>` source, byte for byte, re-emitted verbatim when selected. */
	raw: string;
}

export interface ParsedSkillIndex {
	/** Entries that carry a `<name>`; only these can be selected. */
	entries: SkillIndexEntry[];
	/** Every `<skill>` occurrence, parseable or not — drives the threshold and the stub text. */
	totalCount: number;
	/** Offset of `<skills>` in the system text. */
	blockStart: number;
	/** Offset just past `</skills>`. */
	blockEnd: number;
	/** Short hash of the block, for diagnostics. */
	hash: string;
}

/**
 * Locates Copilot's `<skills>` block inside a system prompt and parses its
 * entries. Returns `undefined` unless there is exactly one opening tag with a
 * closing tag after it, so anything unexpected is forwarded untouched.
 */
export function parseSkillIndex(systemText: string): ParsedSkillIndex | undefined {
	const blockStart = systemText.indexOf(SKILLS_BLOCK_OPEN);
	if (blockStart < 0) {
		return undefined;
	}
	if (systemText.indexOf(SKILLS_BLOCK_OPEN, blockStart + SKILLS_BLOCK_OPEN.length) >= 0) {
		return undefined;
	}
	const closeIndex = systemText.indexOf(SKILLS_BLOCK_CLOSE, blockStart);
	if (closeIndex < 0) {
		return undefined;
	}
	const blockEnd = closeIndex + SKILLS_BLOCK_CLOSE.length;
	const block = systemText.slice(blockStart, blockEnd);

	const entries: SkillIndexEntry[] = [];
	let totalCount = 0;
	let cursor = 0;
	while (true) {
		const open = block.indexOf(SKILL_ENTRY_OPEN, cursor);
		if (open < 0) {
			break;
		}
		const close = block.indexOf(SKILL_ENTRY_CLOSE, open);
		if (close < 0) {
			break;
		}
		const end = close + SKILL_ENTRY_CLOSE.length;
		const raw = block.slice(open, end);
		totalCount += 1;
		const name = extractTag(raw, 'name');
		if (name) {
			entries.push({
				name,
				description: extractTag(raw, 'description') ?? '',
				file: extractTag(raw, 'file') ?? '',
				raw,
			});
		}
		cursor = end;
	}

	return {
		entries,
		totalCount,
		blockStart,
		blockEnd,
		hash: createHash('sha1').update(block).digest('hex').slice(0, 10),
	};
}

/** Inner text of the first `<tag>…</tag>` pair, trimmed; `undefined` when absent or unterminated. */
export function extractTag(text: string, tag: string): string | undefined {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	const start = text.indexOf(open);
	if (start < 0) {
		return undefined;
	}
	const end = text.indexOf(close, start + open.length);
	if (end < 0) {
		return undefined;
	}
	return text.slice(start + open.length, end).trim();
}
