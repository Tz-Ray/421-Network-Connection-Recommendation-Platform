// screens/AIScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import {
  COMPANY_KEYS,
  CONNECTED_ON_ISO_KEYS,
  CONNECTED_ON_KEYS,
  CONTEXT_SESSION_KEY,
  EMAIL_KEYS,
  ENDORSEMENT_COUNT_KEYS,
  FIRST_MESSAGED_KEYS,
  FULL_NAME_KEYS,
  INVITATION_KEYS,
  INVITED_AT_KEYS,
  LAST_MESSAGED_KEYS,
  MESSAGE_COUNT_KEYS,
  MESSAGES_RECEIVED_KEYS,
  MESSAGES_SENT_KEYS,
  NOTE_KEYS,
  POSITION_KEYS,
  RECOMMENDED_YOU_KEYS,
  SESSION_KEY,
  URL_KEYS,
  docToCompact,
  loadConnections,
  loadNetworkContext,
  toNetworkContext,
} from '../lib/connectionsStore';
import type { CompactConnection, NetworkContext } from '../lib/connectionsStore';
import { buildAiContext, noteMatches, relationshipSignals } from '../lib/relationship';
import type { Relationship } from '../lib/relationship';
import { AI_DISABLED, AI_DISABLED_MESSAGE, proxyFetch } from '../lib/proxyClient';

type ChatMsg = { role: 'user' | 'assistant'; text: string };

type CandidateForModel = {
  id: string; // c0..cN
  name: string;
  position: string;
  company: string;
  email?: string;
  url?: string;
  connectedOn?: string;
  relationship?: string; // relationshipSignals(...).aiSummary; omitted when empty
};

const MAX_CANDIDATES = 50;

function tokenize(q: string) {
  return q
    .toLowerCase()
    .split(/[\s,;]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function scoreConnection(c: CompactConnection, tokens: string[], rawQuery: string) {
  const name = (c.name ?? '').toLowerCase();
  const position = (c.position ?? '').toLowerCase();
  const company = (c.company ?? '').toLowerCase();

  let score = 0;
  for (const t of tokens) {
    if (!t) continue;
    if (position.includes(t)) score += 4;
    else if (company.includes(t)) score += 2;
    else if (name.includes(t)) score += 1;
  }

  // Whole-word hits in the owner's own note count as relevance (+2 each). The
  // note text itself never leaves this function.
  if (typeof c.note === 'string' && c.note) {
    score += 2 * noteMatches(c.note, rawQuery).length;
  }
  return score;
}

/**
 * docToRow-equivalent for the compact session copy: canonical header keys, so
 * relationshipSignals reads it exactly as it reads an imported row. Enrichment
 * keys are emitted only when the value is known.
 */
function compactToRow(c: CompactConnection): Record<string, unknown> {
  const row: Record<string, unknown> = {
    [FULL_NAME_KEYS[0]]: c.name ?? '',
    [POSITION_KEYS[0]]: c.position ?? '',
    [COMPANY_KEYS[0]]: c.company ?? '',
    [EMAIL_KEYS[0]]: c.email ?? '',
    [URL_KEYS[0]]: c.url ?? '',
    [CONNECTED_ON_KEYS[0]]: c.connectedOn ?? '',
  };

  const put = (keys: string[], v: unknown) => {
    if (v != null) row[keys[0]] = v;
  };
  put(CONNECTED_ON_ISO_KEYS, c.connectedOnIso);
  put(MESSAGE_COUNT_KEYS, c.messageCount);
  put(MESSAGES_SENT_KEYS, c.messagesSent);
  put(MESSAGES_RECEIVED_KEYS, c.messagesReceived);
  put(LAST_MESSAGED_KEYS, c.lastMessagedAt);
  put(FIRST_MESSAGED_KEYS, c.firstMessagedAt);
  put(INVITATION_KEYS, c.invitation);
  put(INVITED_AT_KEYS, c.invitedAt);
  put(NOTE_KEYS, c.note);
  put(ENDORSEMENT_COUNT_KEYS, c.endorsementCount);
  put(RECOMMENDED_YOU_KEYS, c.recommendedYou);

  return row;
}

/** sessionStorage[CONTEXT_SESSION_KEY]: `present` is false when absent or unreadable. */
function contextFromSession(): { present: boolean; ctx: NetworkContext | null } {
  try {
    const raw = sessionStorage.getItem(CONTEXT_SESSION_KEY);
    if (raw == null) return { present: false, ctx: null };
    const parsed = JSON.parse(raw);
    if (parsed === null) return { present: true, ctx: null }; // known: no context
    const ctx = toNetworkContext(parsed);
    return ctx ? { present: true, ctx } : { present: false, ctx: null };
  } catch {
    return { present: false, ctx: null };
  }
}

async function fetchJsonOrThrow(resp: Response) {
  const text = await resp.text();
  try {
    const j = JSON.parse(text);
    if (!resp.ok) throw new Error(j?.error || text);
    return j;
  } catch {
    if (!resp.ok) throw new Error(text);
    return { answer: text, recommendations: [] };
  }
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function tryParseJsonLike(text: string): any | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const maybe = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(maybe);
    } catch {}
  }

  return null;
}

