export const OFFICIAL_ANTHROPIC_API_HOST = 'api.anthropic.com';

export function isOfficialDeepSeekBaseUrl(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname.toLowerCase() === OFFICIAL_ANTHROPIC_API_HOST;
	} catch {
		return false;
	}
}

export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/u, '');
}
