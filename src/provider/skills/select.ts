import {
	DESCRIPTION_TOKEN_WEIGHT,
	HAN_STOP_CHARS,
	MIN_LATIN_TOKEN_LENGTH,
	NAME_TOKEN_WEIGHT,
	PREVIOUS_QUERY_WEIGHT,
	QUERY_MAX_CHARS,
	STOP_WORDS,
} from './consts';
import type { SkillIndexEntry } from './parse';

export interface SkillSelectionQuery {
	/** The `<userRequest>` text of the message being scored. */
	current: string;
	/** The `<userRequest>` text of the nearest earlier request message, if any. */
	previous?: string;
}

export interface SkillIndexModel {
	entries: readonly SkillIndexEntry[];
	/** Per entry: token → weight (name tokens 3, description tokens 1; max wins). */
	weights: ReadonlyArray<ReadonlyMap<string, number>>;
	/** token → ln(1 + N / df). */
	idf: ReadonlyMap<string, number>;
}

const WORD_RUN = /[\p{L}\p{N}]+/gu;
const HAN_CHAR = /\p{Script=Han}/u;

/**
 * Lower-cases, splits on non-alphanumerics (so kebab/snake names become
 * sub-words), keeps latin tokens of length >= 2, turns Han runs into character
 * bigrams, and drops stop words. Pure and deterministic.
 */
export function tokenize(text: string): string[] {
	const tokens: string[] = [];
	for (const match of text.toLowerCase().matchAll(WORD_RUN)) {
		let latin = '';
		let han = '';
		for (const char of match[0]) {
			if (HAN_CHAR.test(char)) {
				pushLatin(latin, tokens);
				latin = '';
				han += char;
			} else {
				pushHan(han, tokens);
				han = '';
				latin += char;
			}
		}
		pushLatin(latin, tokens);
		pushHan(han, tokens);
	}
	return tokens;
}

function pushLatin(token: string, tokens: string[]): void {
	if (token.length >= MIN_LATIN_TOKEN_LENGTH && !STOP_WORDS.has(token)) {
		tokens.push(token);
	}
}

function pushHan(run: string, tokens: string[]): void {
	const chars = [...run];
	if (chars.length === 0) {
		return;
	}
	if (chars.length === 1) {
		if (!HAN_STOP_CHARS.has(chars[0]) && !STOP_WORDS.has(chars[0])) {
			tokens.push(chars[0]);
		}
		return;
	}
	for (let index = 0; index + 1 < chars.length; index += 1) {
		const first = chars[index];
		const second = chars[index + 1];
		if (HAN_STOP_CHARS.has(first) || HAN_STOP_CHARS.has(second)) {
			continue;
		}
		const bigram = first + second;
		if (!STOP_WORDS.has(bigram)) {
			tokens.push(bigram);
		}
	}
}

export function buildSkillIndexModel(entries: readonly SkillIndexEntry[]): SkillIndexModel {
	const weights: Map<string, number>[] = [];
	const documentFrequency = new Map<string, number>();
	for (const entry of entries) {
		const entryWeights = new Map<string, number>();
		for (const token of tokenize(entry.description)) {
			entryWeights.set(token, DESCRIPTION_TOKEN_WEIGHT);
		}
		for (const token of tokenize(entry.name)) {
			entryWeights.set(token, NAME_TOKEN_WEIGHT);
		}
		for (const token of entryWeights.keys()) {
			documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
		}
		weights.push(entryWeights);
	}
	const idf = new Map<string, number>();
	for (const [token, df] of documentFrequency) {
		idf.set(token, Math.log(1 + entries.length / df));
	}
	return { entries, weights, idf };
}

/**
 * score(e) = Σ_{t∈current} w_e(t)·idf(t) + 0.5·Σ_{t∈previous∖current} w_e(t)·idf(t).
 * Sorted by score desc, then name asc (UTF-16 code unit order), then index;
 * returns the top `maxRelevant` entries with a positive score.
 */
export function selectRelevantSkills(
	model: SkillIndexModel,
	query: SkillSelectionQuery,
	maxRelevant: number,
): SkillIndexEntry[] {
	if (maxRelevant <= 0 || model.entries.length === 0) {
		return [];
	}
	const currentTokens = new Set(tokenize(query.current.slice(0, QUERY_MAX_CHARS)));
	const previousTokens = new Set<string>();
	for (const token of tokenize((query.previous ?? '').slice(0, QUERY_MAX_CHARS))) {
		if (!currentTokens.has(token)) {
			previousTokens.add(token);
		}
	}
	if (currentTokens.size === 0 && previousTokens.size === 0) {
		return [];
	}

	const scored: { index: number; score: number }[] = [];
	for (const [index, weights] of model.weights.entries()) {
		let score = 0;
		for (const token of currentTokens) {
			score += (weights.get(token) ?? 0) * (model.idf.get(token) ?? 0);
		}
		for (const token of previousTokens) {
			score += PREVIOUS_QUERY_WEIGHT * (weights.get(token) ?? 0) * (model.idf.get(token) ?? 0);
		}
		if (score > 0) {
			scored.push({ index, score });
		}
	}

	scored.sort((a, b) => {
		if (a.score !== b.score) {
			return b.score - a.score;
		}
		const nameA = model.entries[a.index].name;
		const nameB = model.entries[b.index].name;
		if (nameA !== nameB) {
			return nameA < nameB ? -1 : 1;
		}
		return a.index - b.index;
	});

	return scored.slice(0, maxRelevant).map((item) => model.entries[item.index]);
}