// Lenient extraction for truncated JSON-ish: "answer":".... (maybe missing end quote)
function extractAnswerLenient(text: string): string | null {
  if (!text || typeof text !== 'string') return null;

  const idx = text.search(/"answer"\s*:/i);
  if (idx < 0) return null;

  const colon = text.indexOf(':', idx);
  if (colon < 0) return null;

  let q = -1;
  for (let i = colon + 1; i < text.length; i++) {
    if (text[i] === '"') {
      q = i;
      break;
    }
  }
  if (q < 0) return null;

  let out = '';
  for (let i = q + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next) {
        out += `\\${next}`;
        i++;
      }
      continue;
    }
    if (ch === '"') return unescapeJsonString(out);
    out += ch;
  }

  return unescapeJsonString(out);
}

// Extract recs from JSON-ish text: "id":"c0" ... "reason":"..."
function extractRecsLenient(text: string): Array<{ id: string; reason?: string }> {
  if (!text || typeof text !== 'string') return [];
  const recs: Array<{ id: string; reason?: string }> = [];
  const seen = new Set<string>();

  const re = /"id"\s*:\s*"(c\d+)"[\s\S]*?"reason"\s*:\s*"((?:\\.|[^"\\])*)"/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const reason = unescapeJsonString(m[2] || '');
    recs.push({ id, reason: reason || 'Recommended by AI.' });
    if (recs.length >= 10) break;
  }

  return recs;
}

function interpretModelOutput(raw: string): {
  answer: string;
  recommendations: Array<{ id: string; reason?: string }>;
} {
  const parsed = tryParseJsonLike(raw);
  if (parsed && typeof parsed === 'object') {
    const answer = typeof parsed.answer === 'string' ? parsed.answer : '';
    const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    if (answer || recommendations.length) return { answer, recommendations };
  }

  const answer = extractAnswerLenient(raw);
  const recommendations = extractRecsLenient(raw);

  if (answer || recommendations.length) return { answer: answer || '', recommendations };

  return { answer: raw.trim(), recommendations: [] };
}

function formatAssistantMessage(args: {
  answer: string;
  recommendations: Array<{ id: string; reason?: string }>;
  candidates: CandidateForModel[];
}): string {
  const answer = (args.answer || '').trim();
  const recs = Array.isArray(args.recommendations) ? args.recommendations : [];
  const candidates = args.candidates;

  let out = answer || 'Here are the best matches from your network:';

  if (recs.length) {
    const idToCand = new Map(candidates.map((c) => [c.id, c]));
    const lines: string[] = [];

    for (let i = 0; i < Math.min(10, recs.length); i++) {
      const r = recs[i];
      const c = idToCand.get(r.id);
      if (!c) continue;

      const headline = `${i + 1}. ${c.name} — ${[c.position, c.company].filter(Boolean).join(' • ') || '(no title/company)'}`;
      const why = (r.reason || '').trim();

      if (why) lines.push(`${headline}\n   Why: ${why}`);
      else lines.push(headline);
    }

    if (lines.length) out += `\n\nTop matches:\n${lines.join('\n')}`;
  } else if (!answer) {
    // No answer AND no recs (parse failure / empty model reply): at least show
    // the top 10 local candidates. An honest "nothing relevant" answer with zero
    // recommendations is shown as-is.
    const lines = candidates.slice(0, 10).map((c, i) => {
      return `${i + 1}. ${c.name} — ${[c.position, c.company].filter(Boolean).join(' • ') || '(no title/company)'}`;
    });
    out += `\n\nTop matches (local fallback):\n${lines.join('\n')}`;
  }

  return out;
}

