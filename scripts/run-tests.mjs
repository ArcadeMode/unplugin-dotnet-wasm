#!/usr/bin/env node
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const filter = args[0] || ''; // '' for all, or filter by name

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

let cmds;
if (filter === '') {
  // Run all test suites in sequence
  cmds = [
    ...commands['no-build'],
    ...commands['fingerprint-enabled'],
    ...commands['fingerprint-disabled'],
  ];
} else if (commands[filter]) {
  cmds = commands[filter];
} else {
  console.error(`Unknown filter: ${filter}`);
  console.error(`Available filters: ${Object.keys(commands).join(', ')}, or '' for all`);
  process.exit(1);
}

const displayName = filter || 'all test suites';
console.log(`\n🚀 Running tests: ${displayName}\n`);

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
