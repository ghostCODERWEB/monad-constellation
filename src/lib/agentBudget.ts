// The station agent's spending guard: a daily credit budget (UTC day), priced
// per question by mode, plus a limit on questions in flight at once.
//
// Limits, stated plainly: this lives in one server process. A restart starts a
// fresh day's allowance and several instances would each have their own. For a
// public deployment, put a shared atomic store (and authentication) in front.
export interface Ticket { day: string; credits: number }

export class AgentBudget {
  private day = '';
  private spent = 0;
  private inFlight = 0;

  constructor(private budget: () => number, private maxInFlight = 2) {}

  private roll(now: Date) {
    const d = now.toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.spent = 0; }
  }

  remaining(now = new Date()) { this.roll(now); return Math.max(0, this.budget() - this.spent); }

  /** Reserves `credits` for one question, or says why not. */
  reserve(credits: number, now = new Date()): { ok: true; ticket: Ticket } | { ok: false; reason: 'budget' | 'busy' } {
    this.roll(now);
    if (this.inFlight >= this.maxInFlight) return { ok: false, reason: 'busy' };
    if (this.spent + credits > this.budget()) return { ok: false, reason: 'budget' };
    this.spent += credits;
    this.inFlight++;
    return { ok: true, ticket: { day: this.day, credits } };
  }

  /** The question finished (or failed): free its slot; refund if nothing was charged. */
  release(t: Ticket, charged: number | null, now = new Date()) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.roll(now);
    // Credits reserved on an earlier day belong to that day: never touch today's tally.
    if (t.day !== this.day) return;
    if (charged != null) this.spent = Math.max(0, this.spent - t.credits + charged);
  }
}
