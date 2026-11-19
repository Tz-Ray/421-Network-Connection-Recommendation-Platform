// screens/AIScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { useShell } from '../components/AppShell';
import { compactIdParts, initials, personIds } from '../lib/presentation';
import {
  visitConversations,
  saveConversation,
  conversationId,
  type AssistantMessage,
} from '../lib/assistantSession';
import '../styles/ai.css';
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
import { AI_FREE_TIER_NOTICE, proxyErrorMessage, proxyFetch, useAiAvailability } from '../lib/proxyClient';

type ChatMsg = AssistantMessage;
const STARTERS = [
  {
    q: 'Who could introduce me to someone at <company>?',
    edit: 'Who could introduce me to someone at <company>?',
  },
  {
    q: 'Which engineering managers have I talked to this year?',
    edit: 'Which <role> have I talked to this year?',
  },
  { q: 'Who works on machine learning or data science?', edit: 'Who works on <topic>?' },
  {
    q: 'Who haven’t I messaged in a while but should?',
    edit: 'Who haven’t I messaged in a while but should?',
  },
];

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

const STOP_WORDS = new Set(
  'who what which is are the a an at in on or and to of for with me my i have has do does could would should someone people know knows works work'.split(
    ' ',
  ),
);
function tokenize(q: string) {
  return q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter((t) => t && !STOP_WORDS.has(t));
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
  if (!resp.ok) throw new Error(await proxyErrorMessage(resp));
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { answer: text, recommendations: [] };
  }
}

