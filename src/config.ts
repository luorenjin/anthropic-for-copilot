import vscode from 'vscode';
import { CONFIG_SECTION, MODELS } from './consts';
import type { ModelDefinition } from './types';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

/**
 * Get Anthropic API base URL from settings.
 * Falls back to official endpoint when not configured.
 */
export function getBaseUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const settingUrl = config.get<string>('baseUrl')?.trim();
	if (settingUrl && settingUrl !== 'https://api.anthropic.com') {
		return settingUrl;
	}

	const envBaseUrl =
		process.env.ANTHROPIC_BASE_URL ||
		process.env.ANTHROPIC_API_URL ||
		process.env.CLAUDE_BASE_URL;

	if (envBaseUrl?.trim()) {
		return envBaseUrl.trim();
	}

	return settingUrl || 'https://api.anthropic.com';
}

/**
 * Resolve the API model ID to send to the endpoint.
 *
 * Users can override model IDs via the `modelIdOverrides` setting object or
 * environment variables (e.g. from CC-Switch).
 */
export function getApiModelId(vscodeModelId: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const overrides = config.get<Record<string, string>>('modelIdOverrides');
	const override = overrides?.[vscodeModelId]?.trim();
	if (override) {
		return override;
	}

	if (vscodeModelId === 'claude-sonnet-5' && process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim()) {
		return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL.trim();
	}
	if (vscodeModelId === 'claude-opus-5' && process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim()) {
		return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL.trim();
	}
	if (
		(vscodeModelId === 'claude-fable-5-1' || vscodeModelId === 'claude-fable-5.1') &&
		process.env.ANTHROPIC_DEFAULT_FABLE_MODEL?.trim()
	) {
		return process.env.ANTHROPIC_DEFAULT_FABLE_MODEL.trim();
	}
	if (
		(vscodeModelId === 'claude-haiku-4-5' || vscodeModelId === 'claude-haiku-4.5') &&
		process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim()
	) {
		return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL.trim();
	}

	return vscodeModelId;
}

/**
 * Resolve additional custom models defined in `customModels` setting.
 */
export function getCustomModels(): ModelDefinition[] {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const raw = config.get<Array<Record<string, unknown>>>('customModels', []);
	if (!Array.isArray(raw)) return [];

	const models: ModelDefinition[] = [];
	for (const item of raw) {
		if (typeof item === 'object' && item !== null && typeof item.id === 'string' && item.id.trim()) {
			const id = item.id.trim();
			const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;
			const detail = typeof item.detail === 'string' ? item.detail : `Anthropic model ${name}`;
			const maxInputTokens = typeof item.maxInputTokens === 'number' && item.maxInputTokens > 0 ? item.maxInputTokens : 1000000;
			const maxOutputTokens = typeof item.maxOutputTokens === 'number' && item.maxOutputTokens > 0 ? item.maxOutputTokens : 64000;

			models.push({
				id,
				name,
				family: 'claude',
				version: 'custom',
				detail,
				maxInputTokens,
				maxOutputTokens,
				capabilities: {
					toolCalling: true,
					imageInput: true,
					nativeImageInput: true,
					thinking: {
						supportedEfforts: ['low', 'high', 'max'],
						defaultEffort: 'high',
						canDisable: true,
					},
				},
				requiresThinkingParam: false,
			});
		}
	}
	return models;
}

/**
 * Get all available models (built-in + custom + modelIdOverrides keys).
 */
export function getAllModels(): ModelDefinition[] {
	const customModels = getCustomModels();
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const overrides = config.get<Record<string, string>>('modelIdOverrides', {});

	const allMap = new Map<string, ModelDefinition>();

	for (const model of MODELS) {
		allMap.set(model.id, model);
	}

	for (const custom of customModels) {
		allMap.set(custom.id, custom);
	}

	// Auto-register genuinely new model keys in modelIdOverrides as custom models
	if (typeof overrides === 'object' && overrides !== null) {
		for (const [key, apiVal] of Object.entries(overrides)) {
			const k = key.trim();
			if (!k) continue;

			const normalizedK = k.replace(/\./g, '-');
			const isExisting =
				allMap.has(k) ||
				allMap.has(normalizedK) ||
				MODELS.some(
					(m) =>
						m.id === k ||
						m.id === normalizedK ||
						m.id.replace(/\./g, '-') === normalizedK,
				);

			if (!isExisting) {
				allMap.set(k, {
					id: k,
					name: k,
					family: 'claude',
					version: 'custom',
					detail: `Anthropic model ${k} -> ${apiVal}`,
					maxInputTokens: 1000000,
					maxOutputTokens: 64000,
					capabilities: {
						toolCalling: true,
						imageInput: true,
						nativeImageInput: true,
						thinking: {
							supportedEfforts: ['low', 'high', 'max'],
							defaultEffort: 'high',
							canDisable: true,
						},
					},
					requiresThinkingParam: false,
				});
			}
		}
	}

	return Array.from(allMap.values());
}

/**
 * Find a model definition by ID from built-in & custom models,
 * or create a dynamic fallback definition for newly released Anthropic models.
 */
