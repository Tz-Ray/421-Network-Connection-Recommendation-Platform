// screens/AIScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { SESSION_KEY, docToCompact, loadConnections } from '../lib/connectionsStore';
import type { CompactConnection } from '../lib/connectionsStore';

type ChatMsg = { role: 'user' | 'assistant'; text: string };

type CandidateForModel = {
  id: string; // c0..cN
  name: string;
  position: string;
  company: string;
  email?: string;
  url?: string;
  connectedOn?: string;
};

const MAX_CANDIDATES = 50;
const AI_BASE = (import.meta as any).env?.VITE_AI_PROXY_URL || 'http://localhost:8787';

function tokenize(q: string) {
  return q
    .toLowerCase()
    .split(/[\s,;]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function scoreConnection(c: CompactConnection, tokens: string[]) {
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
  return score;
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
}) {
  const resp = await fetch(`${AI_BASE}/gemini/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: args.prompt,
      messages: args.history,
      candidates: args.candidates,
    }),
  });
  return await fetchJsonOrThrow(resp);
}

async function callGeminiRerank(args: { criteria: string; candidates: CandidateForModel[] }) {
  const resp = await fetch(`${AI_BASE}/gemini/rerank`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      criteria: args.criteria,
      candidates: args.candidates,
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
    if (cached.length) {
      setDataset(cached);
      return;
    }

    const user = getAuth().currentUser;
    if (!user) return;

    if (datasetLoadStarted.current) return;
    datasetLoadStarted.current = true;

    const uid = user.uid;
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
  }, []);

  async function send() {
    setError('');
    const userText = input.trim();
    if (!userText) return;
    if (busy) return;

    if (datasetLoading) {
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
      // Candidate pool from local scoring
      const tokens = tokenize(userText);
      const ranked = dataset
        .map((c, idx) => ({ idx, c, score: scoreConnection(c, tokens) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_CANDIDATES);

      const pool =
        ranked.length > 0
          ? ranked
          : dataset
              .slice(0, Math.min(MAX_CANDIDATES, dataset.length))
              .map((c, idx) => ({ idx, c, score: 0 }));

      // IMPORTANT: sequential ids c0..cN so Gemini behaves
      const candidates: CandidateForModel[] = pool.map((x, i) => ({
        id: `c${i}`,
        name: x.c.name || '(no name)',
        position: x.c.position || '',
        company: x.c.company || '',
        email: x.c.email || '',
        url: x.c.url || '',
        connectedOn: x.c.connectedOn || '',
      }));

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

      const data = await callGeminiChat({ prompt, history, candidates });

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
        const rr = await callGeminiRerank({ criteria: userText, candidates });
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
                disabled={busy}
              />
              <button
                onClick={() => void send()}
                disabled={busy}
                className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
                  busy
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