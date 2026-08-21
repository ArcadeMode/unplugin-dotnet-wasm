import type { DetailedHTMLProps, HTMLAttributes } from 'react';

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

type BlazorCounterElement = HTMLElement & { initial: number };
type BlazorDateTimeElement = HTMLElement & { initial: Date };

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'blazor-counter': DetailedHTMLProps<
        HTMLAttributes<BlazorCounterElement>,
        BlazorCounterElement
      > & { initial?: number };
      'blazor-date-time-now': DetailedHTMLProps<
        HTMLAttributes<BlazorDateTimeElement>,
        BlazorDateTimeElement
      >;
    }
  }
}
