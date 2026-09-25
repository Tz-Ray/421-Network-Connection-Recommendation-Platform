// screens/RecommenderScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import {
  COMPANY_KEYS,
  CONNECTED_ON_KEYS,
  CONTEXT_SESSION_KEY,
  EMAIL_KEYS,
  FIRST_NAME_KEYS,
  FULL_NAME_KEYS,
  LAST_NAME_KEYS,
  POSITION_KEYS,
  SESSION_KEY,
  URL_KEYS,
  docToCompact,
  docToRow,
  getField,
  loadConnections,
  loadNetworkContext,
  parseCsvToObjects,
  rowToDoc,
  saveConnections,
  saveNetworkContext,
} from '../lib/connectionsStore';
import type { CompactConnection, NetworkContext } from '../lib/connectionsStore';
import { parseLinkedInExportZip } from '../lib/linkedinExport';
import type { ImportSummary } from '../lib/linkedinExport';
import { buildAiContext } from '../lib/relationship';
import { rankConnections } from '../lib/search';
import type { RankedRow } from '../lib/search';
import { AI_DISABLED, AI_DISABLED_MESSAGE, proxyFetch } from '../lib/proxyClient';

type Row = Record<string, unknown>;

type CandidateSummary = {
  id: string; // c0..cN
  name: string;
  position: string;
  company: string;
  email?: string;
  url?: string;
  connectedOn?: string;
  relationship?: string;
};

const MAX_RESULTS = 10;
const AI_POOL_SIZE = 50;

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * IMPORTANT FIX:
 * If r.reason comes back as JSON-ish (sometimes the proxy/model nests JSON inside the reason),
 * this extracts the "reason" field WITHOUT truncating at inner quotes.
 */
function extractReasonLenientFromJsonish(text: string): string | null {
  const s = String(text || '');
  const idx = s.search(/"reason"\s*:/i);
  if (idx < 0) return null;

  const colon = s.indexOf(':', idx);
  if (colon < 0) return null;

  // find first quote after colon
  let startQuote = -1;
  for (let i = colon + 1; i < s.length; i++) {
    if (s[i] === '"') {
      startQuote = i;
      break;
    }
  }
  if (startQuote < 0) return null;

  // Scan for an ending quote that looks like the end of this JSON string:
  // i.e., a quote followed by optional whitespace then one of: , } ]
  let out = '';
  for (let i = startQuote + 1; i < s.length; i++) {
    const ch = s[i];

    // handle escaped sequences
    if (ch === '\\') {
      const next = s[i + 1];
      if (next) {
        out += `\\${next}`;
        i++;
      }
      continue;
    }

    if (ch === '"') {
      // potential terminator — check next non-space char
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      const nextCh = s[j];

      if (nextCh === ',' || nextCh === '}' || nextCh === ']' || nextCh === '\n' || nextCh === '\r') {
        return unescapeJsonString(out);
      }

      // Otherwise this quote is likely inside the reason string → keep it
      out += '"';
      continue;
    }

    out += ch;
  }

  // truncated JSON — still return what we captured
  return unescapeJsonString(out);
}

function sanitizeAiReason(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return '';

  // If it's JSON-ish, extract "reason" leniently
  if (s.includes('"reason"')) {
    const extracted = extractReasonLenientFromJsonish(s);
    if (extracted) return extracted;
  }

  // If it looks like a JSON blob but we can't extract a reason, show a shortened raw snippet (still "full-ish")
  if (s.startsWith('{') || s.includes('"recommendations"')) {
    const snippet = s.length > 320 ? `${s.slice(0, 320)}…` : s;
    return snippet;
  }

  return s;
}

// Same shape the account-load path writes (docToCompact), so AIScreen sees the
// enrichment fields however the dataset was confirmed.
function compactRow(row: Row): CompactConnection {
  return docToCompact(rowToDoc(row));
}

async function fetchJsonOrThrow(resp: Response) {
  const text = await resp.text();
  try {
    const j = JSON.parse(text);
    if (!resp.ok) throw new Error(j?.error || text);
    return j;
  } catch {
    if (!resp.ok) throw new Error(text);
    return {};
  }
}

