import vscode from 'vscode';
import { AuthManager } from '../auth';
import { getBaseUrl, getStabilizeToolListEnabled } from '../config';
import { MODELS } from '../consts';
import { isOfficialDeepSeekBaseUrl, normalizeBaseUrl } from '../endpoint';
import { t } from '../i18n';
import { logger } from '../logger';
import { createCacheDiagnosticsRecorder, dumpProviderInput } from './debug';
import { toChatInfo } from './models';
import { BalanceCurrencyResolver } from './pricing/currency';
import { PricingRefreshScheduler } from './pricing/schedule';
import { prepareChatRequest } from './request';
import { classifyProviderRequest } from './routing';
import { resolveConversationSegment } from './segment';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { processToolFlow } from './tools/flow';
import { createVisionService } from './vision';

/**
 * Anthropic Chat Provider — implements vscode.LanguageModelChatProvider so
 * Anthropic Claude models (Sonnet 5, Opus 5, Fable 5.1, Claude 3.7 Sonnet) appear directly in Copilot Chat model picker.
 */
export class AnthropicChatProvider implements vscode.LanguageModelChatProvider {
	private readonly authManager: AuthManager;
	private readonly globalStorageUri: vscode.Uri;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private readonly cacheDiagnostics = createCacheDiagnosticsRecorder();

	private readonly vision: ReturnType<typeof createVisionService>;
	private readonly balanceCurrencyResolver: BalanceCurrencyResolver;
	private readonly pricingRefreshScheduler: PricingRefreshScheduler;

	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);
		this.globalStorageUri = context.globalStorageUri;
		this.vision = createVisionService(context);
		this.balanceCurrencyResolver = new BalanceCurrencyResolver(context, this.authManager, () =>
			this.onDidChangeLanguageModelChatInformationEmitter.fire(),
		);
		this.pricingRefreshScheduler = new PricingRefreshScheduler(() =>
			this.onDidChangeLanguageModelChatInformationEmitter.fire(),
		);

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			this.pricingRefreshScheduler,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration('anthropic-copilot.apiKey') ||
					e.affectsConfiguration('anthropic-copilot.baseUrl')
				) {
					this.invalidateCurrencyAndRefreshModels();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === 'anthropic-copilot.apiKey') {
					this.invalidateCurrencyAndRefreshModels();
				}
			}),
		);
	}

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.invalidateCurrencyAndRefreshModels();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.invalidateCurrencyAndRefreshModels();
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	private invalidateCurrencyAndRefreshModels(): void {
		void this.balanceCurrencyResolver
			.invalidate()
			.catch((error) => logger.warn('Failed to invalidate balance currency', error))
			.finally(() => this.onDidChangeLanguageModelChatInformationEmitter.fire());
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();

		try {
			await vscode.lm.selectChatModels({ vendor: 'anthropic' });
		} catch (error) {
			logger.warn('Failed to refresh Anthropic models during deactivate', error);
		}
	}

	async setVisionModel(): Promise<void> {
		await this.vision.openConfiguration();
	}

	// ---- LanguageModelChatProvider ----

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		const hasKey = await this.authManager.hasApiKey();
		const pricingCurrency = this.balanceCurrencyResolver.getDisplayCurrency();
		const showPricingNotice = isOfficialDeepSeekBaseUrl(normalizeBaseUrl(getBaseUrl()));
		const now = new Date();
		if (hasKey) {
			this.balanceCurrencyResolver.refreshInBackground();
		}
		return MODELS.map((model) =>
			toChatInfo(model, hasKey, pricingCurrency, now, showPricingNotice),
		);
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const segment = resolveConversationSegment(messages);
		const requestKind = classifyProviderRequest({
			messages,
			tools: options.tools,
		});

		dumpProviderInput({
			globalStorageUri: this.globalStorageUri,
			segment,
			modelInfo,
			messages,
			requestOptions: options,
			requestKind,
		});

		const toolFlow = processToolFlow({
			stabilizeToolList: getStabilizeToolListEnabled(),
			messages,
			tools: options.tools,
			progress,
			requestKind,
		});
		if (toolFlow.preflightHandled) {
			return;
		}

		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			globalStorageUri: this.globalStorageUri,
			modelInfo,
			segment,
			messages: toolFlow.messages,
			options,
			token,
			cacheDiagnostics: this.cacheDiagnostics,
			getVisionDescriber: () => this.vision.get(),
		});

		return streamChatCompletion({
			prepared,
			progress,
			token,
			initialResponseNotice: joinInitialResponseNotices(
				toolFlow.initialResponseNotice,
				prepared.initialResponseNotice,
			),
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (charsPerToken) => {
				this.charsPerToken = charsPerToken;
			},
		});
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}
}

export { AnthropicChatProvider as DeepSeekChatProvider };

function joinInitialResponseNotices(...notices: (string | undefined)[]): string | undefined {
	const joined = notices.filter((notice) => notice && notice.trim().length > 0).join('\n');
	return joined || undefined;
}
