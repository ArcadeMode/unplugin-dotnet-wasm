interface BlazorGlobal {
  start(options?: Record<string, unknown>): Promise<void>;
}

interface Window {
  Blazor: BlazorGlobal;
}
