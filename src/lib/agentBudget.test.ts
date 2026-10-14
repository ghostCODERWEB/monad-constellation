import { describe, expect, it } from 'vitest';
import { AgentBudget } from './agentBudget';

const at = (s: string) => new Date(s);

describe('AgentBudget', () => {
  it('prices questions by mode against a credit budget', () => {
    const b = new AgentBudget(() => 1000);
    const day = at('2026-10-14T10:00:00Z');
    expect(b.reserve(750, day).ok).toBe(true);
    b.release({ day: '2026-10-14', credits: 750 }, 750, day);
    expect(b.reserve(750, day)).toEqual({ ok: false, reason: 'budget' });
    expect(b.reserve(200, day).ok).toBe(true);
  });
  it('refunds a failed question', () => {
    const b = new AgentBudget(() => 200);
    const day = at('2026-10-14T10:00:00Z');
    const r = b.reserve(200, day);
    if (!r.ok) throw new Error('reserve');
    b.release(r.ticket, 0, day);
    expect(b.remaining(day)).toBe(200);
  });
  it('a refund from yesterday never credits today', () => {
    const b = new AgentBudget(() => 400);
    const r = b.reserve(200, at('2026-10-14T23:59:00Z'));
    if (!r.ok) throw new Error('reserve');
    const next = at('2026-10-15T00:01:00Z');
    expect(b.reserve(200, next).ok).toBe(true);
    b.release(r.ticket, 0, next);
    expect(b.remaining(next)).toBe(200);
  });
  it('limits questions in flight', () => {
    const b = new AgentBudget(() => 10_000, 2);
    const day = at('2026-10-14T10:00:00Z');
    expect(b.reserve(200, day).ok).toBe(true);
    expect(b.reserve(200, day).ok).toBe(true);
    expect(b.reserve(200, day)).toEqual({ ok: false, reason: 'busy' });
  });
});
