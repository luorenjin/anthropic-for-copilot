import Anthropic from '@anthropic-ai/sdk';
import type { CancellationToken } from 'vscode';
import { getCustomHeaders } from '../config';
import { safeStringify } from '../json';
import { logger } from '../logger';
import type {
	AnthropicRequest,
	AnthropicToolCall,
	AnthropicUsage,
	StreamCallbacks,
} from '../types';
import { formatRequestError, normalizeRequestError, sanitizeHeaders } from './error';

/**
 * Anthropic Messages API client built on top of official `@anthropic-ai/sdk`.
 */
export class AnthropicClient {
	private readonly sdk: Anthropic;

	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
	) {
		const customHeaders = getCustomHeaders();
		const sdkBaseUrl = normalizeSdkBaseUrl(this.baseUrl);

		const hasCustomAuthHeader = Object.keys(customHeaders).some((k) =>
			['x-litellm-api-key', 'authorization', 'x-api-key', 'api-key'].includes(k.toLowerCase()),
		);

		const defaultHeaders: Record<string, string | null> = { ...customHeaders };
		if (hasCustomAuthHeader) {
			defaultHeaders['x-api-key'] = null;
			defaultHeaders['authorization'] = null;
			defaultHeaders['Authorization'] = null;
		}

		this.sdk = new Anthropic({
			apiKey: this.apiKey || 'none',
			baseURL: sdkBaseUrl,
			defaultHeaders: defaultHeaders as any,
		});
	}

	/**
	 * Stream a chat completion from the Anthropic Messages API using official SDK stream.
	 */
	async streamChatCompletion(
		request: AnthropicRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const customHeaders = getCustomHeaders();
		const hasCustomAuthHeader = Object.keys(customHeaders).some((k) =>
			['x-litellm-api-key', 'authorization', 'x-api-key', 'api-key'].includes(k.toLowerCase()),
		);

		const headers: Record<string, string | null> = {
			'Content-Type': 'application/json',
			'anthropic-version': '2023-06-01',
			...customHeaders,
		};

		if (!hasCustomAuthHeader && this.apiKey) {
			headers['x-api-key'] = this.apiKey;
			headers['Authorization'] = `Bearer ${this.apiKey}`;
		}

		const headersForLog: Record<string, string> = {};
		for (const [k, v] of Object.entries(headers)) {
			if (v !== null) {
				headersForLog[k] = v;
			}
		}

		const sanitizedCustom = sanitizeHeaders(customHeaders);
		const sanitizedAll = sanitizeHeaders(headersForLog);
		const endpoint = normalizeAnthropicMessagesEndpoint(this.baseUrl);

		logger.info(
			`Initiating Anthropic SDK request: endpoint="${endpoint}" model="${request.model}" ` +
				`customHeaders=${safeStringify(sanitizedCustom)} ` +
				`requestHeaders=${safeStringify(sanitizedAll)}`,
		);

		const pendingToolCalls = new Map<number, AnthropicToolCall>();
		const latestUsage: AnthropicUsage = { input_tokens: 0, output_tokens: 0 };

		try {
			const stream = this.sdk.messages.stream(
				{
					model: request.model,
					max_tokens: request.max_tokens,
					messages: request.messages as any,
					system: request.system as any,
					tools: request.tools as any,
					tool_choice: request.tool_choice as any,
					thinking: request.thinking as any,
					temperature: request.temperature,
					top_p: request.top_p,
				},
				{
					headers: customHeaders,
				},
			);

			const cancelListener = cancellationToken?.onCancellationRequested(() => {
				stream.controller.abort();
			});

			if (cancellationToken?.isCancellationRequested) {
				stream.controller.abort();
				return;
			}

			stream.on('streamEvent', (event) => {
				if (cancellationToken?.isCancellationRequested) {
					stream.controller.abort();
					return;
				}

				switch (event.type) {
					case 'message_start': {
						if (event.message?.usage) {
							accumulateUsage(latestUsage, event.message.usage as any);
						}
						break;
					}

					case 'content_block_start': {
						const index = event.index;
						const block = event.content_block;
						if (block?.type === 'text') {
							if (block.text) {
								callbacks.onContent(block.text);
							}
						} else if (block?.type === 'thinking') {
							if ((block as any).thinking) {
								callbacks.onThinking((block as any).thinking);
							}
						} else if (block?.type === 'tool_use') {
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
						const index = event.index;
						const delta = event.delta;

						if (delta?.type === 'text_delta' && delta.text) {
							callbacks.onContent(delta.text);
						} else if (delta?.type === 'thinking_delta' && (delta as any).thinking) {
							callbacks.onThinking((delta as any).thinking);
						} else if (delta?.type === 'input_json_delta' && delta.partial_json) {
							const pending = pendingToolCalls.get(index);
							if (pending) {
								pending.function.arguments += delta.partial_json;
							}
						}
						break;
					}

					case 'content_block_stop': {
						const index = event.index;
						const pending = pendingToolCalls.get(index);
						if (pending) {
							callbacks.onToolCall(pending);
							pendingToolCalls.delete(index);
						}
						break;
					}

					case 'message_delta': {
						if (event.usage) {
							accumulateUsage(latestUsage, event.usage as any);
						}
						break;
					}

					case 'message_stop': {
						flushPendingToolCalls(pendingToolCalls, callbacks);
						reportFinalUsage(callbacks, latestUsage);
						callbacks.onDone();
						break;
					}
				}
			});

			await stream.done();
			cancelListener?.dispose();

			flushPendingToolCalls(pendingToolCalls, callbacks);
			reportFinalUsage(callbacks, latestUsage);
			callbacks.onDone();
		} catch (error) {
			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				return;
			}
			const normalizedError = normalizeRequestError(error, {
				baseUrl: this.baseUrl,
				request,
				headers: headersForLog,
				customHeaders,
			});
			logger.error('Anthropic SDK request failed:', formatRequestError(normalizedError));
			callbacks.onError(normalizedError);
		}
	}
}

function normalizeSdkBaseUrl(baseUrl: string): string {
	const trimmed = baseUrl.trim().replace(/\/+$/, '');
	if (trimmed.endsWith('/v1/messages')) {
		return trimmed.slice(0, -'/messages'.length);
	}
	if (trimmed.endsWith('/messages')) {
		return trimmed.slice(0, -'/messages'.length);
	}
	if (trimmed === 'https://api.anthropic.com') {
		return 'https://api.anthropic.com/v1';
	}
	return trimmed;
}

function normalizeAnthropicMessagesEndpoint(baseUrl: string): string {
	const sdkBaseUrl = normalizeSdkBaseUrl(baseUrl);
	return `${sdkBaseUrl}/messages`;
}

function flushPendingToolCalls(
	pendingToolCalls: Map<number, AnthropicToolCall>,
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
	if (typeof (source as any).cache_read_input_tokens === 'number') {
		target.cache_read_input_tokens =
			(target.cache_read_input_tokens || 0) + (source as any).cache_read_input_tokens;
	}
	if (typeof (source as any).cache_creation_input_tokens === 'number') {
		target.cache_creation_input_tokens =
			(target.cache_creation_input_tokens || 0) + (source as any).cache_creation_input_tokens;
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
	return (
		(error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError')) ||
		(typeof error === 'object' && error !== null && (error as any).name === 'APIUserAbortError')
	);
}
