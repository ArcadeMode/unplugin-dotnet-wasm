import { describe, it, expect } from 'vitest';
import { isYarnPnp } from './is-yarn-pnp';

describe('isYarnPnp', () => {
  it('returns true when pnp version is set', () => {
    expect(isYarnPnp({ pnp: '3' })).toBe(true);
  });

  it('returns true for alternate pnp version strings', () => {
    expect(isYarnPnp({ pnp: '1' })).toBe(true);
  });

  it('returns false when versions is empty', () => {
    expect(isYarnPnp({})).toBe(false);
  });

  it('returns false when pnp is absent', () => {
    const versions: { pnp?: string } = {};
    expect(isYarnPnp(versions)).toBe(false);
  });

  it('returns a boolean when called with no argument', () => {
    const result = isYarnPnp();
    expect(typeof result).toBe('boolean');
  });
});
