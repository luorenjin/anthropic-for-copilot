import type { AnthropicContentBlock, AnthropicMessage } from '../types';

export interface DeepSeekContentToTextOptions {
	includeImageUrls?: boolean;
	separator?: string;
}

export function deepSeekContentToText(
	content: string | AnthropicContentBlock[] | undefined,
	options: DeepSeekContentToTextOptions = {},
): string {
	if (!content) {
		return '';
	}
	if (typeof content === 'string') {
		return content;
	}

	const includeImageUrls = options.includeImageUrls ?? false;
	const separator = options.separator ?? '';

	const parts: string[] = [];
	for (const part of content) {
		if (part.type === 'text') {
			parts.push(part.text);
			continue;
		}
		if (part.type === 'thinking') {
			parts.push(part.thinking);
			continue;
		}
		if (includeImageUrls && part.type === 'image') {
			parts.push(part.source.data);
		}
	}

	return parts.join(separator);
}

export function deepSeekMessageToText(
	message: Pick<AnthropicMessage, 'content'>,
	options?: DeepSeekContentToTextOptions,
): string {
	return deepSeekContentToText(message.content, options);
}
