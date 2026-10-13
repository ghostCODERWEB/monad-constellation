// The mission log: discoveries, Easter eggs, research and EVA events,
// persisted in the browser. A discovery is logged once, however often it is seen.

export type LogKind = 'discovery' | 'egg' | 'research' | 'eva' | 'flight' | 'system';
export interface LogEntry { id: string; kind: LogKind; title: string; text: string; at: number }

const KEY = 'station.missionlog.v1';

export class MissionLog {
  entries: LogEntry[] = [];
  private listeners = new Set<(e: LogEntry[]) => void>();

  constructor() {
    try { this.entries = JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { this.entries = []; }
  }

  has(id: string) { return this.entries.some((e) => e.id === id); }

  /** Adds an entry once per id; returns true if it was new. */
  add(id: string, kind: LogKind, title: string, text: string) {
    if (this.has(id)) return false;
    const e = { id, kind, title, text, at: Date.now() };
    this.entries = [e, ...this.entries].slice(0, 300);
    try { localStorage.setItem(KEY, JSON.stringify(this.entries)); } catch { /* storage blocked */ }
    this.listeners.forEach((l) => l(this.entries));
    return true;
  }

  count(kind: LogKind) { return this.entries.filter((e) => e.kind === kind).length; }

  subscribe(f: (e: LogEntry[]) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
}