function unescapeJsonString(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
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
  signal?: AbortSignal;
}) {
  const resp = await proxyFetch('/gemini/chat', {
    method: 'POST',
    signal: args.signal,
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
  signal?: AbortSignal;
}) {
  const resp = await proxyFetch('/gemini/rerank', {
    method: 'POST',
    signal: args.signal,
    body: JSON.stringify({
      criteria: args.criteria,
      candidates: args.candidates,
      ...(args.context ? { context: args.context } : {}),
    }),
  });
  return await fetchJsonOrThrow(resp);
}

const AIScreen: React.FC = () => {
  const { user } = useAuth();
  const uid = user!.uid;
  const { announce } = useShell();
  const location = useLocation();
  const navigate = useNavigate();
  const ai = useAiAvailability();
  const [initial] = useState(() => visitConversations(uid));
  const [thread, setThread] = useState(() => initial.active || conversationId());
  const [messages, setMessages] = useState<ChatMsg[]>(
    () => initial.threads.find((t) => t.id === initial.active)?.messages || [],
  );
  const [threads, setThreads] = useState(initial.threads);
  const request = useRef<AbortController | null>(null);
  const pending = useRef<{ thread: string; question: string; before: ChatMsg[] } | null>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [replyAnnouncement, setReplyAnnouncement] = useState('');
  const [input, setInput] = useState(() => initial.threads.find((t) => t.id === initial.active)?.draft || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const prefillConsumed = useRef<string | null>(null);
  useEffect(() => {
    saveConversation(uid, thread, messages, input);
    setThreads(visitConversations(uid).threads);
  }, [uid, thread, messages, input]);
  useEffect(() => {
    const log = logRef.current;
    const last = log?.querySelector<HTMLElement>(`[data-message-index="${messages.length - 1}"]`);
    if (log && last && messages.at(-1)?.role === 'assistant') {
      log.scrollTo({
        top: log.scrollTop + last.getBoundingClientRect().top - log.getBoundingClientRect().top - 16,
      });
    } else log?.scrollTo({ top: log.scrollHeight });
  }, [messages, thread]);
  useEffect(
    () => () => {
      request.current?.abort();
      if (pending.current) {
        const p = pending.current;
        saveConversation(uid, p.thread, p.before, p.question);
        pending.current = null;
      }
      request.current = null;
    },
    [uid],
  );
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (!prefill || prefillConsumed.current === location.key) return;
    prefillConsumed.current = location.key;
    setInput(prefill);
    navigate('.', { replace: true, state: null });
    inputRef.current?.focus();
  }, [location.key, location.state, navigate]);
  function restoreQuestion() {
    const p = pending.current;
    if (!p) return;
    setMessages(p.before);
    setInput(p.question);
    saveConversation(uid, p.thread, p.before, p.question);
    pending.current = null;
  }
  function stop(focus = true) {
    request.current?.abort();
    request.current = null;
    restoreQuestion();
    setBusy(false);
    announce('Stopped. You can edit your question and ask again.');
    if (focus) requestAnimationFrame(() => inputRef.current?.focus());
  }
  function switchThread(id?: string) {
    if (request.current) stop(false);
    setError('');
    announce('');
    setReplyAnnouncement('');
    const next = visitConversations(uid).threads.find((t) => t.id === id);
    setThread(next?.id || conversationId());
    setMessages(next?.messages || []);
    setInput(next?.draft || '');
    inputRef.current?.focus();
  }
  useEffect(() => {
    const closeMenu = (e: Event) => {
      const menu = menuRef.current;
      if (!menu?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.contains(e.target as Node)) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('keydown', closeMenu);
    document.addEventListener('pointerdown', closeMenu);
    return () => {
      document.removeEventListener('keydown', closeMenu);
      document.removeEventListener('pointerdown', closeMenu);
    };
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [dataset, setDataset] = useState<CompactConnection[]>([]);
  const datasetIds = useMemo(() => personIds(dataset, compactIdParts), [dataset]);
  const [datasetLoading, setDatasetLoading] = useState(true);

  // Owner context from a LinkedIn export zip (null for CSV/JSON datasets).
  const [networkContext, setNetworkContext] = useState<NetworkContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);

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
    setDatasetLoading(needDataset);
    setContextLoading(needContext);
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

  async function send(override?: string) {
    setError('');
    const userText = (override ?? input).trim();
    if (!userText) return;
    if (busy || request.current || ai.disabled) return;

    if (datasetLoading || contextLoading) {
      setError('Still loading your connections…');
      return;
    }

    if (dataset.length === 0) {
      setError('No connections found. Go to Search and import your LinkedIn export first.');
      return;
    }

    announce('');
    setReplyAnnouncement('');
    pending.current = { thread, question: userText, before: messages };
    setMessages((m) => [...m, { role: 'user', text: userText }]);
    setInput('');
    setBusy(true);
    requestAnimationFrame(() => stopRef.current?.focus());
    const controller = new AbortController();
    request.current = controller;
    const stillHere = () => !controller.signal.aborted && getAuth().currentUser?.uid === uid;

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

      const data = await callGeminiChat({ prompt, history, candidates, context, signal: controller.signal });

      if (!stillHere()) return;

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
        // A refused or failed fallback (e.g. today's AI limit) keeps the chat answer.
        try {
          const rr = await callGeminiRerank({
            criteria: userText,
            candidates,
            context,
            signal: controller.signal,
          });
          if (Array.isArray(rr?.recommendations) && rr.recommendations.length > 0) {
            recommendations = rr.recommendations;
          }
        } catch (fallbackErr) {
          if (!stillHere()) return;
          console.warn('Rerank fallback failed; showing the chat answer as-is.', fallbackErr);
        }
      }

      if (!stillHere()) return;
      const rendered = formatAssistantMessage({
        answer: interpreted.answer || rawAnswer,
        recommendations,
        candidates,
      });

      const answer = (interpreted.answer || rawAnswer).trim();
      const cited = recommendations.length
        ? recommendations.slice(0, 10)
        : !answer
          ? candidates.slice(0, 10).map((c) => ({ id: c.id, reason: 'Local match from your connections.' }))
          : [];
      const people = cited.flatMap((r) => {
        const index = candidates.findIndex((c) => c.id === r.id);
        return index < 0
          ? []
          : [
              {
                person: pool[index].c,
                reason: (r.reason || '').trim(),
                personId: datasetIds[pool[index].idx],
                chip: pool[index].rel.chips[0],
              },
            ];
      });
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: rendered,
          answer:
            answer ||
            (recommendations.length
              ? 'Here are the best matches from your network:'
              : 'The AI returned no answer. Here are the top local matches:'),
          people,
        },
      ]);
      setReplyAnnouncement(
        `${answer || 'Answer ready.'}${people.length ? ` ${people.length} people: ${people.map((p) => p.person.name).join(', ')}.` : ''}`,
      );
    } catch (e: any) {
      if (stillHere()) {
        restoreQuestion();
        setError(
          /fetch|network|load failed/i.test(e?.message || '')
            ? 'Could not reach the assistant. Check your connection and try again.'
            : e?.message || 'Could not get an answer. Please try again.',
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        pending.current = null;
        setBusy(false);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  }

  useEffect(() => {
    const question = location.state?.ask;
    if (
      !question ||
      prefillConsumed.current === location.key ||
      ai.checking ||
      datasetLoading ||
      contextLoading
    )
      return;
    prefillConsumed.current = location.key;
    const { ask, ...state } = location.state;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state });
    if (!ai.disabled && dataset.length) void send(question);
    else {
      setInput(question);
      inputRef.current?.focus();
    }
  }, [location.key, location.state, ai.checking, ai.disabled, datasetLoading, contextLoading]);
  const companyCounts = new Map<string, number>();
  dataset.forEach((p) => {
    if (p.company?.trim()) companyCounts.set(p.company, (companyCounts.get(p.company) || 0) + 1);
  });
  const topCompany = [...companyCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const starters = STARTERS.map((starter, i) =>
    i === 0
      ? {
          ...starter,
          q: topCompany
            ? `Who could introduce me to someone at ${topCompany}?`
            : 'Who could help me make a new connection?',
        }
      : starter,
  );
  const threadButtons = threads.map((t) => (
    <button
      className="side-btn"
      key={t.id}
      title={t.title}
      aria-current={thread === t.id ? 'true' : undefined}
      onClick={(e) => {
        switchThread(t.id);
        e.currentTarget.closest('details')?.removeAttribute('open');
      }}
    >
      <Icon name="chat" />
      <span>{t.title}</span>
    </button>
  ));
  const newButton = (
    <button className="btn sm" onClick={() => switchThread()}>
      <Icon name="plus" />
      New conversation
    </button>
  );
  const unavailable = ai.disabled || ai.checking;
  return (
    <section className="view on ai-view" id="v-ai">
      <div className="ai">
        <nav className="threads" aria-label="Conversations">
          {newButton}
          {threadButtons}
          <p className="hint">Conversations are kept for this visit only.</p>
        </nav>
        <div className="chat">
          <div className="thr-bar">
            <details className="thr-menu" ref={menuRef}>
              <summary>
                <Icon name="chat" />
                Conversations
              </summary>
              <div className="menu">
                {threadButtons}
                {!threads.length && <p className="hint">No conversations yet.</p>}
              </div>
            </details>
            {newButton}
          </div>
          <div className="chat-log" ref={logRef}>
            <div className="chat-inner">
              <p className="sr-only" role="status" aria-live="polite">
                {replyAnnouncement}
              </p>
              {ai.checking && (
                <p className="hint" role="status" data-testid="ai-notice">
                  Checking AI availability…
                </p>
              )}
              {unavailable && !ai.checking && (
                <div className="ai-off">
                  <section className="panel">
                    <div className="panel-b stack">
                      <h2>Assistant unavailable</h2>
                      <p role="status" data-testid="ai-notice">
                        {ai.message}
                      </p>
                      <p>Search, Connections and Network work without AI.</p>
                      <div>
                        <Link className="btn primary" to="/recommender">
                          <Icon name="search" />
                          Go to Search
                        </Link>
                      </div>
                    </div>
                  </section>
                </div>
              )}
              {!unavailable && (datasetLoading || contextLoading) && (
                <p className="hint" role="status">
                  Loading your connections…
                </p>
              )}
              {!unavailable && !datasetLoading && !contextLoading && !dataset.length && (
                <div className="panel">
                  <div className="zero">
                    <h2>Add your connections first</h2>
                    <p>Import your LinkedIn export so the assistant can find people you know.</p>
                    <Link className="btn primary" to="/recommender" state={{ importConnections: true }}>
                      Import your LinkedIn export
                    </Link>
                  </div>
                </div>
              )}
              {!messages.length && !unavailable && dataset.length > 0 && (
                <div>
                  <h2>Ask about your network in plain words</h2>
                  <p className="muted">
                    Answers name real people from your connections. Click a question to ask it, or the pencil
                    to edit it first.
                  </p>
                  <div className="starters">
                    {starters.map((s) => (
                      <div className="starter" key={s.q}>
                        <button
                          className="go"
                          data-testid="ai-starter"
                          disabled={busy || datasetLoading || contextLoading}
                          onClick={() => void send(s.q)}
                        >
                          {s.q}
                        </button>
                        <button
                          className="ed"
                          aria-label={`Edit before asking: ${s.q}`}
                          title="Edit first"
                          onClick={() => {
                            setInput(s.edit);
                            requestAnimationFrame(() => {
                              const field = inputRef.current;
                              field?.focus();
                              const placeholder = /<[^>]+>/.exec(s.edit);
                              if (placeholder)
                                field?.setSelectionRange(
                                  placeholder.index,
                                  placeholder.index + placeholder[0].length,
                                );
                            });
                          }}
                        >
                          <Icon name="pencil" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div className={`msg ${m.role === 'user' ? 'user' : ''}`} data-message-index={i} key={i}>
                  <span className={m.role === 'user' ? 'avatar' : 'logo'} aria-hidden="true">
                    {m.role === 'user' ? initials(user?.displayName || 'You') : <Icon name="spark" />}
                  </span>
                  <div className="msg-b">
                    <div className="who">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                    <p className="message-text">{m.answer ?? m.text}</p>
                    {!!m.people?.length && (
                      <ul className="cite" aria-label="People in this answer">
                        {m.people.map(({ person: p, reason, personId: id, chip }, j) => (
                          <li key={j}>
                            <span className="avatar" aria-hidden="true">
                              {initials(p.name || '')}
                            </span>
                            <span className="t">
                              <b>{p.name || '(no name)'}</b>
                              <span className="tc">
                                {[p.position || 'No title', p.company].filter(Boolean).join(' · ')}
                              </span>
                              {chip && <span className="chip">{chip}</span>}
                              {reason && <span className="r">{reason}</span>}
                            </span>
                            <Link
                              className="btn sm"
                              aria-label={`Open ${p.name || 'unnamed person'}`}
                              to={`/connections?person=${encodeURIComponent(id)}`}
                            >
                              Open
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="thinking" role="status">
                  <span className="dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  Looking through your connections…
                  <button className="btn sm" data-testid="ai-stop" ref={stopRef} onClick={() => stop()}>
                    <Icon name="stop" />
                    Stop
                  </button>
                </div>
              )}
              {error && (
                <p className="note bad" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
          {!unavailable && dataset.length > 0 && (
            <div className="composer">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label className="sr-only" htmlFor="ai-input">
                  Ask the assistant
                </label>
                <input
                  className="input"
                  id="ai-input"
                  data-testid="ai-input"
                  ref={inputRef}
                  autoComplete="off"
                  placeholder={
                    topCompany
                      ? `Ask, e.g. who knows people at ${topCompany}?`
                      : 'Ask about your connections…'
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  readOnly={busy}
                />
                <button
                  className="btn primary"
                  type="submit"
                  data-testid="ai-send"
                  disabled={busy || unavailable || datasetLoading || contextLoading}
                >
                  <Icon name="send" />
                  Ask
                </button>
              </form>
              <p className="hint" role="status">
                {datasetLoading || contextLoading
                  ? 'Loading your connections…'
                  : `${dataset.length.toLocaleString()} connections loaded.`}
              </p>
              <p className="hint ai-privacy-desktop">{AI_FREE_TIER_NOTICE}</p>
              <details className="ai-privacy-phone">
                <summary>What is sent?</summary>
                <p className="hint">{AI_FREE_TIER_NOTICE}</p>
              </details>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
export default AIScreen;