export function getModelDefinition(modelId: string): ModelDefinition {
	const all = getAllModels();
	const found = all.find((m) => m.id === modelId);
	if (found) {
		return found;
	}

	const normalizedId = modelId.replace(/\./g, '-');
	const foundNormalized = all.find((m) => m.id === normalizedId);
	if (foundNormalized) {
		return foundNormalized;
	}

	return {
		id: modelId,
		name: modelId,
		family: 'claude',
		version: 'latest',
		detail: `Anthropic Claude model (${modelId})`,
		maxInputTokens: 1000000,
		maxOutputTokens: 64000,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			nativeImageInput: true,
			thinking: {
				supportedEfforts: ['low', 'high', 'max'],
				defaultEffort: 'high',
				canDisable: true,
			},
		},
		requiresThinkingParam: false,
	};
}

/**
 * Resolve custom HTTP headers to include with API requests.
 * Supports:
 * - Environment variable ANTHROPIC_CUSTOM_HEADERS (string formatted as "Header1: Val1, Header2: Val2" or JSON)
 * - VS Code setting `anthropic-copilot.customHeaders` (object or string)
 */
export function getCustomHeaders(): Record<string, string> {
	let settingValue: unknown;
	try {
		const config = vscode.workspace?.getConfiguration?.(CONFIG_SECTION);
		settingValue = config?.get<unknown>('customHeaders');
	} catch {
		// Non-VS Code test environment
	}

	const headers: Record<string, string> = {};

	const parseHeaderString = (str: string) => {
		const trimmed = str.trim();
		if (!trimmed) return;
		if (trimmed.startsWith('{')) {
			try {
				const parsed = JSON.parse(trimmed);
				if (typeof parsed === 'object' && parsed !== null) {
					for (const [k, v] of Object.entries(parsed)) {
						if (typeof v === 'string') headers[k] = v;
					}
					return;
				}
			} catch {
				// Fall through to key: value parsing
			}
		}
		const lines = trimmed.split(/[\r\n,]+/);
		for (const line of lines) {
			const idx = line.indexOf(':');
			if (idx > 0) {
				const key = line.slice(0, idx).trim();
				const val = line.slice(idx + 1).trim();
				if (key && val) {
					headers[key] = val;
				}
			}
		}
	};

	if (process.env.ANTHROPIC_CUSTOM_HEADERS?.trim()) {
		parseHeaderString(process.env.ANTHROPIC_CUSTOM_HEADERS);
	}

	if (typeof settingValue === 'string') {
		parseHeaderString(settingValue);
	} else if (typeof settingValue === 'object' && settingValue !== null) {
		for (const [k, v] of Object.entries(settingValue)) {
			if (typeof v === 'string' && k.trim()) {
				headers[k.trim()] = v.trim();
			}
		}
	}

	return headers;
}

/**
 * Get configured max output tokens limit.
 * Returns `undefined` when set to 0 (API default — model max output tokens).
 */
export function getMaxTokens(): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<number>('maxTokens', 0);
	return value > 0 ? value : undefined;
}

/**
 * Diagnostic mode. `verbose` also enables metadata logs.
 */
export function getDebugMode(): DebugMode {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const mode = getConfiguredDebugMode(config);
	if (mode) return mode;

	return config.get<boolean>('debug', false) ? 'metadata' : 'minimal';
}

/**
 * Whether to log privacy-preserving diagnostic debug information.
 */
export function getDebugLoggingEnabled(): boolean {
	return getDebugMode() !== 'minimal';
}

/**
 * Whether to write full Anthropic request payloads to disk.
 */
export function getRequestDumpEnabled(): boolean {
	return getDebugMode() === 'verbose';
}

export function getStabilizeToolListEnabled(): boolean {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<boolean>('experimental.stabilizeToolList', false);
}

export async function migrateLegacyDebugSetting(): Promise<void> {
	await migrateLegacyDebugSettingAtScope(vscode.ConfigurationTarget.Global);
	if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
		await migrateLegacyDebugSettingAtScope(vscode.ConfigurationTarget.Workspace);
	}
}

function getConfiguredDebugMode(config: vscode.WorkspaceConfiguration): DebugMode | undefined {
	const mode = config.inspect<unknown>('debugMode');
	return normalizeDebugMode(mode?.workspaceValue) ?? normalizeDebugMode(mode?.globalValue);
}

function normalizeDebugMode(value: unknown): DebugMode | undefined {
	if (value === 'minimal' || value === 'metadata' || value === 'verbose') {
		return value;
	}
	return undefined;
}

async function migrateLegacyDebugSettingAtScope(
	target: vscode.ConfigurationTarget,
	resource?: vscode.Uri,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	const legacy = config.inspect<boolean>('debug');
	const mode = config.inspect<DebugMode>('debugMode');
	const legacyValue = getScopedValue(legacy, target);

	if (legacyValue === undefined) {
		return;
	}

	if (legacyValue === true && getScopedValue(mode, target) === undefined) {
		await config.update('debugMode', 'metadata', target);
	}
	await config.update('debug', undefined, target);
}

function getScopedValue<T>(
	inspection:
		| {
				globalValue?: T;
				workspaceValue?: T;
				workspaceFolderValue?: T;
		  }
		| undefined,
	target: vscode.ConfigurationTarget,
): T | undefined {
	if (!inspection) {
		return undefined;
	}

	if (target === vscode.ConfigurationTarget.Global) {
		return inspection.globalValue;
	}
	if (target === vscode.ConfigurationTarget.Workspace) {
		return inspection.workspaceValue;
	}
	return undefined;
}
