import vscode from 'vscode';
import type { SkillIndexSettings } from '../../config';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../consts';
import { logger } from '../../logger';
import { logSkillIndexDiagnostics } from '../debug';
import type { RequestKind } from '../routing';
import { SKILL_INDEX_NOTICE_START } from '../tools/consts';
import { createSkillIndexNotice } from '../tools/notices';
import { SKILLS_BLOCK_OPEN } from './consts';
import { parseSkillIndex, type ParsedSkillIndex } from './parse';
import { extractUserRequestText, renderRelevantSkillsBlock, renderSkillIndexStub } from './render';
import { buildSkillIndexModel, selectRelevantSkills } from './select';

export type SkillIndexAction =
	| 'off'
	| 'not-applicable'
	| 'absent'
	| 'passthrough'
	| 'trimmed'
	| 'error';

export interface SkillIndexStats {
	action: SkillIndexAction;
	threshold: number;
	maxRelevant: number;
	totalCount?: number;
	requestMessages?: number;
	/** Entries appended to each request message, in message order (0 when nothing matched). */
	injectedCounts?: number[];
	systemCharsBefore?: number;
	systemCharsAfter?: number;
	indexHash?: string;
}

export interface SkillIndexFlowOptions {
	/** Messages as returned by processToolFlow (notices and preflight control flow already removed). */
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	/** Messages exactly as the provider received them; used to see whether the notice was shown before. */
	rawMessages: readonly vscode.LanguageModelChatRequestMessage[];
	requestKind: RequestKind;
	settings: SkillIndexSettings;
}

export interface SkillIndexFlowResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	stats: SkillIndexStats;
	initialResponseNotice?: string;
}

type Message = vscode.LanguageModelChatRequestMessage;

interface LocatedSkillsBlock {
	messageIndex: number;
	partIndex: number;
	systemText: string;
	parsed: ParsedSkillIndex;
}

/**
 * Replaces Copilot's `<skills>` index with a stub when it is larger than the
 * threshold and appends the entries most relevant to each user request to
 * that request. Selection is a pure function of the request text, the
 * previous request text, the index and K, so history messages re-render
 * byte-identically every turn and the prompt-cache prefix is preserved. Any
 * failure forwards the conversation unchanged — this is an optimization.
 */
