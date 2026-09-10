// Mock vscode module for standalone unit testing outside VS Code runtime.
// Tests drive configuration through globalThis.__vscodeMock.config, keyed by
// the full setting id (e.g. 'anthropic-copilot.baseUrl').
const Module = require('node:module');
const originalRequire = Module.prototype.require;

const mock = {
	config: {},
	language: 'en',
	reset() {
		mock.config = {};
		mock.language = 'en';
	},
};
globalThis.__vscodeMock = mock;

const noopChannel = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	appendLine: () => {},
	show: () => {},
	dispose: () => {},
};

const vscodeStub = {
	workspace: {
		getConfiguration: (section) => ({
			get: (key, defaultValue) => {
				const value = mock.config[section ? `${section}.${key}` : key];
				return value === undefined ? defaultValue : value;
			},
			inspect: (key) => ({
				globalValue: mock.config[section ? `${section}.${key}` : key],
				workspaceValue: undefined,
				workspaceFolderValue: undefined,
			}),
			update: async () => {},
		}),
		onDidChangeConfiguration: () => ({ dispose: () => {} }),
		workspaceFolders: undefined,
		workspaceFile: undefined,
	},
	window: {
		createOutputChannel: () => noopChannel,
		showInformationMessage: () => {},
		showErrorMessage: () => {},
	},
	env: {
		get language() {
			return mock.language;
		},
	},
	ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
};

Module.prototype.require = function (id) {
	if (id === 'vscode') {
		return vscodeStub;
	}
	return originalRequire.apply(this, arguments);
};
