import { describe, expect, it } from 'vitest';
import { normalizedHhi, sizeFactor, verdictOf, windShearScore, type Check } from './tokenScore';

const fail = (id: string): Check => ({ id, title: id, status: 'fail', value: '', detail: '' });

describe('normalizedHhi', () => {
  it('reads 0 with no holders and 1 with one holder', () => {
    expect(normalizedHhi([])).toBe(0);
    expect(normalizedHhi([1])).toBe(1);
  });
  it('reads 0 for equal holders', () => {
    expect(normalizedHhi([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0);
  });
});

describe('windShearScore', () => {
  const cap = 1e7;
  it('is 0 when only one side moves', () => {
    expect(windShearScore(5e5, 0, cap)).toBe(0);
    expect(windShearScore(0, -5e5, cap)).toBe(0);
  });
  it('never falls as smart-money selling grows with fresh buying held constant', () => {
    let prev = -1;
    for (const sell of [0, 1e4, 1e5, 5e5, 1e6, 5e6]) {
      const v = windShearScore(5e5, -sell, cap);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it('rises with the joint pattern and stays within 0..100', () => {
    expect(windShearScore(1e5, -1e5, cap)).toBeLessThan(windShearScore(5e5, -5e5, cap));
    expect(windShearScore(1e12, -1e12, cap)).toBeLessThanOrEqual(100);
  });
});

describe('sizeFactor', () => {
  it('trusts the address, not the symbol', () => {
    expect(sizeFactor(2e7, false, '0xee8c0e9f1bffb4eb878d8f15f368a02a35481242')).toBe(0.45);
    expect(sizeFactor(2e7, false, '0x000000000000000000000000000000000000beef')).toBe(1);
  });
});

describe('verdictOf', () => {
  it('a stablecoin with no failing checks is a stablecoin', () => {
    expect(verdictOf('clear', [], true)).toBe('stablecoin');
  });
  it('a stablecoin with failing checks is judged on them', () => {
    expect(verdictOf('clear', [fail('a'), fail('b')], true)).toBe('high');
  });
});
