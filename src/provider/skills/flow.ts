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

/**
 * Why no usable index was found. The parse is deliberately strict — a second
 * `<skills>` opening tag (say, a `copilot-instructions.md` that mentions the
 * tag literally) would let a lenient parser anchor on the wrong offset and stub
 * out everything in between — so the refusal says which case it hit instead of
 * collapsing every one of them into a silent `absent`.
 */
export type SkillIndexAbsentReason =
	/** The system text never mentions `<skills>`; the normal state for most requests. */
	| 'no-skills-text'
	/** More than one system text part carries `<skills>`. */
	| 'multiple-system-parts'
	/** The one part that carries `<skills>` has a duplicate opening tag or no closing tag. */
	| 'unparseable-block';

export interface SkillIndexStats {
	action: SkillIndexAction;
	threshold: number;
	maxRelevant: number;
	/** Set on `absent` and `not-applicable`; why no index was picked up. */
	reason?: SkillIndexAbsentReason;
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

type SkillsBlockLookup =
	| { located: LocatedSkillsBlock; reason?: undefined }
	| { located?: undefined; reason: SkillIndexAbsentReason };

/**
 * Replaces Copilot's `<skills>` index with a stub when it is larger than the
 * threshold and appends the entries most relevant to each user request to
 * that request. Selection is a pure function of the request text, the
 * previous request text, the index and K, so history messages re-render
 * byte-identically every turn and the prompt-cache prefix is preserved. So is
 * the decision to trim at all: it comes from whether the prompt actually
 * carries a parseable index, never from `requestKind`. Any failure forwards the
 * conversation unchanged — this is an optimization.
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

	// Whether to trim is decided from the prompt's content, never from
	// `requestKind`: the classifier reports `terminal-steering` whenever the
	// newest user message is one of Copilot's `[Terminal … notification: …]`
	// messages, and gating on it there would ship the untrimmed index — and drop
	// every block already appended to history — on exactly those turns, breaking
	// the cached prefix Copilot's own tool loop just paid for.
	const lookup = locateSkillsBlock(messages);
	if (!lookup.located) {
		if (lookup.reason !== 'no-skills-text') {
			logger.info(
				`[skill-index] the system prompt mentions <skills> but no usable index was parsed` +
					` (${lookup.reason}); forwarding it unchanged`,
			);
		}
		return {
			messages,
			stats: {
				...base,
				// A missing block is only worth reporting when the request was supposed
				// to carry one; `not-applicable` keeps the diagnostics log silent for the
				// title and commit-message requests that never carry an index.
				action: requestKind === 'main-agent' ? 'absent' : 'not-applicable',
				reason: lookup.reason,
			},
		};
	}
	const located = lookup.located;
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

/**
 * The single system text part carrying `<skills>`, or the reason there is no
 * usable one. Anything ambiguous is refused rather than guessed at, since a
 * wrong block offset would stub out unrelated prompt text.
 */
function locateSkillsBlock(messages: readonly Message[]): SkillsBlockLookup {
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
				return { reason: 'multiple-system-parts' };
			}
			const parsed = parseSkillIndex(part.value);
			if (!parsed) {
				return { reason: 'unparseable-block' };
			}
			located = { messageIndex, partIndex, systemText: part.value, parsed };
		}
	}
	return located ? { located } : { reason: 'no-skills-text' };
}

/**
 * Message index → query text for every user message that carries a
 * `<userRequest>`. Tool-result messages have no text parts and Copilot's
 * environment preamble has no `<userRequest>`, so both drop out. When the
 * conversation has no `<userRequest>` at all (non-agent surfaces), every
 * text-bearing user message becomes a request scored on its own full text.
 *
 * Both branches are content-addressed: which messages are requests, and the
 * query each one is scored on, depend only on the messages themselves. Picking
 * by position instead (e.g. "the last text-bearing message") would give a
 * message a block on one turn and none on the next, so its bytes would change
 * as history grew and the cached prefix would break from that message on.
 *
 * Which branch applies is a whole-conversation property: one message carrying
 * `<userRequest>` anywhere puts the entire conversation on the main path. A user
 * who pastes that literal text into a surface that does not use the tag would
 * therefore change how the *earlier* messages render, invalidating the cached
 * prefix once. Accepted: the alternative is a per-message rule, and that one
 * would make a message's own bytes depend on its neighbours just as much.
 */
function findRequestQueries(messages: readonly Message[]): Map<number, string> {
	const queries = new Map<number, string>();
	const textBearing = new Map<number, string>();
	for (const [index, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			continue;
		}
		const text = joinTextParts(message);
		if (text === undefined) {
			continue;
		}
		textBearing.set(index, text);
		const request = extractUserRequestText(text);
		if (request !== undefined) {
			queries.set(index, request);
		}
	}
	return queries.size > 0 ? queries : textBearing;
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
