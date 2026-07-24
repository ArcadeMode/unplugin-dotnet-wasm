if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

export const windowPolyfillApplied = true;
