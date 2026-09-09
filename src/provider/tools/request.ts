import vscode from 'vscode';
import { t } from '../../i18n';
import type { DeepSeekMessage, DeepSeekTool } from '../../types';
import { convertTools } from '../convert';
import { DEEPSEEK_TOOLS_LIMIT } from './consts';

export function prepareRequestTools(
	toolCallingCapability: boolean | number | undefined,
	options: vscode.ProvideLanguageModelChatResponseOptions,
): DeepSeekTool[] | undefined {
	const tools = toolCallingCapability ? convertTools(options.tools) : undefined;
	const toolLimit = getToolCallingLimit(toolCallingCapability);
	const toolsCount = tools?.length ?? 0;
	if (toolsCount > toolLimit) {
		throw new Error(t('request.toolsLimitExceeded', toolLimit, toolsCount));
	}
	return tools;
}

export function collectTrailingToolResultIds(messages: readonly DeepSeekMessage[]): string[] {
	const trailingToolResultIds: string[] = [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === 'user' && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === 'tool_result') {
					trailingToolResultIds.push(block.tool_use_id);
				}
			}
		} else {
			break;
		}
	}
	return trailingToolResultIds.reverse();
}

function getToolCallingLimit(toolCallingCapability: boolean | number | undefined): number {
	return typeof toolCallingCapability === 'number' ? toolCallingCapability : DEEPSEEK_TOOLS_LIMIT;
}
