import { createVitestConfig } from './vitest.base.config';

export default createVitestConfig(['**/*.test.ts'], 'integration');
