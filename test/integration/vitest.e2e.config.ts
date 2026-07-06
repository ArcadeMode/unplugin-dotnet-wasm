import { createVitestConfig } from './vitest.base.config';

export default createVitestConfig(['**/*.e2e.test.ts'], 'e2e-node');
