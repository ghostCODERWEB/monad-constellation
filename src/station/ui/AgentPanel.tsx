'use client';

// Chat with NANSEN AI, the crew robot. Answers stream from Nansen's Research
// Agent through /api/agent (the key stays on the server). Every answer is
// tagged with its source and the Nansen tools the agent used. Nothing here
// trades or touches a wallet: it is research only.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Engine, Subject } from '../engine';
import { SseReader } from '@/lib/sse';
import type { Robot } from '../features/robot';

interface Msg { role: 'you' | 'ai'; text: string; tools: string[]; mode?: 'fast' | 'expert'; error?: string; done?: boolean; stopped?: boolean; credits?: number; about?: string; note?: string }
interface Status { connected: boolean; credits: { fast: number; expert: number }; budget: number; remaining: number }

// The conversation outlives the panel: closing it and coming back keeps the thread.
const memory: { msgs: Msg[]; conversationId: string | null; draft: string; unsent: string; convoAbout: string | null } = { msgs: [], conversationId: null, draft: '', unsent: '', convoAbout: null };

/** Open the robot with a question drafted (not sent: each question costs credits, so the player sends it). */
export function askAgent(engine: Engine, text: string) {
  memory.draft = text;
  engine.setMode('agent');
}

const SUGGEST = [
  'Which tokens is smart money accumulating on Monad right now?',
  'What is driving on-chain activity on Monad this week?',
  'Which Monad tokens had the biggest smart money outflows today?',
  'Summarise the top Monad DEX traders by realised PnL.',
];

/** Minimal, safe formatting for the agent's markdown: paragraphs, bullets, bold, code, https links. */
function link(label: string, href: string, key: number): ReactNode {
  if (!/^https:\/\//.test(href)) return label;
  // Nansen token pages on Monad also get a shuttle shortcut to that world.
  const m = /tokenAddress=(0x[0-9a-fA-F]{40}).*chain=monad|chain=monad.*tokenAddress=(0x[0-9a-fA-F]{40})/.exec(href);
  const addr = m?.[1] ?? m?.[2];
  return (
    <span key={key} className="agent-link">
      <a href={href} target="_blank" rel="noreferrer">{label}</a>
      {addr && <a className="agent-fly" href={`/galaxy?fly=${addr.toLowerCase()}`} title="Fly the shuttle to this world">fly ➤</a>}
    </span>
  );
}
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <b key={i}>{inline(part.slice(2, -2))}</b>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    const l = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (l) return link(l[1], l[2], i);
    return part;
  });
}
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ''))}</li>)}</ul>;
        }
        const h = /^#{1,4}\s+(.*)$/.exec(lines[0]);
        if (h && lines.length === 1) return <h4 key={i}>{inline(h[1])}</h4>;
        return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l.replace(/^#{1,4}\s+/, ''))}</span>)}</p>;
      })}
    </>
  );
}

const pretty = (tool: string) => tool.replace(/^nansen[_-]?/i, '').replace(/[_-]+/g, ' ');

