'use client';

// Chat with NANSEN AI, the crew robot. Answers stream from Nansen's Research
// Agent through /api/agent (the key stays on the server). Every answer is
// tagged with its source and the Nansen tools the agent used. Nothing here
// trades or touches a wallet: it is research only.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Engine } from '../engine';
import type { Robot } from '../features/robot';

interface Msg { role: 'you' | 'ai'; text: string; tools: string[]; mode?: 'fast' | 'expert'; error?: string; done?: boolean }
interface Status { connected: boolean; credits: { fast: number; expert: number }; cap: number }

// The conversation outlives the panel: closing it and coming back keeps the thread.
const memory: { msgs: Msg[]; conversationId: string | null; draft: string } = { msgs: [], conversationId: null, draft: '' };

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
  const [text, setText] = useState(() => { const d = memory.draft; memory.draft = ''; return d; });
  const [expert, setExpert] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { fetch('/api/agent').then((r) => r.json()).then(setStatus).catch(() => setStatus({ connected: false, credits: { fast: 200, expert: 750 }, cap: 0 })); }, []);
  useEffect(() => { memory.msgs = msgs; scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs]);
  useEffect(() => { input.current?.focus(); return () => { abort.current?.abort(); if (robot) { robot.talking = false; robot.thinking = false; } }; }, [robot]);

  const patch = (f: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), f(all[all.length - 1])]);

  async function ask(q: string) {
    q = q.trim();
    if (!q || busy) return;
    const mode = expert ? 'expert' : 'fast';
    setText('');
    setBusy(true);
    setMsgs((all) => [...all, { role: 'you', text: q, tools: [] }, { role: 'ai', text: '', tools: [], mode }]);
    if (robot) robot.thinking = true;
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: q, conversationId: memory.conversationId, expert }), signal: ctl.signal });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        patch((m) => ({ ...m, error: j.message ?? `The agent returned ${r.status}.`, done: true }));
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, cut).trim();
          buf = buf.slice(cut + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let ev: { type?: string; text?: string; name?: string; conversation_id?: string; tool_calls?: unknown[]; error?: string };
          try { ev = JSON.parse(data); } catch { continue; }
          if (ev.type === 'delta' && ev.text) {
            if (robot) { robot.thinking = false; robot.talking = true; }
            patch((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.type === 'tool_call' && ev.name) {
            patch((m) => (m.tools.includes(ev.name!) ? m : { ...m, tools: [...m.tools, ev.name!] }));
          } else if (ev.type === 'finish') {
            if (ev.conversation_id) memory.conversationId = ev.conversation_id;
          } else if (ev.type === 'error') {
            patch((m) => ({ ...m, error: ev.error ?? 'The Nansen agent reported an error.' }));
          }
        }
      }
      patch((m) => ({ ...m, done: true }));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') patch((m) => ({ ...m, error: (err as Error).message, done: true }));
    } finally {
      setBusy(false);
      if (robot) { robot.thinking = false; robot.talking = false; }
    }
  }

  const close = () => engine.setMode('walk');
  const fresh = () => { memory.conversationId = null; setMsgs([]); };
  const cost = status ? (expert ? status.credits.expert : status.credits.fast) : expert ? 750 : 200;

  return (
    <section className="agent" aria-label="Nansen AI chat">
      <header>
        <img className="agent-mark" src="/brand/nansen-mark.gif" alt="" />
        <div>
          <b>NANSEN AI</b>
          <span>{status === null ? 'Connecting…' : status.connected ? 'Nansen Research Agent · Monad focus' : 'Not connected'}</span>
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
              {SUGGEST.map((s) => <button key={s} onClick={() => ask(s)} disabled={busy || status?.connected === false}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <article key={i} className={`agent-msg ${m.role}`}>
            {m.role === 'you' ? <p>{m.text}</p> : (
              <>
                {m.tools.length > 0 && <div className="agent-tools">{m.tools.map((t) => <span key={t}>⚙ {pretty(t)}</span>)}</div>}
                {m.text ? <Rich text={m.text} /> : !m.error && <p className="agent-wait">{m.tools.length ? 'Querying Nansen data…' : 'Thinking…'}</p>}
                {m.error && (
                  <p className="agent-err">
                    {m.error}
                    {/account' permission|insufficient_scope/.test(m.error) && <><br />Fix: open <a href="https://app.nansen.ai/api" target="_blank" rel="noreferrer">app.nansen.ai/api</a>, give this key the <b>account</b> permission (the Research Agent needs it), then ask again.</>}
                  </p>
                )}
                {m.done && !m.error && <footer>Source: Nansen Research Agent ({m.mode}) · research only, not financial advice</footer>}
              </>
            )}
          </article>
        ))}
      </div>

      <form onSubmit={(ev) => { ev.preventDefault(); ask(text); }}>
        <textarea
          ref={input} value={text} rows={2} maxLength={2000} placeholder="Ask about Monad…"
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ask(text); } }}
          disabled={status?.connected === false}
        />
        <div className="agent-row">
          <label title="Expert runs deeper multi-step analysis; it costs more credits and takes longer.">
            <input type="checkbox" checked={expert} onChange={(ev) => setExpert(ev.target.checked)} /> Expert
          </label>
          <span>{cost} Nansen credits a question</span>
          {busy ? <button type="button" onClick={() => abort.current?.abort()}>Stop</button> : <button type="submit" disabled={!text.trim() || status?.connected === false}>Ask</button>}
        </div>
      </form>
    </section>
  );
}
