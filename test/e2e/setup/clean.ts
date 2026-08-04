import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { MATERIALIZED_ROOT } from '@dotnet-wasm-bundler/fixture-builder';

function shardPrefix(): string | null {
  const bundler = process.env.FIXTURE_BUNDLER;
  const platform = process.env.FIXTURE_PLATFORM;
  if (!bundler || bundler === 'all') return null;
  return platform ? `${bundler}-${platform}-` : `${bundler}-`;
}

export function cleanMaterialized(): void {
  const prefix = shardPrefix();
  let entries: string[];
  try {
    entries = readdirSync(MATERIALIZED_ROOT);
  } catch {
    return; // root doesn't exist yet — nothing to clean
  }
  for (const name of entries) {
    if (prefix && !name.startsWith(prefix)) continue;
    rmSync(join(MATERIALIZED_ROOT, name), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

export async function shutdownBuildServers(): Promise<void> {
  await execa('dotnet', ['build-server', 'shutdown'], { reject: false });
}
