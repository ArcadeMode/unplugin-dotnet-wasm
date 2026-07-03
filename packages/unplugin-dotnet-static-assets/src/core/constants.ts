export const BINARY_EXTENSIONS = new Set(['.wasm', '.dat', '.pdb']);

// .NET SDK output conventions: all dotnet framework files live under a
// `_framework/` directory. These patterns help scope bundler rules.
export const FRAMEWORK_BINARY_REGEX = /[\\/]_framework[\\/][^\\/]+\.(wasm|dat|pdb)$/;
export const FRAMEWORK_JS_REGEX = /[\\/]_framework[\\/]dotnet(?:\.[^\\/]+)?\.js$/;

// Node.js built-ins referenced in dotnet.native.js — guarded by ENVIRONMENT_IS_NODE
// so never executed in browsers, but cause build errors in bundlers, defined here to help deal with them.
export const DOTNET_NODE_BUILTINS = ['module', 'process', 'fs', 'path', 'url', 'worker_threads'] as const;
