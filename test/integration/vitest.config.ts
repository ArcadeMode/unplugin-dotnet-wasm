import { createVitestConfig } from './vitest.base.config';

export default createVitestConfig(['**/*.test.ts', '!**/*.e2e.test.ts'], 'integration');
