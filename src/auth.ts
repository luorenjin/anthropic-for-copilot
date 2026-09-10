import vscode from 'vscode';
import { getAuthScheme, getBaseUrl, getEnvValue } from './config';
import { API_KEY_SECRET } from './consts';
import { resolveCredentialScheme, type Credential, type CredentialOrigin } from './credentials';
import { t } from './i18n';

/**
 * Manages the Anthropic credential across VS Code SecretStorage, the
 * `~/.claude/settings.json` env block, real environment variables, and
 * extension settings.
 */
export class AuthManager {
	private readonly secretStorage: vscode.SecretStorage;

	constructor(context: vscode.ExtensionContext) {
		this.secretStorage = context.secrets;
	}

	/**
	 * Resolve the credential together with the header scheme it must be sent
	 * under. Relays commonly accept only `Authorization: Bearer`, so losing the
	 * distinction between an auth token and an API key silently breaks them.
	 *
	 * Precedence, mutually exclusive at each step:
	 * 1. `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_AUTH_TOKEN` — sent as a bearer token
	 * 2. `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` — sent as `x-api-key`
	 * 3. SecretStorage (`Anthropic: Set API Key`)
	 * 4. The `anthropic-copilot.apiKey` setting
	 */
	async getCredential(): Promise<Credential | undefined> {
		const baseUrl = getBaseUrl();
		const setting = getAuthScheme();

		const resolved =
			readEnvCredential('auth-token-env', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_AUTH_TOKEN') ??
			readEnvCredential('api-key-env', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY') ??
			(await this.readStoredCredential());

		if (!resolved) {
			return undefined;
		}

		return {
			value: resolved.value,
			origin: resolved.origin,
			scheme: resolveCredentialScheme(resolved.origin, baseUrl, setting),
		};
	}

	/**
	 * Store API key in SecretStorage.
	 */
	async setApiKey(apiKey: string): Promise<void> {
		await this.secretStorage.store(API_KEY_SECRET, apiKey.trim());
	}

	/**
	 * Delete stored API key.
	 */
	async deleteApiKey(): Promise<void> {
		await this.secretStorage.delete(API_KEY_SECRET);
	}

	/**
	 * Check if an API key or auth token is available.
	 */
	async hasApiKey(): Promise<boolean> {
		return (await this.getCredential()) !== undefined;
	}

	/**
	 * Prompt user to enter API key via input box.
	 */
	async promptForApiKey(): Promise<boolean> {
		const apiKey = await vscode.window.showInputBox({
			prompt: t('auth.prompt'),
			placeHolder: t('auth.placeholder'),
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return t('auth.emptyValidation');
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(apiKey);
			vscode.window.showInformationMessage(t('auth.saved'));
			return true;
		}

		return false;
	}

	private async readStoredCredential(): Promise<
		{ value: string; origin: CredentialOrigin } | undefined
	> {
		const secretKey = await this.secretStorage.get(API_KEY_SECRET);
		if (secretKey?.trim()) {
			return { value: secretKey.trim(), origin: 'secret-storage' };
		}

		const settingsKey = vscode.workspace
			.getConfiguration('anthropic-copilot')
			.get<string>('apiKey');
		if (settingsKey?.trim()) {
			return { value: settingsKey.trim(), origin: 'setting' };
		}

		return undefined;
	}
}

function readEnvCredential(
	origin: CredentialOrigin,
	...names: string[]
): { value: string; origin: CredentialOrigin } | undefined {
	for (const name of names) {
		const value = getEnvValue(name);
		if (value) {
			return { value, origin };
		}
	}
	return undefined;
}
