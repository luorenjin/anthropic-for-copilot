import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Claude Code keeps its provider configuration in the `env` block of
 * `~/.claude/settings.json` and injects those values into its own child
 * processes only. A VS Code window launched from the Start Menu inherits none
 * of them, so the extension reads the file directly.
 */
export function getClaudeCodeSettingsPath(): string {
	return join(homedir(), '.claude', 'settings.json');
}

export function readClaudeCodeEnv(
	filePath: string = getClaudeCodeSettingsPath(),
): Record<string, string> {
	let raw: string;
	try {
		raw = readFileSync(filePath, 'utf8');
	} catch {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(removeTrailingCommas(stripJsonComments(raw)));
	} catch {
		return {};
	}

	const env = (parsed as { env?: unknown } | null)?.env;
	if (typeof env !== 'object' || env === null) {
		return {};
	}

	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		if (typeof value === 'string') {
			result[key] = value;
		}
	}
	return result;
}

let cache: { path: string; mtimeMs: number; env: Record<string, string> } | undefined;

/** Cached read keyed on mtime; the settings file is consulted per request. */
export function readClaudeCodeEnvCached(
	filePath: string = getClaudeCodeSettingsPath(),
): Record<string, string> {
	let mtimeMs: number;
	try {
		mtimeMs = statSync(filePath).mtimeMs;
	} catch {
		cache = undefined;
		return {};
	}

	if (cache?.path === filePath && cache.mtimeMs === mtimeMs) {
		return cache.env;
	}

	const env = readClaudeCodeEnv(filePath);
	cache = { path: filePath, mtimeMs, env };
	return env;
}

function stripJsonComments(text: string): string {
	let out = '';
	let inString = false;
	let escaped = false;
	let comment: 'line' | 'block' | undefined;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		const next = text[index + 1];

		if (comment === 'line') {
			if (char === '\n') {
				comment = undefined;
				out += char;
			}
			continue;
		}
		if (comment === 'block') {
			if (char === '*' && next === '/') {
				comment = undefined;
				index += 1;
			}
			continue;
		}
		if (inString) {
			out += char;
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			continue;
		}
		if (char === '/' && next === '/') {
			comment = 'line';
			index += 1;
			continue;
		}
		if (char === '/' && next === '*') {
			comment = 'block';
			index += 1;
			continue;
		}
		out += char;
	}

	return out;
}

function removeTrailingCommas(text: string): string {
	let out = '';
	let inString = false;
	let escaped = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];

		if (inString) {
			out += char;
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			out += char;
			continue;
		}
		if (char === ',') {
			let lookahead = index + 1;
			while (lookahead < text.length && /\s/u.test(text[lookahead])) {
				lookahead += 1;
			}
			if (text[lookahead] === '}' || text[lookahead] === ']') {
				continue;
			}
		}
		out += char;
	}

	return out;
}
