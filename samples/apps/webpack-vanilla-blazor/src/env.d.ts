declare module '*.css';
declare module '*.png';

interface BlazorStartOptions {
  loadBootResource?: (
    type: string,
    name: string,
    defaultUri: string,
    integrity: string,
  ) => string | Promise<Response> | null | undefined;
  [key: string]: unknown;
}

interface BlazorGlobal {
  start(options?: BlazorStartOptions): Promise<void>;
}

interface Window {
  Blazor: BlazorGlobal;
}
