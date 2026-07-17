export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export function createConsoleLogger(
  level: LogLevel = 'warn',
  prefix = '[unplugin-dotnet-wasm]',
): Logger {
  const rank = LEVEL_RANK[level];
  return {
    error: msg => { if (rank >= LEVEL_RANK.error) console.error(`${prefix} ${msg}`); },
    warn:  msg => { if (rank >= LEVEL_RANK.warn)  console.warn(`${prefix} ${msg}`); },
    info:  msg => { if (rank >= LEVEL_RANK.info)  console.info(`${prefix} ${msg}`); },
    debug: msg => { if (rank >= LEVEL_RANK.debug) console.debug(`${prefix} ${msg}`); },
  };
}

export const NULL_LOGGER: Logger = {
  error: () => {},
  warn:  () => {},
  info:  () => {},
  debug: () => {},
};
