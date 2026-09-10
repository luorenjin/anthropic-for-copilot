const MESSAGES_PATH = '/v1/messages';
const ENDPOINT_SUFFIXES = ['/v1/messages', '/messages', '/v1'] as const;

/**
 * The SDK appends `/v1/messages` to its `baseURL`, so any endpoint path the
 * user pasted has to come off first or the request doubles up the segment.
 */
export function normalizeSdkBaseUrl(baseUrl: string): string {
	const trimmed = trimTrailingSlashes(baseUrl.trim());
	const lowered = trimmed.toLowerCase();

	for (const suffix of ENDPOINT_SUFFIXES) {
		if (lowered.endsWith(suffix)) {
			return trimTrailingSlashes(trimmed.slice(0, -suffix.length));
		}
	}

	return trimmed;
}

/** The URL the SDK will actually request, for logging and diagnostics. */
export function buildMessagesEndpoint(baseUrl: string): string {
	return `${normalizeSdkBaseUrl(baseUrl)}${MESSAGES_PATH}`;
}

function trimTrailingSlashes(value: string): string {
	return value.replace(/\/+$/u, '');
}
