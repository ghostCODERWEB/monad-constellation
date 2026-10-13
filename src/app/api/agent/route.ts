// The station's robot speaks through Nansen's own Research Agent
// (POST /api/v1/agent/fast or /expert), streamed back as server-sent events.
// The key stays here on the server. Every question is framed to Monad: the
// station is a Monad research station and the agent should answer for Monad.
//
// Cost: fast is 200 credits a question, expert 750 (Nansen's prices). A
// per-process daily cap (AGENT_DAILY_CAP, default 40) keeps a stray loop from
// draining the account.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGENT_CREDITS = { fast: 200, expert: 750 } as const;
const MAX = 2000;

let day = '';
let asked = 0;
const cap = () => {
  const n = Number(process.env.AGENT_DAILY_CAP ?? 40);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 40;
};

const json = (status: number, body: unknown) => Response.json(body, { status });

const rollDay = () => {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; asked = 0; }
};

export async function GET() {
  rollDay();
  return json(200, { connected: !!process.env.NANSEN_API_KEY, credits: AGENT_CREDITS, cap: cap(), remaining: Math.max(0, cap() - asked) });
}

export async function POST(req: Request) {
  const key = process.env.NANSEN_API_KEY;
  if (!key) return json(503, { error: 'not-connected', message: 'NANSEN_API_KEY is not set on the server, so the Nansen agent is offline.' });

  let body: { text?: unknown; conversationId?: unknown; expert?: unknown; subject?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'bad-request', message: 'Send JSON.' }); }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 2) return json(400, { error: 'bad-request', message: 'Ask a question.' });
  if (text.length > MAX) return json(400, { error: 'bad-request', message: `Keep it under ${MAX} characters.` });
  const conversationId = typeof body.conversationId === 'string' && body.conversationId.length <= 120 ? body.conversationId : null;
  const mode = body.expert === true ? 'expert' : 'fast';

  // What the player is researching aboard (a token world or wallet), named in the question so the agent knows.
  const sub = body.subject as { kind?: unknown; address?: unknown; label?: unknown } | undefined;
  const subject = sub && (sub.kind === 'token' || sub.kind === 'wallet') && typeof sub.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(sub.address)
    ? { kind: sub.kind, address: sub.address, label: typeof sub.label === 'string' ? sub.label.replace(/[^\w$ .:-]/g, '').slice(0, 40) : '' }
    : null;

  rollDay();
  if (asked >= cap()) return json(429, { error: 'cap', message: `The station's agent has answered its ${cap()} questions for today (AGENT_DAILY_CAP).` });
  asked++;

  // The first question of a conversation carries the Monad framing; follow-ups
  // continue Nansen's own conversation.
  const about = subject ? `I'm currently looking at the Monad ${subject.kind} ${subject.label ? `${subject.label} ` : ''}(${subject.address}); "it" or "this" means that ${subject.kind}.` : '';
  const framed = conversationId
    ? (about ? `${about}\n\n${text}` : text)
    : `Context: I'm researching the Monad blockchain. Answer for Monad unless I explicitly name another chain.${about ? ` ${about}` : ''}\n\nQuestion: ${text}`;

  let up: Response;
  try {
    up = await fetch(`https://api.nansen.ai/api/v1/agent/${mode}`, {
      method: 'POST',
      headers: { apikey: key, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(conversationId ? { text: framed, conversation_id: conversationId } : { text: framed }),
      // Closing the chat cancels the upstream stream too.
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(mode === 'expert' ? 300_000 : 120_000)]),
      cache: 'no-store',
    });
  } catch (e) {
    asked--;
    return json(502, { error: 'upstream', message: `Nansen agent unreachable: ${(e as Error).message}` });
  }
  if (!up.ok || !up.body) {
    const detail = await up.text().catch(() => '');
    if (up.status >= 400) asked--;
    return json(up.status === 402 || up.status === 403 ? up.status : 502, { error: 'upstream', message: `Nansen agent returned ${up.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` });
  }
  return new Response(up.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-agent-mode': mode,
      'x-agent-credits': up.headers.get('x-nansen-credits-cost') ?? String(AGENT_CREDITS[mode]),
      'x-agent-remaining': String(Math.max(0, cap() - asked)),
    },
  });
}
