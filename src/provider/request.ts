import vscode from 'vscode';
import { AuthManager } from '../auth';
import { AnthropicClient } from '../client';
import { getApiModelId, getBaseUrl, getModelDefinition, getMaxTokens } from '../config';
import { t } from '../i18n';
import type { AnthropicRequest } from '../types';
import { convertMessages, convertTools, countMessageChars } from './convert';
import {
	dumpAnthropicRequest,
	type CacheDiagnosticsRecorder,
	type CacheDiagnosticsRun,
} from './debug';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import type { ReplayMarkerMetadata } from './replay';
import { classifyAnthropicRequest, type RequestKind } from './routing';
import type { ConversationSegment } from './segment';
import {
	finalizeVisionResolutionStats,
	prepareVisionMessages,
	type VisionDescriber,
} from './vision';

export interface PreparedChatRequest {
	client: AnthropicClient;
	request: AnthropicRequest;
	isThinkingModel: boolean;
	totalRequestChars: number;
	hasNativeImages: boolean;
	trailingToolResultIds: string[];
	cacheDiagnostics: CacheDiagnosticsRun;
	requestKind: RequestKind;
	segment: ConversationSegment;
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionMarkerTextChars?: number;
	initialResponseNotice?: string;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	globalStorageUri: vscode.Uri;
	modelInfo: vscode.LanguageModelChatInformation;
	segment: ConversationSegment;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
	cacheDiagnostics: CacheDiagnosticsRecorder;
	getVisionDescriber: () => Promise<VisionDescriber | undefined>;
}

export async function prepareChatRequest({
	authManager,
	globalStorageUri,
	modelInfo,
	segment,
	messages,
	options,
	token,
	cacheDiagnostics,
	getVisionDescriber,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const baseUrl = getBaseUrl();
	const client = new AnthropicClient(baseUrl, apiKey);
	const modelDef = getModelDefinition(modelInfo.id);
	const thinkingCapability = modelDef?.capabilities.thinking;
	const isThinkingModel = Boolean(thinkingCapability);
	const nativeImageInput = modelDef?.capabilities.nativeImageInput === true;
	const configuredMaxTokens = getMaxTokens();
	const maxTokens = configuredMaxTokens || modelDef?.maxOutputTokens || 8192;

	const visionResolution = await prepareVisionMessages({
		messages,
		nativeImageInput,
		token,
		getDescriber: getVisionDescriber,
	});

	const resolvedMessages = visionResolution.messages;
	const { system, messages: anthropicMessages } = convertMessages(
		resolvedMessages,
		isThinkingModel,
		nativeImageInput,
	);

	const tools = convertTools(options.tools);
	const totalRequestChars = countMessageChars(anthropicMessages);
	const hasNativeImages =
		visionResolution.stats.imageHandlingMode === 'native' &&
		visionResolution.stats.input.forwardedImageParts +
			visionResolution.stats.tool.forwardedImageParts >
			0;

	const configuredThinkingEffort = thinkingCapability
		? getConfiguredThinkingEffort(options as ModelConfigurationOptions, thinkingCapability)
		: 'none';

	const thinkingBudget = getThinkingBudgetTokens(configuredThinkingEffort, maxTokens);

	const request: AnthropicRequest = {
		model: getApiModelId(modelInfo.id),
		messages: anthropicMessages,
		system,
		stream: true,
		max_tokens: maxTokens,
		tools,
		tool_choice: tools && tools.length > 0 ? { type: 'auto' } : undefined,
		...(isThinkingModel && configuredThinkingEffort !== 'none'
			? {
					thinking: {
						type: 'enabled',
						budget_tokens: thinkingBudget,
					},
				}
			: {}),
	};

	const requestKind = classifyAnthropicRequest({
		request,
		inputMessages: messages,
	});

	dumpAnthropicRequest(request, {
		globalStorageUri,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort: configuredThinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		requestOptions: options,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
	});

	const diagnosticsRun = cacheDiagnostics.beginRequest({
		request,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort: configuredThinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
	});

	return {
		client,
		request,
		isThinkingModel,
		totalRequestChars,
		hasNativeImages,
		trailingToolResultIds: [],
		cacheDiagnostics: diagnosticsRun,
		requestKind,
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
		initialResponseNotice: visionResolution.initialResponseNotice,
	};
}

function getThinkingBudgetTokens(effort: string, maxTokens: number): number {
	let ratio = 0.25;
	if (effort === 'low') {
		ratio = 0.15;
	} else if (effort === 'max') {
		ratio = 0.6;
	} else if (effort === 'high') {
		ratio = 0.35;
	}
	const computed = Math.floor(maxTokens * ratio);
	const minBudget = 1024;
	const maxBudget = Math.max(1024, maxTokens - 100);
	return Math.min(Math.max(computed, minBudget), maxBudget);
}
