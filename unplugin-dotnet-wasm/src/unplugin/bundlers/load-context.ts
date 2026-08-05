/** The `this` context available to a bundler's `load` hook for watch-file registration. */
export type LoadHandlerContext = {
  addWatchFile(id: string): void;
};
