/** Anthropic beta flag that unlocks the 1M-token context window. */
export const CONTEXT_1M_BETA = 'context-1m-2025-08-07';

export interface ParsedModelId {
	model: string;
	betas: string[];
}

const ONE_MILLION_SUFFIX = /^(.*)\[1m\]$/iu;

/**
 * Claude Code writes 1M-context models as `claude-sonnet-5[1M]` and resolves
 * that suffix on the client. Anthropic answers 404 for the suffixed name, so
 * translate it into the beta it stands for instead of forwarding it verbatim.
 */
export function parseModelId(rawModelId: string): ParsedModelId {
	const trimmed = rawModelId.trim();
	const match = ONE_MILLION_SUFFIX.exec(trimmed);
	if (!match) {
		return { model: trimmed, betas: [] };
	}

	return { model: match[1].trim(), betas: [CONTEXT_1M_BETA] };
}
