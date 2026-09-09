import vscode from 'vscode';
import { logger } from '../logger';
import { AnthropicChatProvider, DeepSeekChatProvider } from '../provider';

export async function registerProvider(
	context: vscode.ExtensionContext,
): Promise<DeepSeekChatProvider> {
	const provider = new AnthropicChatProvider(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('anthropic-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('anthropic-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.commands.registerCommand('anthropic-copilot.setVisionModel', () =>
			provider.setVisionModel(),
		),
		vscode.lm.registerLanguageModelChatProvider('anthropic', provider),
	);

	await activateCopilotChat();
	provider.refreshModelPicker();

	return provider;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