export function AgentPanel({ engine }: { engine: Engine }) {
  const robot = (engine as unknown as { robot?: Robot }).robot;
  const [status, setStatus] = useState<Status | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>(memory.msgs);
  // A question drafted from elsewhere (the PC) wins; otherwise restore what was being typed.
  const [text, setTextRaw] = useState(() => { const d = memory.draft || memory.unsent; memory.draft = ''; return d; });
  const setText = (v: string) => { memory.unsent = v; setTextRaw(v); };
  const [expert, setExpert] = useState(false);
  const [busy, setBusy] = useState(false);
  // The robot knows what you're researching aboard; you can drop that to ask in general.
  const [about, setAbout] = useState<Subject | null>(engine.subject);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [view, setViewState] = useState(robot?.view ?? 1);
  const setView = (v: number) => { setViewState(v); if (robot) robot.view = v; };
  useEffect(() => { robot?.react('nod'); }, [robot]);

  useEffect(() => { fetch('/api/agent').then((r) => r.json()).then(setStatus).catch(() => setStatus({ connected: false, credits: { fast: 200, expert: 750 }, budget: 0, remaining: 0 })); }, []);
  const price = status ? (expert ? status.credits.expert : status.credits.fast) : expert ? 750 : 200;
  /** Why a question can't be sent right now, or null. Every send path checks this. */
  const blocked = !status ? 'Connecting…' : !status.connected ? 'Not connected' : busy ? 'Answering…' : status.remaining < price ? `Today's budget is spent (${status.remaining} of ${status.budget} credits left)` : null;
  useEffect(() => {
    memory.msgs = msgs;
    // Follow the answer only if the reader is already at the bottom.
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTo({ top: el.scrollHeight });
  }, [msgs]);
  useEffect(() => { input.current?.focus(); return () => { abort.current?.abort(); if (robot) { robot.talking = false; robot.thinking = false; } }; }, [robot]);

  const patch = (f: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), f(all[all.length - 1])]);

  async function ask(q: string) {
    q = q.trim();
    if (!q || blocked) return;
    const mode = expert ? 'expert' : 'fast';
    // The upstream conversation remembers its subject; if the subject changed
    // (or was cleared), start a new conversation rather than let "it" mean the old one.
    const aboutKey = about?.address ?? null;
    let note: string | undefined;
    if (memory.conversationId && memory.convoAbout !== aboutKey) {
      memory.conversationId = null;
      note = about ? `New conversation about ${about.label}.` : 'New conversation: no subject.';
    }
    setText('');
    if (robot) robot.listening = false;
    setBusy(true);
    setMsgs((all) => [...all, { role: 'you', text: q, tools: [], about: about?.label, note }, { role: 'ai', text: '', tools: [], mode }]);
    if (robot) robot.thinking = true;
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: q, conversationId: memory.conversationId, expert, subject: about ? { kind: about.kind, address: about.address, label: about.label } : null }), signal: ctl.signal });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        patch((m) => ({ ...m, error: j.message ?? `The agent returned ${r.status}.`, done: true }));
        return;
      }
      const charged = Number(r.headers.get('x-agent-credits') ?? 0) || undefined;
      const left = r.headers.get('x-agent-remaining');
      if (left != null) setStatus((st) => st && { ...st, remaining: Number(left) });
      patch((m) => ({ ...m, credits: charged }));
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      const sse = new SseReader();
      let got = false;
      const handle = (events: string[]) => {
        for (const data of events) {
          if (data === '[DONE]') continue;
          let ev: { type?: string; text?: string; name?: string; conversation_id?: string; tool_calls?: unknown[]; error?: string };
          try { ev = JSON.parse(data); } catch { continue; }
          if (ev.type === 'delta' && ev.text) {
            got = true;
            if (robot) { robot.thinking = false; robot.talking = true; }
            patch((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.type === 'tool_call' && ev.name) {
            patch((m) => (m.tools.includes(ev.name!) ? m : { ...m, tools: [...m.tools, ev.name!] }));
          } else if (ev.type === 'finish') {
            if (ev.conversation_id) { memory.conversationId = ev.conversation_id; memory.convoAbout = aboutKey; }
          } else if (ev.type === 'error') {
            got = true;
            patch((m) => ({ ...m, error: ev.error ?? 'The Nansen agent reported an error.' }));
          }
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        handle(sse.push(dec.decode(value, { stream: true })));
      }
      handle(sse.push(dec.decode()));
      handle(sse.end());
      robot?.react(got ? 'nod' : 'alert');
      patch((m) => ({ ...m, done: true, error: m.error ?? (got ? undefined : 'The agent finished without an answer. Nothing to show; try asking again.') }));
      engine.log.add(`ask-${Date.now()}`, 'research', 'Asked Nansen AI', about ? `${q} (about ${about.label})` : q);
    } catch (err) {
      // Stopped by the player (or the panel closed): keep what arrived, marked as stopped.
      if ((err as Error).name === 'AbortError') patch((m) => ({ ...m, done: true, stopped: true }));
      else patch((m) => ({ ...m, error: `Connection lost: ${(err as Error).message}`, done: true }));
    } finally {
      setBusy(false);
      if (robot) { robot.thinking = false; robot.talking = false; }
    }
  }

  const close = () => engine.setMode('walk');
  const fresh = () => { memory.conversationId = null; memory.convoAbout = null; setMsgs([]); };

  return (
    <section className="agent" aria-label="Nansen AI chat">
      <header>
        <img className="agent-mark" src="/brand/nansen-mark.gif" alt="" />
        <div>
          <b>NANSEN AI</b>
          <span>{status === null ? 'Connecting…' : status.connected ? 'Nansen Research Agent · Monad focus' : 'Not connected'}</span>
        </div>
        <div className="agent-views" role="group" aria-label="Camera view">
          {['Face', 'Body', 'Full'].map((n, i) => <button key={n} className={view === i ? 'on' : ''} onClick={() => setView(i)} title={`Camera: ${n} (Alt+${i + 1})`}>{n}</button>)}
        </div>
        <button className="agent-new" onClick={fresh} disabled={busy || msgs.length === 0} title="Start a new conversation">New</button>
        <button className="agent-x" onClick={close} aria-label="Close">✕</button>
      </header>

      <div className="agent-log" ref={scroller}>
        {status && !status.connected && (
          <p className="agent-note">The station’s Nansen key isn’t configured. Add <code>NANSEN_API_KEY</code> to <code>.env.local</code> and restart to talk to the agent.</p>
        )}
        {msgs.length === 0 && (
          <div className="agent-hello">
            <p>Hi, I’m the station’s Nansen AI. Ask me anything about Monad: tokens, smart money, wallets, flows. I answer with Nansen’s on-chain data.</p>
            <div className="agent-sugg">
              {(about ? (about.kind === 'token'
                ? [`What is smart money doing with ${about.label} right now?`, `Who are the biggest holders of ${about.label}, and are any connected?`, `What are the main risks for ${about.label}?`]
                : [`What does the wallet ${about.label} trade, and is it profitable?`, `Which wallets is ${about.label} connected to?`, `What did ${about.label} buy or sell in the last week?`]
              ) : SUGGEST).map((s) => <button key={s} onClick={() => { setText(s); input.current?.focus(); }} disabled={status?.connected === false} title="Puts the question in the box: you send it">{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <article key={i} className={`agent-msg ${m.role}`}>
            {m.role === 'you' && m.note && <p className="agent-note-sys">{m.note}</p>}
            {m.role === 'you' ? <p>{m.text}{m.about && <em className="agent-tag">re {m.about}</em>}</p> : (
              <>
                {m.tools.length > 0 && <div className="agent-tools">{m.tools.map((t) => <span key={t}>⚙ {pretty(t)}</span>)}</div>}
                {m.text ? <Rich text={m.text} /> : !m.error && !m.done && <p className="agent-wait">{m.tools.length ? 'Querying Nansen data…' : 'Thinking…'}</p>}
                {m.stopped && <p className="agent-stopped">{m.text ? 'Stopped: the answer above is partial.' : 'Stopped before an answer arrived.'} Credits may still have been charged.</p>}
                {m.error && (
                  <p className="agent-err">
                    {m.error}
                    {/account' permission|insufficient_scope/.test(m.error) && <><br />Fix: open <a href="https://app.nansen.ai/api" target="_blank" rel="noreferrer">app.nansen.ai/api</a>, give this key the <b>account</b> permission (the Research Agent needs it), then ask again.</>}
                  </p>
                )}
                {m.done && !m.error && !m.stopped && <footer>Source: Nansen Research Agent ({m.mode}){m.credits ? ` · ${m.credits} credits` : ''} · research only, not financial advice</footer>}
              </>
            )}
          </article>
        ))}
      </div>

      <form onSubmit={(ev) => { ev.preventDefault(); ask(text); }}>
        {about && (
          <div className="agent-about">
            About <b>{about.label}</b> <span>{about.source === 'telescope' ? 'from the telescope' : about.source === 'flight' ? 'your last flight' : 'from the PC'}</span>
            <button type="button" onClick={() => setAbout(null)} title="Ask in general instead">✕</button>
          </div>
        )}
        <textarea
          ref={input} value={text} rows={2} maxLength={2000} placeholder="Ask about Monad…"
          onChange={(ev) => { setText(ev.target.value); if (robot && !busy) robot.listening = ev.target.value.length > 0; }}
          onBlur={() => { if (robot) robot.listening = false; }}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ask(text); } }}
          disabled={status?.connected === false}
        />
        <div className="agent-row">
          <label title="Expert runs deeper multi-step analysis; it costs more credits and takes longer.">
            <input type="checkbox" checked={expert} onChange={(ev) => setExpert(ev.target.checked)} /> Expert
          </label>
          <span>{blocked && !busy ? blocked : `About ${price} Nansen credits · ${status?.remaining ?? '…'} of ${status?.budget ?? '…'} left today`}</span>
          {busy ? <button type="button" onClick={() => abort.current?.abort()}>Stop</button> : <button type="submit" disabled={!text.trim() || !!blocked}>Ask</button>}
        </div>
      </form>
    </section>
  );
}
