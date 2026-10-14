import { describe, expect, it } from 'vitest';
import { flightDestination, phaseAfterJump } from './flight';

describe('station flight handoff', () => {
  const worlds = [{ address: '0xAbC' }, { address: '0xDef' }];
  it('finishes the jump for free flight instead of waiting for an absent approach', () => {
    expect(phaseAfterJump(flightDestination(worlds, null))).toBe('free');
  });
  it('finishes the jump when a token is no longer in the universe', () => {
    expect(phaseAfterJump(flightDestination(worlds, '0xmissing'))).toBe('free');
  });
  it('approaches the first planet and matches addresses case-insensitively', () => {
    expect(flightDestination(worlds, '0xABC')).toBe(0);
    expect(phaseAfterJump(flightDestination(worlds, '0xABC'))).toBe('approach');
  });
  it('handles an empty catalogue without inventing a destination', () => {
    expect(flightDestination([], '0xABC')).toBeNull();
  });
});
