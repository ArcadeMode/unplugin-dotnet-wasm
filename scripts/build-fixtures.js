#!/usr/bin/env node
const { execSync } = require('child_process');
const bundler = process.argv[2] || '*';
execSync(`pnpm --filter "@dotnet-wasm-bundler/library-app-*-${bundler}-fixture" build`, { stdio: 'inherit' });
