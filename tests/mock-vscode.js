// Mock vscode module for standalone unit testing outside VS Code runtime
const Module = require('node:module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key, defaultValue) => defaultValue,
        }),
      },
      window: {
        createOutputChannel: () => ({
          info: console.log,
          warn: console.warn,
          error: console.error,
          debug: console.debug,
          show: () => {},
          dispose: () => {},
        }),
      },
      env: {
        language: 'en',
      },
    };
  }
  return originalRequire.apply(this, arguments);
};
