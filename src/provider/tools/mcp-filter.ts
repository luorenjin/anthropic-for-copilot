/**
 * The Claude-subscription OAuth gateway classifies any request whose `tools`
 * array contains a name matching this exact shape as third-party (non-Claude
 * Code) usage and rejects it with 400 "You're out of extra usage" — even
 * though the tool itself has nothing to do with MCP support on Anthropic's
 * side. Confirmed live 2026-09-11/14: `mcp_upgrade_*` / `mcp_jstsupgradeas_*`
 * (Copilot's lowercase `mcp_<server>_<tool>` naming) trip it, while
 * `mcp__a__b` (Claude Code's own double-underscore MCP naming), names with an
 * uppercase letter (`mcp_a_B`, `mcp_pylance_mcp_s_pylanceAnalyze`), `Mcp_…`,
 * `mcp-a-b`, `mcp_9` and bare `mcp_` all pass. Request size, images,
 * thinking, and model are irrelevant — only this naming shape matters.
 */
const UNSUPPORTED_MCP_TOOL_NAME_PATTERN = /^mcp_[a-z][a-z0-9_]*$/;

export interface McpFilterableTool {
	readonly name: string;
}

export interface McpToolFilterResult<T extends McpFilterableTool> {
	tools: readonly T[] | undefined;
	removedNames: string[];
}

export function isUnsupportedMcpToolName(name: string): boolean {
	return UNSUPPORTED_MCP_TOOL_NAME_PATTERN.test(name);
}

/**
 * Drops tools the OAuth gateway is known to reject the whole request over,
 * so the rest of the tool list still works instead of every turn 400ing.
 * Only applies to OAuth access tokens (`sk-ant-oat…`) — the gateway
 * classification this works around is specific to that credential type.
 */
export function filterUnsupportedMcpTools<T extends McpFilterableTool>(
	tools: readonly T[] | undefined,
	isOAuthAccessToken: boolean,
): McpToolFilterResult<T> {
	if (!isOAuthAccessToken || !tools || tools.length === 0) {
		return { tools, removedNames: [] };
	}

	const removedNames: string[] = [];
	const kept = tools.filter((tool) => {
		if (isUnsupportedMcpToolName(tool.name)) {
			removedNames.push(tool.name);
			return false;
		}
		return true;
	});

	return removedNames.length > 0 ? { tools: kept, removedNames } : { tools, removedNames };
}
