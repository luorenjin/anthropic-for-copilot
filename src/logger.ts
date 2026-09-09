import vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

function getChannel(): vscode.LogOutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('Anthropic', { log: true });
	}
	return channel;
}

function formatMessage(args: unknown[]): string {
	return args
		.map((a) => {
			if (typeof a === 'string') return a;
			if (a instanceof Error) return a.stack ?? a.message;
			try {
				return JSON.stringify(a);
			} catch {
				return String(a);
			}
		})
		.join(' ');
}

export const logger = {
	info: (...args: unknown[]) => {
		try {
			if (typeof vscode.window?.createOutputChannel === 'function') {
				getChannel().info(formatMessage(args));
				return;
			}
		} catch {}
		console.log('[INFO]', ...args);
	},
	warn: (...args: unknown[]) => {
		try {
			if (typeof vscode.window?.createOutputChannel === 'function') {
				getChannel().warn(formatMessage(args));
				return;
			}
		} catch {}
		console.warn('[WARN]', ...args);
	},
	error: (...args: unknown[]) => {
		try {
			if (typeof vscode.window?.createOutputChannel === 'function') {
				getChannel().error(formatMessage(args));
				return;
			}
		} catch {}
		console.error('[ERROR]', ...args);
	},
	debug: (...args: unknown[]) => {
		try {
			if (typeof vscode.window?.createOutputChannel === 'function') {
				getChannel().debug(formatMessage(args));
				return;
			}
		} catch {}
		console.debug('[DEBUG]', ...args);
	},
	show: () => {
		try {
			if (typeof vscode.window?.createOutputChannel === 'function') getChannel().show();
		} catch {}
	},
	dispose: () => {
		try {
			channel?.dispose();
		} catch {}
		channel = undefined;
	},
};