async function callGeminiChat(args: {
  prompt: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  candidates: CandidateForModel[];
  context: string; // buildAiContext(...); omitted when empty
}) {
  const resp = await proxyFetch('/gemini/chat', {
    method: 'POST',
    body: JSON.stringify({
      query: args.prompt,
      messages: args.history,
      candidates: args.candidates,
      ...(args.context ? { context: args.context } : {}),
    }),
  });
  return await fetchJsonOrThrow(resp);
}

async function callGeminiRerank(args: {
  criteria: string;
  candidates: CandidateForModel[];
  context: string; // buildAiContext(...); omitted when empty
}) {
  const resp = await proxyFetch('/gemini/rerank', {
    method: 'POST',
    body: JSON.stringify({
      criteria: args.criteria,
      candidates: args.candidates,
      ...(args.context ? { context: args.context } : {}),
    }),
  });
  return await fetchJsonOrThrow(resp);
}

const AIScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      text: 'Ask me for an intro recommendation. Example: “Find me a VP Sales with B2B SaaS experience.”',
    },
  ]);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [dataset, setDataset] = useState<CompactConnection[]>([]);
  const [datasetLoading, setDatasetLoading] = useState(false);

  // Owner context from a LinkedIn export zip (null for CSV/JSON datasets).
  const [networkContext, setNetworkContext] = useState<NetworkContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // relationshipSignals is query-independent but not cheap with a large owner
  // context, so each connection's result is computed lazily and cached until the
  // dataset, the context or the UTC day changes.
  const relCache = useRef<{
    dataset: CompactConnection[];
    ctx: NetworkContext | null;
    day: string;
    map: Map<CompactConnection, Relationship>;
  } | null>(null);

  // StrictMode mounts effects twice in development; without this the Firestore
  // fallback would issue two reads of the same collection on every mount.
  const datasetLoadStarted = useRef(false);

  useEffect(() => {
    // NOTE: no cleanup-cancel flag here on purpose. Under StrictMode the effect
    // mounts twice; the ref below makes only the first mount fetch, so a cancel
    // flag set by the first cleanup would discard the only in-flight load.
    const fromSession = (): CompactConnection[] => {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as CompactConnection[];
      } catch {
        return [];
      }
    };

    const cached = fromSession();
    if (cached.length) setDataset(cached);

    const cachedCtx = contextFromSession();
    if (cachedCtx.present) setNetworkContext(cachedCtx.ctx);

    const needDataset = cached.length === 0;
    const needContext = !cachedCtx.present;
    if (!needDataset && !needContext) return;

    const user = getAuth().currentUser;
    if (!user) return;

    if (datasetLoadStarted.current) return;
    datasetLoadStarted.current = true;

    const uid = user.uid;

    if (needDataset) {
      setDatasetLoading(true);

      void (async () => {
        try {
          const docs = await loadConnections(uid);

          // Signed out (or switched accounts) while the read was in flight: never
          // publish one account's connections into the next session. The finally
          // block still clears the loading flag.
          if (getAuth().currentUser?.uid !== uid) return;

          const compact = docs.map(docToCompact);
          setDataset(compact);

          try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(compact));
          } catch {
            // sessionStorage blocked; the in-memory dataset still works.
          }
        } catch (e: any) {
          if (getAuth().currentUser?.uid !== uid) return;
          setDataset([]);
          setError(e?.message ?? 'Failed to load your saved connections.');
        } finally {
          setDatasetLoading(false);
        }
      })();
    }

    if (needContext) {
      setContextLoading(true);

      void (async () => {
        try {
          const ctx = await loadNetworkContext(uid);

          // Same rule as the dataset: nothing from a previous account.
          if (getAuth().currentUser?.uid !== uid) return;

          setNetworkContext(ctx);

          try {
            // 'null' records "this account has no context", so the next mount
            // does not read Firestore again.
            sessionStorage.setItem(CONTEXT_SESSION_KEY, JSON.stringify(ctx));
          } catch {
            // sessionStorage blocked; the in-memory context still works.
          }
        } catch {
          // Context is optional: rank and chat without it.
        } finally {
          setContextLoading(false);
        }
      })();
    }
  }, []);

  function relationshipFor(c: CompactConnection, now: Date): Relationship {
    const day = now.toISOString().slice(0, 10);
    let cache = relCache.current;
    if (!cache || cache.dataset !== dataset || cache.ctx !== networkContext || cache.day !== day) {
      cache = { dataset, ctx: networkContext, day, map: new Map() };
      relCache.current = cache;
    }

    let rel = cache.map.get(c);
    if (!rel) {
      rel = relationshipSignals(compactToRow(c), networkContext, now);
      cache.map.set(c, rel);
    }
    return rel;
  }

  async function send() {
    setError('');
    const userText = input.trim();
    if (!userText) return;
    if (busy) return;

    if (datasetLoading || contextLoading) {
      setError('Still loading your connections…');
      return;
    }

    if (dataset.length === 0) {
      setError('No network dataset found. Go to Recommender → Confirm Connections first.');
      return;
    }

    setMessages((m) => [...m, { role: 'user', text: userText }]);
    setInput('');
    setBusy(true);

    try {
      // Candidate pool from local scoring. Relevance ranks first; the
      // relationship bonus only breaks ties between equal scores, so it is
      // computed only for rows at or above the pool's cutoff score.
      const now = new Date();
      const tokens = tokenize(userText);
      const scored = dataset
        .map((c, idx) => ({ idx, c, score: scoreConnection(c, tokens, userText) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.idx - b.idx);

      let pool: Array<{ idx: number; c: CompactConnection; score: number; rel: Relationship }>;
      if (scored.length > 0) {
        const cutoff = scored[Math.min(MAX_CANDIDATES, scored.length) - 1].score;
        pool = scored
          .filter((x) => x.score >= cutoff)
          .map((x) => ({ ...x, rel: relationshipFor(x.c, now) }))
          .sort((a, b) => b.score - a.score || b.rel.bonus - a.rel.bonus || a.idx - b.idx)
          .slice(0, MAX_CANDIDATES);
      } else {
        pool = dataset
          .slice(0, Math.min(MAX_CANDIDATES, dataset.length))
          .map((c, idx) => ({ idx, c, score: 0, rel: relationshipFor(c, now) }));
      }

      // IMPORTANT: sequential ids c0..cN so Gemini behaves
      const candidates: CandidateForModel[] = pool.map((x, i) => ({
        id: `c${i}`,
        name: x.c.name || '(no name)',
        position: x.c.position || '',
        company: x.c.company || '',
        email: x.c.email || '',
        url: x.c.url || '',
        connectedOn: x.c.connectedOn || '',
        ...(x.rel.aiSummary ? { relationship: x.rel.aiSummary } : {}),
      }));

      // Owner context for the prompt (never names, schools, follows or job
      // applications; see buildAiContext).
      const context = buildAiContext(networkContext);

      // History (last few turns)
      const history = messages
        .slice(-8)
        .map((m) => ({ role: m.role, text: m.text }))
        .concat([{ role: 'user', text: userText }]);

      // Prompt: force candidate list behavior (plain English answer + REQUIRED recommendations)
      const prompt =
        `${userText}\n\n` +
        `Rules:\n` +
        `- Use ONLY the provided candidates.\n` +
        `- After your short answer, list up to 10 recommendations from the candidates.\n` +
        `- For each recommendation, include the candidate id (like c0) and a 1-sentence reason.\n` +
        `- Do not ask follow-up questions unless there are truly zero plausible candidates.\n`;

      const data = await callGeminiChat({ prompt, history, candidates, context });

      // Interpret answer + recs even if JSON-ish / truncated
      const rawAnswer =
        typeof data?.answer === 'string'
          ? data.answer
          : (() => {
              try {
                return JSON.stringify(data);
              } catch {
                return String(data ?? '');
              }
            })();

      const bodyRecs: Array<{ id: string; reason?: string }> = Array.isArray(data?.recommendations)
        ? data.recommendations
        : [];

      const interpreted = interpretModelOutput(rawAnswer);

      // The proxy's own recommendations win. Only when it parsed none do we fall
      // back to whatever the answer string carried, and those ids are unverified
      // (the model can invent one), so drop anything we did not send it.
      const candidateIds = new Set(candidates.map((c) => c.id));
      let recommendations = bodyRecs.length
        ? bodyRecs
        : interpreted.recommendations.filter((r) => candidateIds.has(r.id));

      // Only re-ask via /gemini/rerank when the chat turn actually failed us:
      // `debug` is how the proxy reports it could not parse the model, and an
      // empty answer means it said nothing at all. A real answer with zero
      // recommendations is an honest "nothing relevant here" — show it as-is.
      const chatParseFailed = data?.debug != null;
      const answerEmpty = !String(data?.answer ?? '').trim();

      if (recommendations.length === 0 && (chatParseFailed || answerEmpty)) {
        const rr = await callGeminiRerank({ criteria: userText, candidates, context });
        if (Array.isArray(rr?.recommendations) && rr.recommendations.length > 0) {
          recommendations = rr.recommendations;
        }
      }

      const rendered = formatAssistantMessage({
        answer: interpreted.answer || rawAnswer,
        recommendations,
        candidates,
      });

      setMessages((m) => [...m, { role: 'assistant', text: rendered }]);
    } catch (e: any) {
      setError(e?.message ?? 'AI request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-5xl mx-auto w-full space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white">AI</h1>
            <p className="text-slate-400 mt-1 text-sm">
              Chat with your loaded network. Data comes from Recommender → Confirm Connections.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Dataset status:{' '}
              {datasetLoading ? (
                <span className="text-slate-400 font-bold">Loading your saved connections…</span>
              ) : dataset.length ? (
                <span className="text-primary font-bold">{dataset.length.toLocaleString()} loaded</span>
              ) : (
                <span className="text-red-300 font-bold">not loaded</span>
              )}
            </p>
          </div>

          {AI_DISABLED && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-sm text-slate-200">
              {AI_DISABLED_MESSAGE} Search, ranking and relationship insights on the Recommender page still work.
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="glass-panel rounded-xl p-4 md:p-6 space-y-4">
            <div className="max-h-[520px] overflow-auto custom-scrollbar space-y-3">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${
                    m.role === 'user'
                      ? 'bg-white/5 border-white/10'
                      : 'bg-primary/10 border-primary/20'
                  }`}
                >
                  <div className="text-xs font-bold uppercase tracking-wider mb-2 text-slate-400">
                    {m.role === 'user' ? 'YOU' : 'AI'}
                  </div>
                  <pre className="whitespace-pre-wrap text-sm text-slate-100 font-sans">{m.text}</pre>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask for recommendations..."
                className="flex-1 mac-input rounded-lg p-3 text-sm text-slate-100 placeholder:text-slate-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                disabled={busy || AI_DISABLED}
              />
              <button
                onClick={() => void send()}
                disabled={busy || AI_DISABLED}
                className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
                  busy || AI_DISABLED
                    ? 'bg-white/5 text-slate-600 border border-white/10 cursor-not-allowed'
                    : 'bg-primary hover:bg-primary/90 text-white'
                }`}
              >
                <Icon name="send" className="text-sm" />
                <span>{busy ? 'Thinking…' : 'Send'}</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

export default AIScreen;