// -----------------------------
// Screen
// -----------------------------
const RecommenderScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const [fileName, setFileName] = useState<string>('');
  const [stagedRows, setStagedRows] = useState<Row[]>([]);
  const [confirmedRows, setConfirmedRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string>('');

  // Owner context from a LinkedIn export zip (null for CSV / JSON / a
  // Connections-only zip). Staged alongside the rows, confirmed with them.
  const [stagedContext, setStagedContext] = useState<NetworkContext | null>(null);
  const [confirmedContext, setConfirmedContext] = useState<NetworkContext | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  const [criteria, setCriteria] = useState<string>('');
  const [results, setResults] = useState<RankedRow[]>([]);

  const [pageSize, setPageSize] = useState<number>(50);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const [aiReranking, setAiReranking] = useState(false);
  const [aiError, setAiError] = useState<string>('');
  const [aiInfo, setAiInfo] = useState<string>('');
  const [saveInfo, setSaveInfo] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const [strictTitleOnly, setStrictTitleOnly] = useState<boolean>(false);

  const hasStaged = stagedRows.length > 0;
  const isConfirmed = confirmedRows.length > 0;
  const canSearch = isConfirmed && criteria.trim().length > 0;

  const stats = useMemo(() => {
    const sample = stagedRows.slice(0, 500);
    const missingTitles = sample.filter((r) => !getField(r, POSITION_KEYS).trim()).length;
    const pctMissing = sample.length ? Math.round((missingTitles / sample.length) * 100) : 0;

    return {
      stagedCount: stagedRows.length,
      confirmedCount: confirmedRows.length,
      colCount: columns.length,
      pctMissingTitle: pctMissing,
    };
  }, [stagedRows, confirmedRows, columns]);

  const previewRows = stagedRows;
  const totalPages = Math.max(1, Math.ceil(previewRows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  const previewSlice = useMemo(() => {
    const start = safePageIndex * pageSize;
    return previewRows.slice(start, start + pageSize);
  }, [previewRows, safePageIndex, pageSize]);

  // Import summary lines (zip only). A coverage line is shown only for files the
  // archive actually had; message coverage only when the owner was detected.
  const importCoverage = useMemo(() => {
    if (!importSummary) return [];
    const used = new Set(importSummary.filesUsed.map((f) => f.name.toLowerCase()));
    const total = importSummary.connections.toLocaleString();
    const m = importSummary.matched;
    const lines: string[] = [];

    if (importSummary.ownerDetected === true) {
      lines.push(`Message history matched to ${m.messages.toLocaleString()} of ${total} connections`);
    }
    if (used.has('invitations.csv')) {
      lines.push(`Invitations matched to ${m.invitations.toLocaleString()} of ${total} connections`);
    }
    if (used.has('notes.csv')) {
      lines.push(`Your notes matched to ${m.notes.toLocaleString()} of ${total} connections`);
    }
    if (used.has('endorsement_received_info.csv')) {
      lines.push(`Endorsements matched to ${m.endorsements.toLocaleString()} of ${total} connections`);
    }
    if (used.has('recommendations_received.csv')) {
      lines.push(`Recommendations matched to ${m.recommendations.toLocaleString()} of ${total} connections`);
    }
    return lines;
  }, [importSummary]);

  // Owner context found in the zip: counts only, never the values.
  const contextCounts = useMemo(() => {
    const c = stagedContext;
    if (!c) return [];
    const items: [number, string, string][] = [
      [c.positions.length, 'position', 'positions'],
      [c.schools.length, 'school', 'schools'],
      [c.skills.length, 'skill', 'skills'],
      [c.followedCompanies.length, 'followed company', 'followed companies'],
      [c.dreamCompanies.length, 'target company', 'target companies'],
      [c.desiredTitles.length, 'desired title', 'desired titles'],
      [c.appliedCompanies.length, 'applied / saved-job company', 'applied / saved-job companies'],
      [c.appliedTitles.length, 'applied / saved-job title', 'applied / saved-job titles'],
    ];
    const out = items.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    if (c.headline) out.unshift('headline');
    if (c.industry) out.unshift('industry');
    return out;
  }, [stagedContext]);

  function resetForNewFile(newFileName: string) {
    setFileName(newFileName);
    setError('');
    setAiError('');
    setAiInfo('');
    setSaveInfo('');
    setResults([]);
    setCriteria('');
    // Also drop the previous staged rows, so they can't be confirmed (without
    // their context) while the new file is still being read.
    setStagedRows([]);
    setColumns([]);
    setConfirmedRows([]);
    setStagedContext(null);
    setConfirmedContext(null);
    setImportSummary(null);
    setPageIndex(0);
  }

  async function handleFile(file: File) {
    datasetVersion.current += 1;
    const version = datasetVersion.current;
    resetForNewFile(file.name);

    // A newer upload, clear, confirm or account load replaced the dataset while
    // this file was being read: drop the result.
    const stale = () => datasetVersion.current !== version;

    try {
      // Reading the file can reject (permissions, the file moved, a decode
      // error); keep that inside the same catch as the parse failures.
      const lowerName = file.name.toLowerCase();

      let parsed: Row[] = [];
      let context: NetworkContext | null = null;
      let summary: ImportSummary | null = null;

      if (lowerName.endsWith('.zip')) {
        // LinkedIn's full data export, unzipped in the browser. Only
        // whitelisted files are decompressed; message text is never kept.
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = parseLinkedInExportZip(bytes, file.name);
        parsed = result.rows;
        context = result.context;
        summary = result.summary;
      } else if (lowerName.endsWith('.json')) {
        const json = JSON.parse(await file.text());
        if (!Array.isArray(json)) throw new Error('JSON must be an array of objects.');

        const objects = json.filter(
          (r: unknown): r is Row =>
            r != null && typeof r === 'object' && !Array.isArray(r)
        );
        if (!objects.length) throw new Error('JSON file must be an array of objects.');

        parsed = objects;
      } else if (lowerName.endsWith('.csv')) {
        parsed = parseCsvToObjects(await file.text());
      } else {
        throw new Error('Unsupported file type. Please upload a .zip, .csv or .json file.');
      }

      if (stale()) return;

      if (!parsed.length) throw new Error('No rows found in file.');

      const colSet = new Set<string>();
      for (const r of parsed.slice(0, 100)) Object.keys(r).forEach((k) => colSet.add(k));

      setStagedRows(parsed);
      setColumns(Array.from(colSet));
      setStagedContext(context);
      setImportSummary(summary);
    } catch (e: any) {
      if (stale()) return;
      setStagedRows([]);
      setConfirmedRows([]);
      setColumns([]);
      setError(e?.message ?? 'Failed to parse file.');
    }
  }

  function confirmConnections() {
    if (!hasStaged) return;
    if (saving) return; // a save for this dataset is already in flight

    datasetVersion.current += 1;
    const contextToSave = stagedContext;
    setConfirmedRows(stagedRows);
    setConfirmedContext(contextToSave);
    setResults([]);
    setCriteria('');
    setAiError('');

    try {
      // Drop the previous context first so a failed write below can never
      // pair it with the new rows. 'null' records "this dataset has no
      // context", so AIScreen does not wait on Firestore for it.
      sessionStorage.removeItem(CONTEXT_SESSION_KEY);
      const compact = stagedRows.map(compactRow);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(compact));
      sessionStorage.setItem(CONTEXT_SESSION_KEY, JSON.stringify(contextToSave));
      setAiInfo(`AI dataset updated (${compact.length.toLocaleString()} connections).`);
    } catch {
      setAiInfo('AI dataset could not be stored (sessionStorage blocked).');
    }

    // Fire-and-forget: persist to the signed-in user's account. Local search must
    // work immediately and must not wait on (or fail because of) this write.
    // Both writes go through the store's per-uid queue, in this order. The
    // context is written even when null, so a CSV/JSON import clears an older
    // zip's context instead of mixing with it.
    const user = getAuth().currentUser;
    if (user) {
      const rowsToSave = stagedRows;
      setSaving(true);
      setSaveInfo(`Saving ${rowsToSave.length.toLocaleString()} connections to your account…`);

      void Promise.allSettled([
        saveConnections(user.uid, rowsToSave),
        saveNetworkContext(user.uid, contextToSave),
      ])
        .then(([rowsResult, contextResult]) => {
          const parts: string[] = [
            rowsResult.status === 'fulfilled'
              ? `Saved ${rowsResult.value.toLocaleString()} connections to your account.`
              : `Could not save to account: ${rowsResult.reason?.message ?? 'unknown error'}`,
          ];
          if (contextResult.status === 'rejected') {
            parts.push(`Could not save your profile context: ${contextResult.reason?.message ?? 'unknown error'}`);
          } else if (contextToSave) {
            parts.push('Saved your profile context.');
          }
          setSaveInfo(parts.join(' '));
        })
        .finally(() => setSaving(false));
    } else {
      setSaveInfo('');
    }
  }

  // Load the account-saved connections when arriving from
  // ConnectionsScreen's "Use in Recommender" button.
  const accountLoadStarted = useRef(false);

  // Bumped whenever the user replaces the dataset (upload, confirm, clear). The
  // account load samples it before awaiting Firestore and drops its result if it
  // changed, so a slow read can never overwrite a newer dataset.
  const datasetVersion = useRef(0);

  useEffect(() => {
    const wantsAccountLoad = (location.state as any)?.loadFromAccount === true;
    if (!wantsAccountLoad || accountLoadStarted.current) return;
    accountLoadStarted.current = true;

    // Consume the route state so a refresh doesn't re-trigger the load.
    // NOTE: this changes location.state, which re-runs this effect; the ref
    // above (not a cleanup-cancel flag) is what keeps the in-flight load alive.
    navigate('.', { replace: true, state: null });

    const user = getAuth().currentUser;
    if (!user) {
      setError('Sign in to load the connections saved to your account.');
      return;
    }
    const uid = user.uid;

    void (async () => {
      const version = datasetVersion.current;

      setError('');
      setSaveInfo('Loading your saved connections…');

      // The read is slow enough for the user to sign out, switch accounts, or
      // upload/clear/confirm another dataset meanwhile. In any of those cases the
      // result is stale: drop it instead of writing it to state or sessionStorage.
      const stale = () =>
        getAuth().currentUser?.uid !== uid || datasetVersion.current !== version;

      try {
        // The owner context is optional: a failed read degrades to "no
        // context" instead of failing the whole load.
        let contextFailed = false;
        const [docs, context] = await Promise.all([
          loadConnections(uid),
          loadNetworkContext(uid).catch(() => {
            contextFailed = true;
            return null;
          }),
        ]);
        if (stale()) return;

        const rows: Row[] = docs.map(docToRow);

        const colSet = new Set<string>();
        for (const r of rows.slice(0, 100)) Object.keys(r).forEach((k) => colSet.add(k));

        setFileName(`Saved connections (${rows.length.toLocaleString()})`);
        setColumns(Array.from(colSet));
        setStagedRows(rows);
        setConfirmedRows(rows);
        setStagedContext(context);
        setConfirmedContext(context);
        setImportSummary(null);
        setResults([]);
        setCriteria('');
        setAiError('');
        setPageIndex(0);
        setSaveInfo(
          `Loaded ${rows.length.toLocaleString()} connections from your account.` +
            (context
              ? ' Profile context loaded.'
              : contextFailed
                ? ' Your profile context could not be loaded.'
                : '')
        );

        try {
          sessionStorage.removeItem(CONTEXT_SESSION_KEY);
          const compact = docs.map(docToCompact);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(compact));
          // A failed context read stays absent (AIScreen retries it); a known
          // "no context" is stored as 'null'.
          if (context || !contextFailed) {
            sessionStorage.setItem(CONTEXT_SESSION_KEY, JSON.stringify(context));
          }
          setAiInfo(`AI dataset updated (${compact.length.toLocaleString()} connections).`);
        } catch {
          setAiInfo('AI dataset could not be stored (sessionStorage blocked).');
        }
      } catch (e: any) {
        if (stale()) return;
        setSaveInfo('');
        setError(e?.message ?? 'Failed to load saved connections.');
      }
    })();
  }, [location.state, navigate]);

  function clearLoaded() {
    datasetVersion.current += 1;

    // The cached dataset is what AIScreen reads, so clearing here must clear
    // there too -- otherwise the AI tab keeps answering from a dataset the user
    // just removed.
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(CONTEXT_SESSION_KEY);
    } catch {
      // sessionStorage blocked; there is nothing cached to clear.
    }

    setFileName('');
    setStagedRows([]);
    setConfirmedRows([]);
    setStagedContext(null);
    setConfirmedContext(null);
    setImportSummary(null);
    setColumns([]);
    setError('');
    setAiError('');
    setAiInfo('');
    setSaveInfo('');
    setResults([]);
    setCriteria('');
    setPageIndex(0);
  }

  function runSearch() {
    setAiError('');
    setAiInfo('');
    if (!canSearch) return;

    const { roleQuery, ranked } = rankConnections(confirmedRows, criteria, strictTitleOnly, confirmedContext);

    const top = ranked.slice(0, MAX_RESULTS);
    setResults(top);

    if (roleQuery && strictTitleOnly && top.length === 0) {
      setAiInfo('No results. Turn off “Strict title-only” because many CSV rows have blank titles.');
    } else if (top.length === 0) {
      setAiInfo('No results. Try broader criteria (e.g., “engineer” or “sales”).');
    } else {
      setAiInfo('Search complete. Company-only matches are flagged “Weak”.');
    }
  }

  async function aiRerank() {
    setAiError('');
    setAiInfo('');

    if (!criteria.trim()) {
      setAiError('Enter criteria first.');
      return;
    }
    if (!isConfirmed) {
      setAiError('Confirm connections first.');
      return;
    }

    // Identical local ranking (relevance, then relationship) as runSearch; the
    // AI can only reorder / select within the top AI_POOL_SIZE of this order.
    const { expanded, ranked } = rankConnections(confirmedRows, criteria, strictTitleOnly, confirmedContext);

    const pool = ranked.slice(0, AI_POOL_SIZE);
    if (!pool.length) {
      setAiError('No candidates available for AI rerank. Try a broader query or disable strict mode.');
      return;
    }

    const candidates: CandidateSummary[] = pool.map((p, i) => {
      const row = p.row;
      const name =
        getField(row, FULL_NAME_KEYS) ||
        `${getField(row, FIRST_NAME_KEYS)} ${getField(row, LAST_NAME_KEYS)}`.trim() ||
        '(no name)';

      return {
        id: `c${i}`,
        name,
        position: getField(row, POSITION_KEYS) || '',
        company: getField(row, COMPANY_KEYS) || '',
        email: getField(row, EMAIL_KEYS) || '',
        url: getField(row, URL_KEYS) || '',
        connectedOn: getField(row, CONNECTED_ON_KEYS) || '',
        // Derived relationship facts only (never note text or applications).
        ...(p.aiSummary ? { relationship: p.aiSummary } : {}),
      };
    });

    // Owner context for the prompt (never name, schools, follows or applications).
    const context = buildAiContext(confirmedContext);

    setAiReranking(true);
    try {
      const resp = await proxyFetch('/gemini/rerank', {
        method: 'POST',
        body: JSON.stringify({ criteria: expanded, candidates, ...(context ? { context } : {}) }),
      });

      const data = await fetchJsonOrThrow(resp);
      const recs: Array<{ id: string; reason?: string }> = data?.recommendations ?? [];

      if (!Array.isArray(recs) || recs.length === 0) {
        setAiError('AI returned no recommendations.');
        return;
      }

      const idToIndex = new Map<string, number>();
      candidates.forEach((c, idx) => idToIndex.set(c.id, idx));

      const newResults: RankedRow[] = [];
      for (const r of recs.slice(0, MAX_RESULTS)) {
        const idx = idToIndex.get(r.id);
        if (idx == null) continue;
        const original = pool[idx];
        if (!original) continue;

        // ✅ FIX: show full reason (lenient extraction)
        const cleaned = sanitizeAiReason(String(r.reason ?? ''));

        newResults.push({
          ...original,
          reasons: [...(original.reasons ?? []), ...(cleaned ? [`AI: ${cleaned}`] : [])],
        });
      }

      if (!newResults.length) {
        setAiError('AI rerank result mapping failed.');
        return;
      }

      setResults(newResults);
      setAiInfo('AI rerank applied.');
    } catch (e: any) {
      setAiError(e?.message ?? 'AI rerank failed.');
    } finally {
      setAiReranking(false);
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-7xl mx-auto w-full space-y-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white">Connection Recommender</h1>
            <p className="text-slate-400 mt-1 text-sm">
              Upload your full LinkedIn data export (.zip), or just Connections.csv / JSON → Review → Confirm → Search.
            </p>
          </div>

          {/* Upload */}
          <div className="glass-panel rounded-xl p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Network file</p>
                <div className="flex items-center gap-2">
                  <Icon name="upload_file" className="text-primary" />
                  <p className="font-semibold text-white">{fileName ? fileName : 'No file loaded'}</p>
                </div>

                {hasStaged && (
                  <p className="text-sm text-slate-400 mt-1">
                    Loaded {stats.stagedCount.toLocaleString()} connections • {stats.colCount} columns detected
                    <span className="ml-2 text-slate-500">• ~{stats.pctMissingTitle}% missing titles</span>
                    {isConfirmed ? (
                      <span className="ml-2 text-primary font-bold">• Confirmed</span>
                    ) : (
                      <span className="ml-2 text-slate-500">• Not confirmed</span>
                    )}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <label className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold cursor-pointer transition-all active:scale-[0.98]">
                  <Icon name="attach_file" className="text-sm" />
                  <span>Choose File</span>
                  <input
                    type="file"
                    accept=".zip,.csv,.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                  />
                </label>

                <button
                  onClick={clearLoaded}
                  disabled={!fileName && !hasStaged}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
                    fileName || hasStaged
                      ? 'bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10'
                      : 'bg-white/5 text-slate-600 border border-white/10 cursor-not-allowed'
                  }`}
                >
                  <Icon name="delete" className="text-sm" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {aiInfo && (
              <div className="mt-4 bg-primary/10 border border-primary/20 rounded-lg p-3 text-sm text-slate-200">
                {aiInfo}
              </div>
            )}

            {saveInfo && (
              <div className="mt-4 bg-primary/10 border border-primary/20 rounded-lg p-3 text-sm text-slate-200">
                {saveInfo}
              </div>
            )}

            {aiError && (
              <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200">
                {aiError}
              </div>
            )}
          </div>

          {/* Import summary (LinkedIn export zip only) */}
          {importSummary && (
            <div className="glass-panel rounded-xl p-4 md:p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Import summary</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 text-sm">
                <div className="min-w-0">
                  <p className="text-slate-300 font-bold mb-2">Files used</p>
                  <ul className="space-y-1">
                    {importSummary.filesUsed.map((f) => (
                      <li key={f.name} className="flex items-center justify-between gap-3 text-slate-400">
                        <span className="truncate">{f.name}</span>
                        <span className="text-slate-300 font-bold shrink-0">
                          {f.rows.toLocaleString()} {f.rows === 1 ? 'row' : 'rows'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="min-w-0 space-y-4">
                  {importCoverage.length > 0 && (
                    <div>
                      <p className="text-slate-300 font-bold mb-2">Match coverage</p>
                      <ul className="space-y-1 text-slate-400">
                        {importCoverage.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="text-slate-300 font-bold mb-2">Your profile context</p>
                    <p className="text-slate-400">
                      {!stagedContext
                        ? 'No profile files in this archive (connections only).'
                        : contextCounts.length
                          ? `Found: ${contextCounts.join(' • ')}`
                          : 'Profile files found, but they were empty.'}
                    </p>
                  </div>
                </div>
              </div>

              {importSummary.warnings.length > 0 && (
                <div className="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-200 space-y-1">
                  {importSummary.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}

              {importSummary.filesSkipped.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-slate-400 font-bold">
                    {importSummary.filesSkipped.length.toLocaleString()}{' '}
                    {importSummary.filesSkipped.length === 1 ? 'file' : 'files'} skipped (not read)
                  </summary>
                  <p className="mt-2 text-xs text-slate-500 break-words">{importSummary.filesSkipped.join(', ')}</p>
                </details>
              )}

              <div className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-400 space-y-1">
                <p className="flex items-start gap-2">
                  <Icon name="lock" className="text-sm text-primary shrink-0" />
                  <span>Message text is never stored; only counts and dates.</span>
                </p>
                <p className="flex items-start gap-2">
                  <Icon name="smart_toy" className="text-sm text-primary shrink-0" />
                  <span>
                    AI requests include relationship facts (message counts, last contact month, shared employers) but
                    never your notes or job applications.
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Preview + Confirm */}
          <div className="glass-panel rounded-xl p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Loaded connections (preview)
                </p>
                <p className="text-sm text-slate-400">
                  {hasStaged ? `Browse the list. Confirm to enable search + AI tab.` : `Upload a LinkedIn export .zip, CSV or JSON to preview.`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <span className="text-xs text-slate-400 font-bold">Rows/page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPageIndex(0);
                    }}
                    className="bg-transparent text-sm text-slate-200 outline-none"
                    disabled={!hasStaged}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                <button
                  onClick={confirmConnections}
                  disabled={!hasStaged || saving}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
                    hasStaged && !saving ? 'bg-primary hover:bg-primary/90 text-white' : 'bg-white/5 text-slate-600 border border-white/10 cursor-not-allowed'
                  }`}
                >
                  <Icon name={isConfirmed ? 'check_circle' : 'check'} className="text-sm" />
                  <span>{saving ? 'Saving…' : isConfirmed ? 'Confirmed' : 'Confirm Connections'}</span>
                </button>
              </div>
            </div>

            {hasStaged && (
              <>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    Showing page <span className="text-slate-300 font-bold">{safePageIndex + 1}</span> of{' '}
                    <span className="text-slate-300 font-bold">{totalPages}</span> • Total{' '}
                    <span className="text-slate-300 font-bold">{previewRows.length.toLocaleString()}</span> connections
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                      disabled={safePageIndex === 0}
                      className={`px-3 py-2 rounded-lg text-sm font-bold border transition ${
                        safePageIndex === 0
                          ? 'border-white/10 text-slate-600 bg-white/5 cursor-not-allowed'
                          : 'border-white/10 text-slate-200 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={safePageIndex >= totalPages - 1}
                      className={`px-3 py-2 rounded-lg text-sm font-bold border transition ${
                        safePageIndex >= totalPages - 1
                          ? 'border-white/10 text-slate-600 bg-white/5 cursor-not-allowed'
                          : 'border-white/10 text-slate-200 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-auto custom-scrollbar max-h-[520px] rounded-xl border border-white/10">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-background-dark/95 backdrop-blur border-b border-white/10">
                      <tr className="text-left">
                        <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Name</th>
                        <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Position</th>
                        <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Company</th>
                        <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Connected On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewSlice.map((r, i) => {
                        const name =
                          getField(r, FULL_NAME_KEYS) ||
                          `${getField(r, FIRST_NAME_KEYS)} ${getField(r, LAST_NAME_KEYS)}`.trim() ||
                          '(no name)';
                        const pos = getField(r, POSITION_KEYS) || '—';
                        const comp = getField(r, COMPANY_KEYS) || '—';
                        const connectedOn = getField(r, CONNECTED_ON_KEYS) || '—';

                        return (
                          <tr key={`${safePageIndex}-${i}`} className="border-b border-white/5 hover:bg-white/5">
                            <td className="p-3 font-bold text-slate-100 whitespace-nowrap">{name}</td>
                            <td className="p-3 text-slate-300">{pos}</td>
                            <td className="p-3 text-slate-300">{comp}</td>
                            <td className="p-3 text-slate-400 whitespace-nowrap">{connectedOn}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Search + Results */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-7 glass-panel rounded-xl p-4 md:p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Criteria</p>

              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="Example: software engineer, sales, VP Sales, CTO, data scientist..."
                className="w-full min-h-[120px] mac-input rounded-lg p-3 text-sm text-slate-100 placeholder:text-slate-500"
                disabled={!isConfirmed}
              />

              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={strictTitleOnly}
                  onChange={(e) => setStrictTitleOnly(e.target.checked)}
                  disabled={!isConfirmed}
                />
                <span className="font-bold">Strict title-only</span>
                <span className="text-slate-500">
                  — blocks company-only matches, may return 0 if titles are missing.
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Title matches are prioritized. Company-only matches are marked “Weak”.
                </p>

                <div className="flex gap-2">
                  <button
                    onClick={runSearch}
                    disabled={!canSearch}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
                      canSearch
                        ? 'bg-primary hover:bg-primary/90 text-white'
                        : 'bg-white/5 text-slate-600 border border-white/10 cursor-not-allowed'
                    }`}
                  >
                    <Icon name="search" className="text-sm" />
                    <span>Search</span>
                  </button>

                  <button
                    onClick={aiRerank}
                    disabled={AI_DISABLED || !canSearch || aiReranking}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] border ${
                      AI_DISABLED || !canSearch || aiReranking
                        ? 'bg-white/5 text-slate-600 border-white/10 cursor-not-allowed'
                        : 'bg-white/5 hover:bg-white/10 text-slate-200 border-white/10'
                    }`}
                    title={
                      AI_DISABLED
                        ? AI_DISABLED_MESSAGE
                        : 'Use Gemini (via the AI proxy) to rerank the best candidates and explain each pick.'
                    }
                  >
                    <Icon name="smart_toy" className="text-sm" />
                    <span>{aiReranking ? 'Reranking…' : 'AI Rerank'}</span>
                  </button>
                </div>
                {AI_DISABLED && (
                  <p className="text-xs text-slate-400 mt-2">
                    AI Rerank isn't available on the hosted version of this app. Search ranks by your query and your
                    relationships without it.
                  </p>
                )}
              </div>
            </div>

            <div className="lg:col-span-5 glass-panel rounded-xl p-4 md:p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Top Matches</p>

              {!isConfirmed ? (
                <div className="text-sm text-slate-400">Confirm the loaded connections to run a search.</div>
              ) : results.length === 0 ? (
                <div className="text-sm text-slate-400">Run a search to see results.</div>
              ) : (
                <div className="space-y-3">
                  {results.map((r, idx) => {
                    const name =
                      getField(r.row, FULL_NAME_KEYS) ||
                      `${getField(r.row, FIRST_NAME_KEYS)} ${getField(r.row, LAST_NAME_KEYS)}`.trim() ||
                      '(no name)';

                    const title = getField(r.row, POSITION_KEYS);
                    const org = getField(r.row, COMPANY_KEYS);

                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-white/10 bg-white/5 hover:border-primary/30 transition-colors p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-white leading-tight truncate">{name}</p>
                            {(title || org) && (
                              <p className="text-xs text-slate-400 mt-1 truncate">
                                {[title, org].filter(Boolean).join(' • ')}
                              </p>
                            )}
                          </div>
                          <div className="text-xs font-extrabold text-primary bg-primary/15 border border-primary/20 px-2 py-1 rounded-md shrink-0">
                            Score {r.score}
                          </div>
                        </div>

                        {r.reasons.length > 0 && (
                          <div className="mt-3 text-xs text-slate-300 space-y-1">
                            {r.reasons.slice(0, 8).map((reason, i) => (
                              <p key={i} className="text-slate-400">
                                <span className="text-slate-300 font-bold">•</span> {reason}
                              </p>
                            ))}
                          </div>
                        )}

                        {r.chips.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {r.chips.map((chip, i) => (
                              <span
                                key={`${chip}-${i}`}
                                className="text-[11px] px-2 py-1 rounded-md bg-primary/10 border border-primary/20 text-primary"
                              >
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}

                        {r.matchedTokens.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {r.matchedTokens.slice(0, 10).map((t) => (
                              <span
                                key={t}
                                className="text-[11px] px-2 py-1 rounded-md bg-primary/10 border border-primary/20 text-primary"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

export default RecommenderScreen;