import { describe, it, expect } from 'vitest';
import { dotnetStaticAssets } from '../unplugin/index.js';

// M1.1 placeholder — real tests land in M1.2 onward.
describe('dotnetStaticAssets', () => {
  it('exports a plugin factory', () => {
    expect(typeof dotnetStaticAssets.vite).toBe('function');
  });
});
