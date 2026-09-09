import type { AnthropicContentBlock, AnthropicMessage } from '../types';

export interface AnthropicContentToTextOptions {
	includeImageUrls?: boolean;
	separator?: string;
}

export function anthropicContentToText(
	content: string | AnthropicContentBlock[] | undefined,
	options: AnthropicContentToTextOptions = {},
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

export function anthropicMessageToText(
	message: Pick<AnthropicMessage, 'content'>,
	options?: AnthropicContentToTextOptions,
): string {
	return anthropicContentToText(message.content, options);
}
