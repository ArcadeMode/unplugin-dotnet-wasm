#!/usr/bin/env node
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const mode = args[0] || 'no-build'; // 'fingerprint-enabled', 'fingerprint-disabled', 'no-build'

const commands = {
  'fingerprint-enabled': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm build:library:fingerprint',
    'pnpm build:fixtures',
    'pnpm test:unit',
    'pnpm test:matrix --integration --fingerprint=true',
    'pnpm test:matrix --e2e --fingerprint=true',
  ],
  'fingerprint-disabled': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm build:library:nofingerprint',
    'pnpm build:fixtures',
    'pnpm test:unit',
    'pnpm test:matrix --integration --fingerprint=false',
    'pnpm test:matrix --e2e --fingerprint=false',
  ],
  'no-build': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm test:matrix --integration --fingerprint=none',
  ],
};

const cmds = commands[mode];
if (!cmds) {
  console.error(`Unknown mode: ${mode}`);
  console.error(`Available modes: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

console.log(`\n🚀 Running tests in mode: ${mode}\n`);

try {
  for (const cmd of cmds) {
    console.log(`\n📍 Running: ${cmd}`);
    execSync(cmd, { stdio: 'inherit', shell: true });
  }
  console.log('\n✅ All tests passed!');
} catch (error) {
  console.error(`\n❌ Test failed with exit code: ${error.status}`);
  process.exit(error.status);
}
