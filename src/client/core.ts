import type { CancellationToken } from 'vscode';
import { safeStringify } from '../json';
import { logger } from '../logger';
import type {
	AnthropicRequest,
	AnthropicUsage,
	DeepSeekToolCall,
	StreamCallbacks,
} from '../types';
import { createHttpError, formatRequestError, normalizeRequestError } from './error';

/**
 * Lightweight SSE-streaming Anthropic Messages API client.
 * Uses Node's built-in fetch.
 */
export class AnthropicClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
	) {}

	/**
	 * Stream a chat completion from the Anthropic Messages API.
	 * Parses SSE events and dispatches callbacks for content, thinking, and tool calls.
	 */
	async streamChatCompletion(
		request: AnthropicRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			controller.abort();
		});
		if (cancellationToken?.isCancellationRequested) {
			controller.abort();
		}

		try {
			const endpoint = normalizeAnthropicMessagesEndpoint(this.baseUrl);

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
				Authorization: `Bearer ${this.apiKey}`,
			};

			const response = await fetch(endpoint, {
				method: 'POST',
				headers,
				body: safeStringify(request),
				signal: controller.signal,
			});

			if (!response.ok) {
				throw await createHttpError(response, { baseUrl: this.baseUrl, request });
			}

			if (!response.body) {
				throw new Error('No response body received');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			const latestUsage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };

			const pendingToolCalls = new Map<number, DeepSeekToolCall>();
			const blockTypes = new Map<number, 'text' | 'thinking' | 'tool_use'>();

			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					controller.abort();
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();

					if (!trimmed || trimmed.startsWith(':')) {
						continue;
					}

					if (trimmed.startsWith('event: ')) {
						continue;
					}

					if (!trimmed.startsWith('data: ')) {
						continue;
					}

					const jsonStr = trimmed.slice(6);
					if (jsonStr === '[DONE]') {
						flushPendingToolCalls(pendingToolCalls, callbacks);
						reportFinalUsage(callbacks, latestUsage);
						callbacks.onDone();
						return;
					}

					try {
						const chunk = JSON.parse(jsonStr);

						switch (chunk.type) {
							case 'message_start': {
								if (chunk.message?.usage) {
									accumulateUsage(latestUsage, chunk.message.usage);
								}
								break;
							}

							case 'content_block_start': {
								const index = chunk.index ?? 0;
								const block = chunk.content_block;
								if (block?.type === 'text') {
									blockTypes.set(index, 'text');
									if (block.text) {
										callbacks.onContent(block.text);
									}
								} else if (block?.type === 'thinking') {
									blockTypes.set(index, 'thinking');
									if (block.thinking) {
										callbacks.onThinking(block.thinking);
									}
								} else if (block?.type === 'tool_use') {
									blockTypes.set(index, 'tool_use');
									pendingToolCalls.set(index, {
										id: block.id || `tool_${Date.now()}_${index}`,
										type: 'function',
										function: {
											name: block.name || '',
											arguments: '',
										},
									});
								}
								break;
							}

							case 'content_block_delta': {
								const index = chunk.index ?? 0;
								const delta = chunk.delta;

								if (delta?.type === 'text_delta' && delta.text) {
									callbacks.onContent(delta.text);
								} else if (delta?.type === 'thinking_delta' && delta.thinking) {
									callbacks.onThinking(delta.thinking);
								} else if (delta?.type === 'input_json_delta' && delta.partial_json) {
									const pending = pendingToolCalls.get(index);
									if (pending) {
										pending.function.arguments += delta.partial_json;
									}
								}
								break;
							}

							case 'content_block_stop': {
								const index = chunk.index ?? 0;
								const pending = pendingToolCalls.get(index);
								if (pending) {
									callbacks.onToolCall(pending);
									pendingToolCalls.delete(index);
								}
								break;
							}

							case 'message_delta': {
								if (chunk.usage) {
									accumulateUsage(latestUsage, chunk.usage);
								}
								break;
							}

							case 'message_stop': {
								flushPendingToolCalls(pendingToolCalls, callbacks);
								reportFinalUsage(callbacks, latestUsage);
								callbacks.onDone();
								return;
							}
						}
					} catch (e) {
						logger.error('Failed to parse SSE chunk:', jsonStr.slice(0, 200), e);
					}
				}
			}

			flushPendingToolCalls(pendingToolCalls, callbacks);
			reportFinalUsage(callbacks, latestUsage);
			callbacks.onDone();
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalizedError = normalizeRequestError(error, { baseUrl: this.baseUrl, request });
			logger.error('Anthropic request failed:', formatRequestError(normalizedError));
			callbacks.onError(normalizedError);
		} finally {
			cancelListener?.dispose();
		}
	}
}

export { AnthropicClient as DeepSeekClient };

function normalizeAnthropicMessagesEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	if (trimmed.endsWith('/v1/messages')) {
		return trimmed;
	}
	if (trimmed.endsWith('/v1')) {
		return `${trimmed}/messages`;
	}
	return `${trimmed}/v1/messages`;
}

function flushPendingToolCalls(
	pendingToolCalls: Map<number, DeepSeekToolCall>,
	callbacks: StreamCallbacks,
): void {
	for (const tc of pendingToolCalls.values()) {
		callbacks.onToolCall(tc);
	}
	pendingToolCalls.clear();
}

function accumulateUsage(target: AnthropicUsage, source: Partial<AnthropicUsage>): void {
	if (typeof source.input_tokens === 'number') {
		target.input_tokens = (target.input_tokens || 0) + source.input_tokens;
	}
	if (typeof source.output_tokens === 'number') {
		target.output_tokens = (target.output_tokens || 0) + source.output_tokens;
	}
	if (typeof source.cache_read_input_tokens === 'number') {
		target.cache_read_input_tokens =
			(target.cache_read_input_tokens || 0) + source.cache_read_input_tokens;
	}
	if (typeof source.cache_creation_input_tokens === 'number') {
		target.cache_creation_input_tokens =
			(target.cache_creation_input_tokens || 0) + source.cache_creation_input_tokens;
	}
	target.prompt_tokens = target.input_tokens;
	target.completion_tokens = target.output_tokens;
	target.total_tokens = target.input_tokens + target.output_tokens;
}

function reportFinalUsage(callbacks: StreamCallbacks, usage: AnthropicUsage): void {
	if (!callbacks.onUsage) {
		return;
	}
	callbacks.onUsage(usage);
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}
