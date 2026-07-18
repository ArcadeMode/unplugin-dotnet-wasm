import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  resolveBin,
  parseMatrixArgs,
  buildConfigs,
  runConfig,
  printSummary,
} from './matrix-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const vitestBin = resolveBin('vitest');

const args = parseMatrixArgs();
const configs = buildConfigs(args);

console.log(`Running ${configs.length} test configuration(s)...`);
console.log(`Fingerprint: ${args.fingerprint} | Build mode: ${args.buildMode}\n`);

const results = configs.map((config, index) =>
  runConfig(config, { cwd: __dirname, vitestBin, index, total: configs.length }),
);

const failed = printSummary(results);
process.exit(failed > 0 ? 1 : 0);
