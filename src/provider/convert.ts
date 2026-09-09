import vscode from 'vscode';
import { safeStringify } from '../json';
import type {
	AnthropicContentBlock,
	AnthropicMessage,
	AnthropicRequest,
	AnthropicTool,
	AnthropicToolCall,
} from '../types';
import { parseFirstReplayMarker } from './replay';
import {
	isImageDataPart,
	normalizeToolResult,
	type NormalizedToolResult,
} from './vision/normalize';

export interface ConvertedAnthropicPayload {
	system?: string;
	messages: AnthropicMessage[];
}

/**
 * Convert VS Code chat messages to Anthropic Messages API format.
 * Extracts system prompts to top-level `system` property.
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	isThinkingModel: boolean,
	nativeImageInput: boolean,
): ConvertedAnthropicPayload {
	const resultMessages: AnthropicMessage[] = [];
	let systemPrompt = '';

	for (const message of messages) {
		const role = mapRole(message.role);

		// Handle System messages separately for Anthropic API
		if (role === 'system') {
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					if (systemPrompt) {
						systemPrompt += '\n\n';
					}
					systemPrompt += part.value;
				}
			}
			continue;
		}

		let textContent = '';
		const contentBlocks: AnthropicContentBlock[] = [];
		let thinkingContent = '';
		const toolCalls: AnthropicToolCall[] = [];
		const toolResults: NormalizedToolResult[] = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textContent += part.value;
				contentBlocks.push({
					type: 'text',
					text: part.value,
				});
			} else if (nativeImageInput && role === 'user' && isImageDataPart(part)) {
				contentBlocks.push({
					type: 'image',
					source: {
						type: 'base64',
						media_type: part.mimeType,
						data: Buffer.from(part.data).toString('base64'),
					},
				});
			} else if (isLanguageModelThinkingPart(part)) {
				thinkingContent += normalizeThinkingPartText(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				const inputObj =
					typeof part.input === 'object' && part.input !== null
						? (part.input as Record<string, unknown>)
						: {};
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: safeStringify(part.input),
					},
				});
				contentBlocks.push({
					type: 'tool_use',
					id: part.callId,
					name: part.name,
					input: inputObj,
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				toolResults.push(normalizeToolResult(part));
			}
		}

		if (role === 'assistant') {
			if (contentBlocks.length > 0) {
				const replayMarker = isThinkingModel ? parseFirstReplayMarker(message) : undefined;
				const reasoningText = getReasoningContent(replayMarker, thinkingContent);

				const assistantBlocks: AnthropicContentBlock[] = [];
				if (isThinkingModel && reasoningText) {
					assistantBlocks.push({
						type: 'thinking',
						thinking: reasoningText,
					});
				}
				assistantBlocks.push(...contentBlocks);

				resultMessages.push({
					role: 'assistant',
					content: assistantBlocks,
				});
			}
		} else {
			if (contentBlocks.length > 0) {
				resultMessages.push({
					role: 'user',
					content: contentBlocks,
				});
			}
		}

		// Tool result messages are added as 'user' content blocks in Anthropic API
		for (const tr of toolResults) {
			resultMessages.push({
				role: 'user',
				content: [convertToolResultContent(tr, nativeImageInput)],
			});
		}
	}

	return {
		system: systemPrompt || undefined,
		messages: resultMessages,
	};
}

function convertToolResultContent(
	toolResult: NormalizedToolResult,
	nativeImageInput: boolean,
): AnthropicContentBlock {
	const hasImages = toolResult.parts.some((part) => part.type === 'image');
	if (!nativeImageInput || !hasImages) {
		const text = toolResult.parts
			.filter((part) => part.type === 'text')
			.map((part) => part.text)
			.join('');
		const textContent =
			text ||
			(toolResult.originalContent.length > 0
				? safeStringify(toolResult.originalContent)
				: '');

		return {
			type: 'tool_result',
			tool_use_id: toolResult.callId,
			content: textContent,
		};
	}

	const blocks: Array<
		import('../types').AnthropicTextBlock | import('../types').AnthropicImageBlock
	> = [];
	for (const part of toolResult.parts) {
		if (part.type === 'text') {
			blocks.push({ type: 'text', text: part.text });
		} else if (part.type === 'image') {
			blocks.push({
				type: 'image',
				source: {
					type: 'base64',
					media_type: part.mimeType,
					data: Buffer.from(part.data).toString('base64'),
				},
			});
		}
	}

	return {
		type: 'tool_result',
		tool_use_id: toolResult.callId,
		content: blocks,
	};
}

function getReasoningContent(
	replayMarker: ReturnType<typeof parseFirstReplayMarker>,
	thinkingContent: string,
): string {
	if (replayMarker?.valid && replayMarker.reasoningText) {
		return replayMarker.reasoningText;
	}
	return thinkingContent;
}

function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

function normalizeThinkingPartText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}

function mapRole(
	role: vscode.LanguageModelChatMessageRole,
): 'user' | 'assistant' | 'system' {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			return role === 3 ? 'system' : 'user';
	}
}

/**
 * Convert VS Code tool definitions to Anthropic format.
 */
export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): AnthropicTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: (tool.inputSchema as Record<string, unknown>) || {
			type: 'object',
			properties: {},
		},
	}));
}

/**
 * Count total characters across all messages for chars-per-token calibration.
 */
export function countMessageChars(messages: AnthropicMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		if (typeof msg.content === 'string') {
			total += msg.content.length;
		} else if (Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === 'text') {
					total += block.text.length;
				} else if (block.type === 'thinking') {
					total += block.thinking.length;
				} else if (block.type === 'tool_use') {
					total += block.name.length + safeStringify(block.input).length;
				}
			}
		}
	}
	return total;
}
