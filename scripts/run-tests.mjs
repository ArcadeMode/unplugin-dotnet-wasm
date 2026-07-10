#!/usr/bin/env node
import { execSync } from 'child_process';

const args = process.argv.slice(2);
const filter = args[0] || ''; // '' for all, or filter by name

const commands = {
  'debug-fingerprint': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm build:library:fingerprint',
    'pnpm build:fixtures --mode=debug',
    'pnpm test:unit',
    'pnpm test:matrix --integration --fingerprint=true --build-mode=debug',
    'pnpm test:matrix --e2e --fingerprint=true --build-mode=debug',
  ],
  'debug-nofingerprint': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm build:library:nofingerprint',
    'pnpm build:fixtures --mode=debug',
    'pnpm test:unit',
    'pnpm test:matrix --integration --fingerprint=false --build-mode=debug',
    'pnpm test:matrix --e2e --fingerprint=false --build-mode=debug',
  ],
  'publish-fingerprint': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm publish:library:fingerprint',
    'pnpm build:fixtures --mode=release',
    'pnpm test:matrix --integration --fingerprint=true --build-mode=publish',
    'pnpm test:matrix --e2e --fingerprint=true --build-mode=publish',
  ],
  'publish-nofingerprint': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm publish:library:nofingerprint',
    'pnpm build:fixtures --mode=release',
    'pnpm test:matrix --integration --fingerprint=false --build-mode=publish',
    'pnpm test:matrix --e2e --fingerprint=false --build-mode=publish',
  ],
  'no-build': [
    'pnpm clean:library',
    'pnpm build:plugin',
    'pnpm test:matrix --integration --fingerprint=false --build-mode=none',
  ],
};

let cmds;
if (filter === ''){
  cmds = [
    ...commands['no-build'],
    ...commands['debug-fingerprint'],
    ...commands['debug-nofingerprint'],
    ...commands['publish-fingerprint'],
    ...commands['publish-nofingerprint'],
  ];
} else if (commands[filter]) {
  cmds = commands[filter];
} else {
  console.error(`Unknown filter: ${filter}`);
  console.error(`Available filters: debug-fingerprint, debug-nofingerprint, publish-fingerprint, publish-nofingerprint, no-build, or '' for all`);
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