export function processSkillIndex(options: SkillIndexFlowOptions): SkillIndexFlowResult {
	const base: SkillIndexStats = {
		action: 'off',
		threshold: options.settings.threshold,
		maxRelevant: options.settings.maxRelevant,
	};
	let result: SkillIndexFlowResult;
	try {
		result = processSkillIndexUnsafe(options, base);
	} catch (error) {
		logger.warn(
			`[skill-index] failed, forwarding the prompt unchanged: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		result = { messages: options.messages, stats: { ...base, action: 'error' } };
	}
	logSkillIndexDiagnostics(options.requestKind, result.stats);
	return result;
}

function processSkillIndexUnsafe(
	{ messages, rawMessages, requestKind, settings }: SkillIndexFlowOptions,
	base: SkillIndexStats,
): SkillIndexFlowResult {
	if (settings.mode === 'off') {
		return { messages, stats: { ...base, action: 'off' } };
	}
	if (requestKind !== 'main-agent') {
		return { messages, stats: { ...base, action: 'not-applicable' } };
	}

	const located = locateSkillsBlock(messages);
	if (!located) {
		return { messages, stats: { ...base, action: 'absent' } };
	}
	const { parsed, systemText } = located;
	if (parsed.totalCount <= settings.threshold) {
		return {
			messages,
			stats: {
				...base,
				action: 'passthrough',
				totalCount: parsed.totalCount,
				indexHash: parsed.hash,
			},
		};
	}

	const rewrittenSystemText =
		systemText.slice(0, parsed.blockStart) +
		renderSkillIndexStub(parsed.totalCount) +
		systemText.slice(parsed.blockEnd);
	const model = buildSkillIndexModel(parsed.entries);
	const requestQueries = findRequestQueries(messages);

	const injectedCounts: number[] = [];
	const output: Message[] = [];
	let previousQuery: string | undefined;
	for (const [index, message] of messages.entries()) {
		if (index === located.messageIndex) {
			output.push(replaceTextPart(message, located.partIndex, rewrittenSystemText));
			continue;
		}
		const query = requestQueries.get(index);
		if (query === undefined) {
			output.push(message);
			continue;
		}
		const picks = selectRelevantSkills(
			model,
			{ current: query, previous: previousQuery },
			settings.maxRelevant,
		);
		previousQuery = query;
		injectedCounts.push(picks.length);
		output.push(
			picks.length > 0 ? appendTextPart(message, '\n' + renderRelevantSkillsBlock(picks)) : message,
		);
	}

	return {
		messages: output,
		stats: {
			...base,
			action: 'trimmed',
			totalCount: parsed.totalCount,
			requestMessages: requestQueries.size,
			injectedCounts,
			systemCharsBefore: systemText.length,
			systemCharsAfter: rewrittenSystemText.length,
			indexHash: parsed.hash,
		},
		initialResponseNotice: hasSkillIndexNotice(rawMessages)
			? undefined
			: createSkillIndexNotice(parsed.totalCount, settings.maxRelevant),
	};
}

/** The single system text part carrying `<skills>`; `undefined` when there is none or more than one. */
function locateSkillsBlock(messages: readonly Message[]): LocatedSkillsBlock | undefined {
	let located: LocatedSkillsBlock | undefined;
	for (const [messageIndex, message] of messages.entries()) {
		if ((message.role as number) !== LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) {
			continue;
		}
		for (const [partIndex, part] of message.content.entries()) {
			if (
				!(part instanceof vscode.LanguageModelTextPart) ||
				!part.value.includes(SKILLS_BLOCK_OPEN)
			) {
				continue;
			}
			if (located) {
				return undefined;
			}
			const parsed = parseSkillIndex(part.value);
			if (!parsed) {
				return undefined;
			}
			located = { messageIndex, partIndex, systemText: part.value, parsed };
		}
	}
	return located;
}

/**
 * Message index → query text for every user message that carries a
 * `<userRequest>`. Tool-result messages have no text parts and Copilot's
 * environment preamble has no `<userRequest>`, so both drop out. When the
 * conversation has no `<userRequest>` at all (non-agent surfaces), the last
 * text-bearing user message is used with its full text.
 */
function findRequestQueries(messages: readonly Message[]): Map<number, string> {
	const queries = new Map<number, string>();
	let lastTextIndex = -1;
	let lastText = '';
	for (const [index, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			continue;
		}
		const text = joinTextParts(message);
		if (text === undefined) {
			continue;
		}
		lastTextIndex = index;
		lastText = text;
		const request = extractUserRequestText(text);
		if (request !== undefined) {
			queries.set(index, request);
		}
	}
	if (queries.size === 0 && lastTextIndex >= 0) {
		queries.set(lastTextIndex, lastText);
	}
	return queries;
}

/** Concatenated text parts, or `undefined` when the message has none. */
function joinTextParts(message: Message): string | undefined {
	let text: string | undefined;
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text = (text ?? '') + part.value;
		}
	}
	return text;
}

function replaceTextPart(message: Message, partIndex: number, value: string): Message {
	return {
		...message,
		content: message.content.map((part, index) =>
			index === partIndex ? new vscode.LanguageModelTextPart(value) : part,
		),
	};
}

function appendTextPart(message: Message, value: string): Message {
	return { ...message, content: [...message.content, new vscode.LanguageModelTextPart(value)] };
}

function hasSkillIndexNotice(messages: readonly Message[]): boolean {
	return messages.some(
		(message) =>
			message.role === vscode.LanguageModelChatMessageRole.Assistant &&
			message.content.some(
				(part) =>
					part instanceof vscode.LanguageModelTextPart &&
					part.value.includes(SKILL_INDEX_NOTICE_START),
			),
	);
}
