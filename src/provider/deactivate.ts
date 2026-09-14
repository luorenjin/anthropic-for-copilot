/**
 * VS Code cancels any in-flight cross-process RPC — including the
 * `vscode.lm.selectChatModels` call `prepareForDeactivate` makes to force a
 * final model-list refresh — once the extension host starts tearing down,
 * before the call has a chance to complete. That surfaces as an error whose
 * `name` and `message` are both `Canceled` (Node prints it as
 * `Canceled: Canceled`), with a stack trace pointing into VS Code's own RPC
 * plumbing rather than this extension. It doesn't indicate a real failure —
 * the model list is being torn down anyway — so it shouldn't be logged as a
 * warning.
 */
export function isExtensionHostShutdownCancellation(error: unknown): boolean {
	return error instanceof Error && error.name === 'Canceled';
}
