import { describe, expect, it } from 'vitest';
import { hasCycle } from './clusters';

describe('hasCycle', () => {
  it('a single transfer is not a ring', () => {
    expect(hasCycle([1, 2], [{ from: 1, to: 2 }])).toBe(false);
  });
  it('a chain is not a ring', () => {
    expect(hasCycle([1, 2, 3], [{ from: 1, to: 2 }, { from: 2, to: 3 }])).toBe(false);
  });
  it('a round trip is a ring', () => {
    expect(hasCycle([1, 2], [{ from: 1, to: 2 }, { from: 2, to: 1 }])).toBe(true);
  });
  it('a three-way cycle is a ring', () => {
    expect(hasCycle([1, 2, 3], [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 1 }])).toBe(true);
  });
  it('ignores transfers to wallets outside the group and self-transfers', () => {
    expect(hasCycle([1, 2], [{ from: 1, to: 2 }, { from: 2, to: 9 }, { from: 9, to: 1 }, { from: 1, to: 1 }])).toBe(false);
  });
});
