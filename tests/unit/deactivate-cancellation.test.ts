import assert from 'node:assert/strict';
import test from 'node:test';
import { isExtensionHostShutdownCancellation } from '../../src/provider/deactivate';

// VS Code cancels the in-flight `vscode.lm.selectChatModels` RPC when the
// extension host tears down before it completes, surfacing as an error whose
// name and message are both "Canceled" (`Canceled: Canceled` in logs). That's
// expected shutdown behavior, not a real failure — see src/provider/deactivate.ts.

test('recognizes the "Canceled" error VS Code throws when the extension host shuts down mid-RPC', () => {
	const error = new Error('Canceled');
	error.name = 'Canceled';
	assert.equal(isExtensionHostShutdownCancellation(error), true);
});

test('does not misclassify an ordinary error that merely mentions "Canceled"', () => {
	assert.equal(isExtensionHostShutdownCancellation(new Error('Canceled')), false);
});

test('does not misclassify unrelated errors or non-error values', () => {
	assert.equal(isExtensionHostShutdownCancellation(new TypeError('boom')), false);
	assert.equal(isExtensionHostShutdownCancellation('Canceled'), false);
	assert.equal(isExtensionHostShutdownCancellation(undefined), false);
});
