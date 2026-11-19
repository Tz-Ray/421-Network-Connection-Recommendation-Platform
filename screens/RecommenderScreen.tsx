// screens/RecommenderScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAuth } from 'firebase/auth';
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
import { normalizeProfileUrl, parseLinkedInExportZip } from '../lib/linkedinExport';
import type { ImportSummary } from '../lib/linkedinExport';
import { buildAiContext } from '../lib/relationship';
import { rankConnections } from '../lib/search';
import type { RankedRow } from '../lib/search';
import {
  AI_FREE_TIER_NOTICE,
  proxyErrorMessage,
  proxyFetch,
  showsFreeTierNotice,
  useAiAvailability,
} from '../lib/proxyClient';
import { candidateKeysFor, loadQueryFeedback, recordRankingFeedback } from '../lib/telemetry';
import type { RankingFeedback } from '../lib/telemetry';
import { addFavorite, listFavorites, removeFavorite } from '../lib/savedItems';
import type { Favorite } from '../lib/savedItems';
import { useAuth } from '../lib/AuthContext';
import { SavedSearches } from '../components/SavedSearches';
import { FavoritesList } from '../components/FavoritesList';
import type { SemanticRanker } from '../lib/semantic/types';
import { useShell, StatusFooter } from '../components/AppShell';
import { DetailPane, useDetailRoute } from '../components/DetailPane';
import { PersonHeading, PersonFacts } from '../components/PersonFacts';
import { ImportSteps } from '../components/ImportSteps';
import { personName, personIds, docIdParts, rowWhy, detailReasons } from '../lib/presentation';
import {
  isGraphMember,
  loadCommonConnections,
  personKeyFor,
  type CommonConnections,
} from '../lib/networkGraph';
import '../styles/search.css';
import {
  readSearchSession,
  saveSearchSession,
  datasetChanged,
  type ResultItem,
  type ResultSet,
} from '../lib/searchSession';

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

// The "Meaning-based search" toggle (lib/semantic/). Lazy so the main bundle never
// carries it; the model runtime is a further dynamic import inside it, made only
// when the user turns the toggle on.
const SemanticSearchToggle = React.lazy(() => import('../components/SemanticSearchToggle'));

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
  if (!resp.ok) throw new Error(await proxyErrorMessage(resp));
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// -----------------------------
// Feedback ordering
// -----------------------------
type Votes = Map<string, RankingFeedback>;

/**
 * A ranked row with its candidate ids: `id` = candidateIdFor (votes and
 * favorites are written under it), `legacyId` = the pre-#59 id, read only so
 * older votes keep applying. Both are '' when the ids could not be computed.
 */
const EMPTY_RESULTS: ResultSet = { main: [], irrelevant: [] };
type CandidateKeys = { id: string; legacyId: string };
const NO_KEYS: CandidateKeys = { id: '', legacyId: '' };

/** The vote that applies to a row: its current id first, then the legacy one. */
function voteFor<T>(votes: { get(k: string): T | undefined }, item: CandidateKeys): T | undefined {
  return (item.id ? votes.get(item.id) : undefined) ?? (item.legacyId ? votes.get(item.legacyId) : undefined);
}

/** Your saved votes for this search and the pool's candidate ids. Never rejects: on failure nothing is reordered. */
function loadVotes(pool: RankedRow[], queryText: string): Promise<[Votes, CandidateKeys[]]> {
  return Promise.all([
    loadQueryFeedback(queryText).catch((): Votes => new Map()),
    Promise.all(pool.map((p) => candidateKeysFor(p.row))).catch(() => pool.map(() => NO_KEYS)),
  ]);
}

const MOVED_UP_NOTE = 'Moved up: you marked this relevant for this search.';
const MOVED_DOWN_NOTE = 'Moved down: you marked this not relevant for this search.';

/**
 * Relevant first, then unvoted in the given order, capped at MAX_RESULTS.
 * Voted-irrelevant rows go to `irrelevant` (shown under "Marked irrelevant", so
 * the vote can still be switched). `extras` (pool rows outside `ordered`) join
 * the main list only when voted relevant, with `addedNote`. The vote note is
 * prepended so the card's reason cap never hides it. `up` counts the relevant
 * rows that made the visible list; `down` the rows under "Marked irrelevant".
 */
function applyVotes(
  ordered: ResultItem[],
  extras: ResultItem[],
  votes: Votes,
  addedNote = '',
): ResultSet & { up: number; down: number } {
  const note = (item: ResultItem, text: string): ResultItem => ({
    ...item,
    row: { ...item.row, reasons: [text, ...item.row.reasons] },
  });
  const up: ResultItem[] = [];
  const unvoted: ResultItem[] = [];
  const down: ResultItem[] = [];
  for (const item of ordered) {
    const vote = voteFor(votes, item);
    if (vote === 'relevant') up.push(note(item, MOVED_UP_NOTE));
    else if (vote === 'irrelevant') down.push(note(item, MOVED_DOWN_NOTE));
    else unvoted.push(item);
  }
  for (const item of extras) {
    const vote = voteFor(votes, item);
    if (vote === 'relevant') up.push(note(item, addedNote));
    else if (vote === 'irrelevant') down.push(note(item, MOVED_DOWN_NOTE));
  }
  const main = [...up, ...unvoted].slice(0, MAX_RESULTS);
  return { main, irrelevant: down, up: Math.min(up.length, main.length), down: down.length };
}

const feedbackSummary = (up: number, down: number) =>
  up || down ? ` Your feedback moved ${up} up and ${down} down.` : '';

// -----------------------------
// Screen
// -----------------------------
const RecommenderScreen: React.FC = () => {
  const ai = useAiAvailability();
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [restored] = useState(() => readSearchSession(uid));

  const location = useLocation();
  const navigate = useNavigate();
  const shell = useShell();
  const detailRoute = useDetailRoute();
  const [selectedId, setSelectedId] = useState(restored?.selectedId || '');
  const [tab, setTab] = useState<'results' | 'saved-people' | 'saved-searches'>(restored?.tab || 'results');
  const [refine, setRefine] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [importMode, setImportMode] = useState(!!location.state?.importConnections);
  const [review, setReview] = useState(false);
  const [reading, setReading] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(!restored && !location.state?.importConnections);
  const [rankedCount, setRankedCount] = useState(restored?.rankedCount || 0);
  const [flashId, setFlashId] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importHeading = useRef<HTMLHeadingElement>(null);
  const saveToggle = useRef<HTMLButtonElement>(null);
  const irrelevantGroup = useRef<HTMLDetailsElement>(null);
  const pendingQuery = useRef<{ criteria: string; strictTitleOnly: boolean } | null>(null);
  const consumedRequest = useRef('');
  const previousImport = useRef<any>(null);
  const ordering = useRef<{
    ordered: ResultItem[];
    extras: ResultItem[];
    note: string;
    query: string;
  } | null>(restored?.ordering || null);
  const feedbackAction = useRef<(item: ResultItem, value: RankingFeedback) => Promise<void>>(null);
  const favoriteAction = useRef<(id: string, row: Row) => Promise<void>>(null);
  const [common, setCommon] = useState<CommonConnections | null>(null);
  const graphStarted = useRef(false);
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);

  const [fileName, setFileName] = useState<string>(restored?.fileName || '');
  const [stagedRows, setStagedRows] = useState<Row[]>(restored?.rows || []);
  const [confirmedRows, setConfirmedRows] = useState<Row[]>(restored?.rows || []);
  const [columns, setColumns] = useState<string[]>(restored?.columns || []);
  const [error, setError] = useState<string>('');

  // Owner context from a LinkedIn export zip (null for CSV / JSON / a
  // Connections-only zip). Staged alongside the rows, confirmed with them.
  const [stagedContext, setStagedContext] = useState<NetworkContext | null>(restored?.context || null);
  const [confirmedContext, setConfirmedContext] = useState<NetworkContext | null>(restored?.context || null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(restored?.importSummary || null);

  const [criteria, setCriteria] = useState<string>(restored?.criteria || '');
  // Main list (top MAX_RESULTS) + the pool's voted-irrelevant rows ("Marked irrelevant").
  const [results, setResults] = useState<ResultSet>(restored?.results || EMPTY_RESULTS);
  // A Search is running (ranking + the votes read), for the button and the panel.
  const [searching, setSearching] = useState(false);

  const [pageSize, setPageSize] = useState<number>(50);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const [aiReranking, setAiReranking] = useState(false);
  const [aiError, setAiError] = useState<string>('');
  const [aiInfo, setAiInfo] = useState<string>('');
  const [saveInfo, setSaveInfo] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  const [strictTitleOnly, setStrictTitleOnly] = useState<boolean>(restored?.strictTitleOnly || false);
  // Set by the meaning-based search toggle while it is on; null = the lexical ranker only.
  // AI Rerank does not read it (it keeps the lexical pool; known limitation).
  const semanticRanker = useRef<SemanticRanker | null>(null);

  // The criteria that produced `results` (the textarea may be edited since).
  const [resultsQuery, setResultsQuery] = useState<string>(restored?.resultsQuery || '');
  // Votes for `resultsQuery`, keyed by the candidate id they were saved under
  // (current or legacy; read with voteFor). Set with each result set from the
  // same read that ordered it, then updated as votes are cast.
  const [feedback, setFeedback] = useState<Record<string, RankingFeedback>>(restored?.feedback || {});
  const [feedbackPending, setFeedbackPending] = useState<Record<string, boolean>>({});
  const [feedbackError, setFeedbackError] = useState<string>('');
  // Synchronous duplicate-click guard: candidate ids with a vote write in flight.
  const votesInFlight = useRef<Set<string>>(new Set());

  // Saved Connections (favorites), keyed by candidateIdFor.
  const uidRef = useRef(uid);
  uidRef.current = uid;
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesNotice, setFavoritesNotice] = useState('');
  const [favoritesBusy, setFavoritesBusy] = useState<Record<string, boolean>>({});
  const favoritesInFlight = useRef<Set<string>>(new Set());
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  useEffect(() => {
    setFavorites([]);
    setFavoritesNotice('');
    if (!uid) return;
    let cancelled = false;
    setFavoritesLoading(true);
    listFavorites()
      .then((list) => {
        if (!cancelled) setFavorites(list);
      })
      .catch((e: any) => {
        if (!cancelled)
          setFavoritesNotice(`Saved connections could not be loaded: ${e?.message ?? 'unknown error'}`);
      })
      .finally(() => {
        if (!cancelled) setFavoritesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const hasStaged = stagedRows.length > 0;
  const isConfirmed = confirmedRows.length > 0;
  const canSearch = isConfirmed && criteria.trim().length > 0;
  const hasResults = results.main.length > 0 || results.irrelevant.length > 0;
  const feedbackMap = { get: (k: string): RankingFeedback | undefined => feedback[k] };

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

  useEffect(() => {
    if (uid && !importMode && !review && !reading && !loadingAccount)
      saveSearchSession(uid, {
        criteria,
        strictTitleOnly,
        results,
        resultsQuery,
        rankedCount,
        selectedId,
        tab,
        rows: confirmedRows,
        context: confirmedContext,
        columns,
        fileName,
        importSummary,
        feedback,
        ordering: ordering.current,
      });
  }, [
    uid,
    importMode,
    review,
    reading,
    loadingAccount,
    criteria,
    strictTitleOnly,
    results,
    resultsQuery,
    rankedCount,
    selectedId,
    tab,
    confirmedRows,
    confirmedContext,
    columns,
    fileName,
    importSummary,
    feedback,
  ]);
  useEffect(() => {
    if (importMode || review) {
      shell.announce('');
      importHeading.current?.focus();
    }
  }, [importMode, review, reading]);
  function clearPersonRoute() {
    if (!detailRoute.value) return;
    const params = new URLSearchParams(location.search);
    params.delete('person');
    const { detailEntry, ...state } = location.state || {};
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, state });
  }
  function resetSearchResults() {
    setResults(EMPTY_RESULTS);
    setResultsQuery('');
    setRankedCount(0);
    setSelectedId('');
    setFeedback({});
    ordering.current = null;
    setShowSave(false);
    datasetChanged();
  }
  function resetForNewFile(newFileName: string) {
    setFileName(newFileName);
    setError('');
    setAiError('');
    setAiInfo('');
    setSaveInfo('');
    resetSearchResults();
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
    if (saving) return;
    if (!previousImport.current)
      previousImport.current = {
        fileName,
        stagedRows,
        confirmedRows,
        columns,
        stagedContext,
        confirmedContext,
        importSummary,
        results,
        criteria,
        resultsQuery,
        rankedCount,
        selectedId,
        feedback,
        ordering: ordering.current,
      };
    setImportMode(true);
    setReview(false);
    setReading(true);
    setLoadingAccount(false);
    datasetVersion.current += 1;
    const version = datasetVersion.current;
    resetForNewFile(file.name);
    clearPersonRoute();

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
          (r: unknown): r is Row => r != null && typeof r === 'object' && !Array.isArray(r),
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
      setReview(true);
    } catch (e: any) {
      if (stale()) return;
      setStagedRows([]);
      setConfirmedRows([]);
      setColumns([]);
      setError(e?.message ?? 'Failed to parse file.');
    } finally {
      if (!stale()) setReading(false);
    }
  }

  function confirmConnections() {
    if (!hasStaged) return;
    if (saving) return; // a save for this dataset is already in flight

    datasetVersion.current += 1;
    setReview(false);
    setImportMode(false);
    clearPersonRoute();
    previousImport.current = null;
    const contextToSave = stagedContext;
    setConfirmedRows(stagedRows);
    setConfirmedContext(contextToSave);
    resetSearchResults();
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
            parts.push(
              `Could not save your profile context: ${contextResult.reason?.message ?? 'unknown error'}`,
            );
          } else if (contextToSave) {
            parts.push('Saved your profile context.');
          }
          setSaveInfo(parts.join(' '));
          if (getAuth().currentUser?.uid === user.uid && rowsResult.status === 'fulfilled')
            shell.refreshCount();
        })
        .finally(() => setSaving(false));
    } else {
      setSaveInfo('');
    }
  }

  // Load the account-saved connections when arriving from
  // ConnectionsScreen's "Use in Recommender" button.
  const accountLoadStarted = useRef(!!restored && !location.state?.loadFromAccount);

  // Bumped whenever the user replaces the dataset (upload, confirm, clear). The
  // account load samples it before awaiting Firestore and drops its result if it
  // changed, so a slow read can never overwrite a newer dataset.
  const datasetVersion = useRef(0);

  useEffect(() => {
    const wantsAccountLoad =
      (location.state as any)?.loadFromAccount === true || (!accountLoadStarted.current && !importMode);
    if (!wantsAccountLoad || accountLoadStarted.current) return;
    accountLoadStarted.current = true;

    // Consume the route state so a refresh doesn't re-trigger the load.
    // NOTE: this changes location.state, which re-runs this effect; the ref
    // above (not a cleanup-cancel flag) is what keeps the in-flight load alive.
    if (location.state?.loadFromAccount) {
      const { loadFromAccount, ...rest } = location.state;
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: rest });
    }

    const user = getAuth().currentUser;
    if (!user) {
      setError('Sign in to load the connections saved to your account.');
      return;
    }
    const uid = user.uid;

    void (async () => {
      const version = datasetVersion.current;

      setError('');
      setLoadingAccount(true);
      setSaveInfo('Loading your saved connections…');

      // The read is slow enough for the user to sign out, switch accounts, or
      // upload/clear/confirm another dataset meanwhile. In any of those cases the
      // result is stale: drop it instead of writing it to state or sessionStorage.
      const stale = () => getAuth().currentUser?.uid !== uid || datasetVersion.current !== version;

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
        resetSearchResults();
        setCriteria('');
        setAiError('');
        setPageIndex(0);
        setSaveInfo(
          `Loaded ${rows.length.toLocaleString()} connections from your account.` +
            (context
              ? ' Profile context loaded.'
              : contextFailed
                ? ' Your profile context could not be loaded.'
                : ''),
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
      } finally {
        if (!stale()) setLoadingAccount(false);
      }
    })();
  }, [location.state, navigate, importMode]);

  function clearLoaded() {
    clearPersonRoute();
    setReview(false);
    setImportMode(true);
    setReading(false);
    setLoadingAccount(false);
    previousImport.current = null;
    ordering.current = null;
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
    resetSearchResults();
    setCriteria('');
    setPageIndex(0);
  }

  /**
   * Local search. `override` runs a saved search before its criteria / strict
   * flag have reached state.
   */
  async function runSearch(override?: { criteria: string; strictTitleOnly: boolean }) {
    setAiError('');
    setAiInfo('');
    const queryText = override?.criteria ?? criteria;
    const strict = override?.strictTitleOnly ?? strictTitleOnly;
    if (!isConfirmed || !queryText.trim() || aiReranking) return;

    const version = datasetVersion.current;
    const seq = ++searchSeq.current;
    setSearching(true);
    shell.announce('Searching…');
    try {
      const { roleQuery, ranked } = semanticRanker.current
        ? await semanticRanker.current(confirmedRows, queryText, strict, confirmedContext)
        : rankConnections(confirmedRows, queryText, strict, confirmedContext);

      // Votes can lift anyone from the same pool AI Rerank uses into the top results.
      const pool = ranked.slice(0, AI_POOL_SIZE);
      const [votes, keys] = await loadVotes(pool, queryText);
      if (seq !== searchSeq.current || version !== datasetVersion.current) return;

      setRankedCount(ranked.length);
      ordering.current = {
        ordered: pool.map((row, i) => ({ row, ...(keys[i] ?? NO_KEYS) })),
        extras: [],
        note: '',
        query: queryText,
      };
      const { main, irrelevant, up, down } = applyVotes(
        pool.map((row, i) => ({ row, ...(keys[i] ?? NO_KEYS) })),
        [],
        votes,
      );
      setResults({ main, irrelevant });
      setResultsQuery(queryText);
      const first = main[0] || irrelevant[0];
      setSelectedId(first ? itemId(first) : '');
      if (detailRoute.value) {
        if (first) detailRoute.open(itemId(first), true);
        else clearPersonRoute();
      }
      setTab('results');
      showLoadedVotes(votes, queryText);

      if (roleQuery && strict && pool.length === 0) {
        setAiInfo('No results. Turn off “Title matches only” to include people without title matches.');
      } else if (pool.length === 0) {
        setAiInfo('No results. Try broader criteria (e.g., “engineer” or “sales”).');
      } else {
        setAiInfo(`Found ${main.length} people who could help.${feedbackSummary(up, down)}`);
      }
    } finally {
      // A newer search owns the flag now (it clears it itself).
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  /**
   * Shows the votes read with a new result set. On a re-run of the same search,
   * votes this tab saved meanwhile win (the read may predate them).
   */
  function showLoadedVotes(votes: Votes, queryText: string) {
    const loaded = Object.fromEntries(votes) as Record<string, RankingFeedback>;
    const sameSearch = resultsQueryRef.current === queryText;
    setFeedback((prev) => (sameSearch ? { ...loaded, ...prev } : loaded));
    setFeedbackError('');
  }

  /** Runs a saved search: fills the criteria + strict flag and searches with them. */
  function runSavedSearch(savedCriteria: string, savedStrict: boolean) {
    setCriteria(savedCriteria);
    setStrictTitleOnly(savedStrict);
    void runSearch({ criteria: savedCriteria, strictTitleOnly: savedStrict });
  }

  async function aiRerank() {
    if (searching || aiReranking) return;
    setAiError('');
    setAiInfo('');

    const queryText = criteria;
    if (!queryText.trim()) {
      setAiError('Enter criteria first.');
      return;
    }
    if (!isConfirmed) {
      setAiError('Confirm connections first.');
      return;
    }

    // Identical local ranking (relevance, then relationship) as runSearch; the
    // AI can only reorder / select within the top AI_POOL_SIZE of this order.
    // Always the lexical ranking, also while meaning-based search is on (known
    // limitation: the AI never sees rows the semantic pass added or reordered).
    const { expanded, ranked } = rankConnections(confirmedRows, queryText, strictTitleOnly, confirmedContext);

    const pool = ranked.slice(0, AI_POOL_SIZE);
    if (!pool.length) {
      setAiError(
        `No people available to reorder. Try a broader search.${strictTitleOnly ? ' Or turn off Title matches only.' : ''}`,
      );
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

    // Fetched alongside the AI call; if it fails the AI order is used as is.
    const votesPromise = loadVotes(pool, queryText);
    // A Search still waiting on its votes must not overwrite the AI results, and
    // this rerank drops its own result if a newer search or dataset arrives.
    const seq = ++searchSeq.current;
    const version = datasetVersion.current;
    const stale = () => seq !== searchSeq.current || version !== datasetVersion.current;

    setAiReranking(true);
    try {
      const resp = await proxyFetch('/gemini/rerank', {
        method: 'POST',
        body: JSON.stringify({ criteria: expanded, candidates, ...(context ? { context } : {}) }),
      });

      const data = await fetchJsonOrThrow(resp);
      if (stale()) return;
      const recs: Array<{ id: string; reason?: string }> = data?.recommendations ?? [];

      if (!Array.isArray(recs) || recs.length === 0) {
        setAiError('AI returned no recommendations.');
        return;
      }

      const idToIndex = new Map<string, number>();
      candidates.forEach((c, idx) => idToIndex.set(c.id, idx));

      const aiOrder: { idx: number; reason: string }[] = [];
      const picked = new Set<number>();
      for (const r of recs) {
        const idx = idToIndex.get(r.id);
        if (idx == null || picked.has(idx) || !pool[idx]) continue;
        picked.add(idx);
        // ✅ FIX: show full reason (lenient extraction)
        aiOrder.push({ idx, reason: sanitizeAiReason(String(r.reason ?? '')) });
      }

      if (!aiOrder.length) {
        setAiError('Could not match the AI answer to your connections.');
        return;
      }

      // Your votes for this search override the AI order.
      const [votes, poolKeys] = await votesPromise;
      if (stale()) return;
      const withAiReason = (idx: number, reason: string): RankedRow => ({
        ...pool[idx],
        reasons: [...(pool[idx].reasons ?? []), ...(reason ? [`AI: ${reason}`] : [])],
      });

      setRankedCount(ranked.length);
      ordering.current = {
        ordered: aiOrder.map(({ idx, reason }) => ({
          row: withAiReason(idx, reason),
          ...(poolKeys[idx] ?? NO_KEYS),
        })),
        extras: pool.flatMap((row, idx) => (picked.has(idx) ? [] : [{ row, ...(poolKeys[idx] ?? NO_KEYS) }])),
        note: 'Added: you marked this relevant for this search (the AI did not pick it).',
        query: queryText,
      };
      const { main, irrelevant, up, down } = applyVotes(
        aiOrder.map(({ idx, reason }) => ({ row: withAiReason(idx, reason), ...(poolKeys[idx] ?? NO_KEYS) })),
        pool.flatMap((row, idx) => (picked.has(idx) ? [] : [{ row, ...(poolKeys[idx] ?? NO_KEYS) }])),
        votes,
        'Added: you marked this relevant for this search (the AI did not pick it).',
      );

      setResults({ main, irrelevant });
      setResultsQuery(queryText);
      showLoadedVotes(votes, queryText);
      setAiInfo(`Reordered with AI.${feedbackSummary(up, down)}`);
    } catch (e: any) {
      if (stale()) return;
      setAiError(e?.message ?? 'Could not reorder with AI.');
    } finally {
      setAiReranking(false);
    }
  }

  // Lets an in-flight vote detect that the results now belong to another search.
  const resultsQueryRef = useRef(resultsQuery);
  resultsQueryRef.current = resultsQuery;
  // Latest search / rerank; an older one still loading votes drops its results.
  const searchSeq = useRef(0);

  const latestFeedback = useRef(feedback);
  latestFeedback.current = feedback;
  async function sendFeedback(item: ResultItem, value: RankingFeedback) {
    const beforeFocus = document.activeElement as HTMLElement;
    const fromRow = !!beforeFocus.closest('.row');
    const previous = voteFor({ get: (id: string) => latestFeedback.current[id] }, item);
    const candidateId = item.id;
    const queryText = resultsQuery;
    if (!candidateId) {
      setFeedbackError('Could not identify this connection, so the feedback was not sent.');
      return;
    }
    // Synchronous guard (before any await or state update): a second click in
    // the same task must not write a second telemetry doc.
    if (votesInFlight.current.has(candidateId) || voteFor(feedbackMap, item) === value) return;
    votesInFlight.current.add(candidateId);

    setFeedbackError('');
    setFeedbackPending((p) => ({ ...p, [candidateId]: true }));
    try {
      await recordRankingFeedback({ candidateId, queryText, feedback: value });
      if (resultsQueryRef.current === queryText) {
        const next = { ...latestFeedback.current, [candidateId]: value };
        latestFeedback.current = next;
        setFeedback(next);
        const order = ordering.current;
        if (order?.query === queryText)
          setResults(applyVotes(order.ordered, order.extras, new Map(Object.entries(next)), order.note));
        setSelectedId(itemId(item));
        if (detailRoute.value) detailRoute.open(itemId(item), true);
        const label = value === 'relevant' ? 'relevant' : 'not relevant';
        shell.announce(
          previous
            ? `Marked ${label}.`
            : `Marked ${label}. To change it, choose ${value === 'relevant' ? 'Not relevant' : 'Relevant'}.`,
          previous
            ? async () => {
                if (resultsQueryRef.current === queryText) await feedbackAction.current?.(item, previous);
              }
            : undefined,
        );
      }
    } catch (e: any) {
      if (resultsQueryRef.current === queryText) setFeedbackError(e?.message ?? 'Could not send feedback.');
    } finally {
      votesInFlight.current.delete(candidateId);
      setFeedbackPending((p) => ({ ...p, [candidateId]: false }));
      requestAnimationFrame(() => {
        const row = document.getElementById(`result-${itemId(item)}`);
        if (row) {
          const group = row.closest('details');
          if (group) group.open = true;
          // The voted row may have moved; keep it in view wherever the vote came from.
          row.scrollIntoView({ block: 'nearest' });
          if (fromRow) row.querySelector<HTMLButtonElement>('.row-main')?.focus();
          else if (beforeFocus.isConnected) beforeFocus.focus({ preventScroll: true });
        }
      });
    }
  }

  async function toggleFavorite(candidateId: string, row: Record<string, unknown>) {
    if (!candidateId) {
      setFavoritesNotice('Could not identify this connection, so it was not saved.');
      return;
    }
    if (favoritesInFlight.current.has(candidateId)) return;
    favoritesInFlight.current.add(candidateId);
    const owner = uid;
    const removing = favoriteIds.has(candidateId);

    setFavoritesNotice('');
    setFavoritesBusy((b) => ({ ...b, [candidateId]: true }));
    try {
      if (removing) {
        await removeFavorite(candidateId);
        if (uidRef.current === owner) setFavorites((list) => list.filter((f) => f.id !== candidateId));
      } else {
        const fav = await addFavorite(candidateId, row);
        if (uidRef.current === owner) {
          setFavorites((list) => [fav, ...list.filter((f) => f.id !== candidateId)]);
        }
      }
      if (uidRef.current === owner)
        shell.announce(removing ? 'Removed from saved people.' : 'Saved to saved people.', async () => {
          if (uidRef.current === owner) await favoriteAction.current?.(candidateId, row);
        });
    } catch (e: any) {
      if (uidRef.current === owner) {
        setFavoritesNotice(
          `Could not ${removing ? 'remove' : 'save'} the connection: ${e?.message ?? 'unknown error'}`,
        );
      }
    } finally {
      favoritesInFlight.current.delete(candidateId);
      setFavoritesBusy((b) => ({ ...b, [candidateId]: false }));
    }
  }

  feedbackAction.current = sendFeedback;
  favoriteAction.current = toggleFavorite;
  const focusRequested = useRef(false);
  useEffect(() => {
    const state = location.state;
    if (
      !state ||
      consumedRequest.current === location.key ||
      !(state.runSearch || state.focusSearch || state.importConnections)
    )
      return;
    consumedRequest.current = location.key;
    if (state.runSearch) pendingQuery.current = state.runSearch;
    if (state.focusSearch) focusRequested.current = true;
    if (state.importConnections) {
      datasetVersion.current += 1;
      setImportMode(true);
      setReview(false);
      setLoadingAccount(false);
    }
    // Account loading consumes its own state with its existing once-only guard.
    const { runSearch: request, focusSearch, importConnections, ...rest } = state;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: rest });
  }, [location.key, location.state, navigate]);
  useEffect(() => {
    if (isConfirmed && pendingQuery.current && !searching && !aiReranking) {
      const request = pendingQuery.current;
      pendingQuery.current = null;
      setImportMode(false);
      runSavedSearch(request.criteria, request.strictTitleOnly);
    }
    if (isConfirmed && focusRequested.current) {
      focusRequested.current = false;
      searchInput.current?.focus();
    }
  }, [isConfirmed, location.key, searching, aiReranking]);
  useEffect(() => {
    if (saveInfo) shell.announce(saveInfo);
  }, [saveInfo]);
  useEffect(() => {
    if (aiInfo && !aiInfo.startsWith('AI dataset')) shell.announce(aiInfo);
  }, [aiInfo]);
  useEffect(() => {
    const message = error || aiError || feedbackError || favoritesNotice;
    if (message) shell.announce(message);
  }, [error, aiError, feedbackError, favoritesNotice]);
  useEffect(() => {
    if (!hasResults || graphStarted.current || !uid) return;
    graphStarted.current = true;
    void (async () => {
      try {
        if (!(await isGraphMember(uid))) return;
        const data = await loadCommonConnections(uid);
        if (getAuth().currentUser?.uid === uid) setCommon(data);
      } catch {
        /* Optional sharing facts must not prevent searching. */
      }
    })();
  }, [hasResults, uid]);

  function cancelImport() {
    datasetVersion.current += 1;
    const prev = previousImport.current;
    if (prev) {
      setFileName(prev.fileName);
      setStagedRows(prev.stagedRows);
      setConfirmedRows(prev.confirmedRows);
      setColumns(prev.columns);
      setStagedContext(prev.stagedContext);
      setConfirmedContext(prev.confirmedContext);
      setImportSummary(prev.importSummary);
      setResults(prev.results);
      setCriteria(prev.criteria);
      setResultsQuery(prev.resultsQuery);
      setRankedCount(prev.rankedCount);
      setSelectedId(prev.selectedId);
      setFeedback(prev.feedback);
      ordering.current = prev.ordering;
    }
    previousImport.current = null;
    setImportMode(false);
    setReview(false);
    setReading(false);
    setError('');
    shell.announce('Import cancelled. Nothing was saved.');
    if (!(prev?.confirmedRows.length || confirmedRows.length)) accountLoadStarted.current = false;
    if (!accountLoadStarted.current) navigate('.', { replace: true, state: { loadFromAccount: true } });
  }
  const nameOf = (row: Row) => personName(rowToDoc(row));
  const rowIds = useMemo(() => {
    const ids = personIds(confirmedRows, (row) => docIdParts(rowToDoc(row)));
    return new Map(confirmedRows.map((row, i) => [row, ids[i]]));
  }, [confirmedRows]);
  // Fallback for a row outside the confirmed list (should not happen): its own id without a repeat suffix.
  const itemId = (item: ResultItem) =>
    rowIds.get(item.row.row) || personIds([item.row.row], (row) => docIdParts(rowToDoc(row)))[0];
  // A favorite stores the row's name, title, company and URL, so its person id is the row's first-occurrence id.
  const favoriteRows = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const [row, id] of rowIds) if (!byId.has(id)) byId.set(id, row);
    return new Map(
      favorites.map((f) => {
        const row =
          byId.get(personIds([f], (x) => x)[0]) ||
          (normalizeProfileUrl(f.url || '')
            ? undefined
            : confirmedRows.find(
                (r) =>
                  nameOf(r) === f.name &&
                  getField(r, POSITION_KEYS) === f.position &&
                  getField(r, COMPANY_KEYS) === f.company,
              ));
        return [f, row] as const;
      }),
    );
  }, [favorites, rowIds, confirmedRows]);
  const favoriteRowFor = (f: Favorite) => favoriteRows.get(f);
  const favoritePersonId = (f: Favorite) => {
    const row = favoriteRowFor(f);
    return row ? rowIds.get(row)! : `saved-${f.id}`;
  };
  const allResults = [...results.main, ...results.irrelevant];
  const activeId = detailRoute.value || selectedId || (results.main[0] ? itemId(results.main[0]) : '');
  const favorite = favorites.find((f) => favoritePersonId(f) === activeId);
  const favoriteRow =
    favorite &&
    (favoriteRowFor(favorite) || {
      'Full Name': favorite.name,
      Position: favorite.position,
      Company: favorite.company,
      URL: favorite.url,
    });
  const activeItem = allResults.find((r) => itemId(r) === activeId);
  const activeRow = activeItem?.row.row || favoriteRow;
  const activePerson = activeRow ? rowToDoc(activeRow) : null;
  const activeStarId = activeItem?.id || favorite?.id || '';
  useEffect(() => {
    setSelectedPersonKey(null);
    if (!common || !activeRow) return;
    let active = true;
    void personKeyFor(activeRow)
      .then((k) => {
        if (active) setSelectedPersonKey(k);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [common, activeRow]);
  function select(item: ResultItem) {
    setSelectedId(itemId(item));
    detailRoute.open(itemId(item));
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('input,textarea,select,[contenteditable="true"],dialog,[role="dialog"]') ||
        document.querySelector('dialog[open]') ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const k = e.key.toLowerCase();
      if (k === '/') {
        e.preventDefault();
        searchInput.current?.focus();
        return;
      }
      if (tab !== 'results' || !hasResults || searching || aiReranking || review) return;
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const at = results.main.findIndex((item) => itemId(item) === activeId);
        const next = results.main[Math.max(0, Math.min(results.main.length - 1, at + (k === 'j' ? 1 : -1)))];
        if (next) {
          setSelectedId(itemId(next));
          if (detailRoute.value) detailRoute.open(itemId(next));
          document
            .getElementById(`result-${itemId(next)}`)
            ?.querySelector<HTMLButtonElement>('.row-main')
            ?.focus();
        }
      } else if (activeItem && k === 's') {
        e.preventDefault();
        void toggleFavorite(activeItem.id, activeItem.row.row);
      } else if (activeItem && (k === 'r' || k === 'x')) {
        e.preventDefault();
        void sendFeedback(activeItem, k === 'r' ? 'relevant' : 'irrelevant');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function voteButtons(item: ResultItem) {
    const vote = voteFor(feedbackMap, item);
    return (['relevant', 'irrelevant'] as const).map((value) => (
      <button
        key={value}
        className={`btn sm ${value === 'relevant' ? 'vote-up' : 'vote-down'}`}
        data-testid={`vote-${value}`}
        aria-pressed={vote === value}
        disabled={!item.id || !!feedbackPending[item.id]}
        onClick={() => void sendFeedback(item, value)}
      >
        <Icon name={value === 'relevant' ? 'check' : 'ban'} />
        {value === 'relevant' ? 'Relevant' : 'Not relevant'}
      </button>
    ));
  }
  function renderResultCard(item: ResultItem, rank: number, dimmed = false) {
    const r = item.row,
      id = itemId(item),
      name = nameOf(r.row);
    const chip =
      r.chips.find((c) => c !== 'Semantic match') ||
      (r.chips.includes('Semantic match') ? 'Semantic match' : '');
    const why = rowWhy(r);
    return (
      <li
        key={id}
        id={`result-${id}`}
        className={`row ${activeId === id ? 'is-sel' : ''} ${dimmed ? 'dim' : ''} ${flashId === id ? 'flash' : ''}`}
        data-testid="result-row"
        data-rank={rank}
      >
        <button
          className="row-main"
          onClick={() => select(item)}
          aria-current={activeId === id ? 'true' : undefined}
          aria-label={`${dimmed ? 'Marked irrelevant' : `Result ${rank}`}: ${name}, ${getField(r.row, POSITION_KEYS)} at ${getField(r.row, COMPANY_KEYS)}`}
          aria-describedby={
            [chip ? `chip-${id}` : '', why ? `why-${id}` : ''].filter(Boolean).join(' ') || undefined
          }
        >
          <span className="rank">{dimmed ? '–' : rank}</span>
          <span className="row-b">
            <span className="row-l1">
              <span className="nm">{name}</span>
              {chip && (
                <span className="chips">
                  <span id={`chip-${id}`} className={`chip ${chip === 'Semantic match' ? 'acc' : ''}`}>
                    {chip}
                  </span>
                </span>
              )}
            </span>
            <span className="tc">
              {[getField(r.row, POSITION_KEYS) || 'No title', getField(r.row, COMPANY_KEYS)]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {why && (
              <span className="why" id={`why-${id}`}>
                {why}
              </span>
            )}
          </span>
        </button>
        <span className="row-side">
          <button
            className="icon-btn star"
            data-testid="star"
            aria-pressed={favoriteIds.has(item.id)}
            disabled={!item.id || favoritesBusy[item.id]}
            aria-label={`${favoriteIds.has(item.id) ? 'Remove' : 'Save'} ${name}${favoriteIds.has(item.id) ? ' from saved people' : ''}`}
            title={favoriteIds.has(item.id) ? 'Saved (S)' : 'Save (S)'}
            onClick={() => void toggleFavorite(item.id, item.row.row)}
          >
            <Icon name="star" />
          </button>
        </span>
        {(activeId === id || dimmed) && (
          <span
            className={`row-votes ${dimmed ? 'always' : ''}`}
            role="group"
            aria-label={`Is ${name} useful for this search?`}
          >
            {voteButtons(item)}
          </span>
        )}
      </li>
    );
  }
  const addedByMeaning = results.main.filter((i) =>
    i.row.reasons.some((r) => r.startsWith('Semantic match:')),
  );
  function showMeaning() {
    const item = addedByMeaning[0];
    if (!item) return;
    const id = itemId(item);
    setSelectedId(id);
    if (detailRoute.value) detailRoute.open(id, true);
    setFlashId(id);
    document.getElementById(`result-${id}`)?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    document.getElementById(`result-${id}`)?.querySelector<HTMLButtonElement>('.row-main')?.focus();
  }
  const detailedReasons = activeItem ? detailReasons(activeItem.row) : [];
  const similarity = activeItem?.row.reasons
    .find((r) => r.startsWith('Semantic match:'))
    ?.match(/similarity ([\d.]+)/)?.[1];
  const members =
    selectedPersonKey && common
      ? (common.othersByPerson.get(selectedPersonKey) || [])
          .map((uid) => common.members.find((m) => m.uid === uid)?.displayName)
          .filter(Boolean)
      : [];
  const importUI = (
    <div
      className="zero"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void handleFile(f);
      }}
    >
      <h2 ref={importHeading} tabIndex={-1}>
        Start by adding your LinkedIn export
      </h2>
      <p>
        Search ranks people you already know for whatever you need, like “engineering manager” or “someone at
        Microsoft”.
      </p>
      <ImportSteps />
      <div className="drop-zone">
        <p>Drop your export here, or choose a file.</p>
        <button
          className="btn primary"
          disabled={saving || reading}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="upload" />
          Choose export file
        </button>
      </div>
      <p className="hint">
        Accepts a LinkedIn .zip, Connections.csv, or a .json list. Read in your browser; message text is never
        kept.
      </p>
      {importMode && (
        <button className="btn ghost" onClick={cancelImport}>
          Cancel
        </button>
      )}
    </div>
  );
  const changes = (
    <>
      <section className="d-sec">
        <h3>What changes</h3>
        <div className="cmp">
          <div className="panel">
            <div className="panel-b">
              <span className="muted">Now</span>
              <b>{shell.count == null ? 'Unknown' : shell.count.toLocaleString()}</b>
              <span className="hint">connections saved</span>
            </div>
          </div>
          <div className="panel">
            <div className="panel-b">
              <span className="muted">After</span>
              <b>{stagedRows.length.toLocaleString()}</b>
              <span className="hint">connections from this file</span>
            </div>
          </div>
        </div>
      </section>
      <section className="d-sec">
        <h3>Kept as they are</h3>
        <ul className="sig">
          {[
            'Your Relevant / Not relevant votes and saved people.',
            'Saved searches and your profile.',
            'Sharing setting. If you share, the Network page updates by itself.',
          ].map((line) => (
            <li key={line}>
              <Icon name="check" />
              {line}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
  return (
    <section
      id="v-search"
      aria-label="Search"
      className={`view split on ${detailRoute.value && !review && !importMode ? 'detail-open' : ''} ${refine ? 'refine-open' : ''} ${hasResults ? 'has-results' : ''}`}
    >
      <div className="pane list-pane">
        <div className="pane-head">
          <form
            className="toolbar"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <label className="sr-only" htmlFor="search-input">
              Who are you looking for?
            </label>
            <input
              ref={searchInput}
              className="input"
              id="search-input"
              data-testid="search-input"
              autoComplete="off"
              placeholder="Who can help? e.g. engineering manager"
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              disabled={!isConfirmed || importMode || loadingAccount}
            />
            <button
              className="btn primary"
              data-testid="search-submit"
              disabled={!canSearch || searching || aiReranking || importMode}
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
            <button
              className="icon-btn save-q"
              type="button"
              data-testid="save-search"
              ref={saveToggle}
              aria-label="Save this search"
              title="Save this search"
              aria-expanded={showSave}
              disabled={!criteria.trim() || !isConfirmed || importMode}
              onClick={() => setShowSave((v) => !v)}
            >
              <Icon name="bookmark" />
            </button>
          </form>
          <div className="search-refinements">
            <div className="semantic-options" hidden={importMode || review || loadingAccount || !isConfirmed}>
              <React.Suspense fallback={null}>
                <SemanticSearchToggle
                  disabled={!isConfirmed}
                  onChange={(ranker) => {
                    semanticRanker.current = ranker;
                  }}
                />
              </React.Suspense>
            </div>
            <div
              className="metabar search-controls"
              hidden={importMode || review || loadingAccount || !isConfirmed || tab !== 'results'}
            >
              <span>
                Top {results.main.length} of {rankedCount}
              </span>
              <span className="sp" />
              <button
                className="btn sm refine-btn"
                aria-expanded={refine}
                onClick={() => setRefine((v) => !v)}
              >
                <Icon name="sort" />
                {refine ? 'Hide options' : 'Refine'}
              </button>
              <label className="check">
                <input
                  type="checkbox"
                  data-testid="title-only"
                  checked={strictTitleOnly}
                  onChange={(e) => setStrictTitleOnly(e.target.checked)}
                  disabled={!isConfirmed}
                />
                Title matches only
              </label>
              <button
                className="btn sm"
                data-ai-rerank
                data-testid="reorder-ai"
                disabled={ai.disabled || !hasResults || !canSearch || searching || aiReranking}
                title={
                  ai.checking
                    ? 'Checking whether AI features are available…'
                    : ai.disabled
                      ? ai.message
                      : 'Ask AI to reorder the best matches'
                }
                onClick={() => void aiRerank()}
              >
                <Icon name="spark" />
                {aiReranking ? 'Asking AI…' : 'Reorder with AI'}
              </button>
            </div>
          </div>
          {addedByMeaning.length > 0 && !importMode && (
            <div className="sem-found">
              <span>
                +{addedByMeaning.length} found by meaning: <b>{nameOf(addedByMeaning[0].row.row)}</b>
              </span>
              <button className="btn sm" onClick={showMeaning}>
                Show
              </button>
            </div>
          )}
          {!importMode && !review && (
            <div className="tabs" role="tablist" aria-label="Search lists">
              {(
                [
                  ['results', 'Results', results.main.length],
                  ['saved-people', 'Saved people', favorites.length],
                  ['saved-searches', 'Saved searches', shell.saved.length],
                ] as const
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  className="tab"
                  id={`tab-${id}`}
                  role="tab"
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  onKeyDown={(e) => {
                    const ids = ['results', 'saved-people', 'saved-searches'] as const;
                    const i = ids.indexOf(id);
                    const next =
                      e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? 2
                          : e.key === 'ArrowRight'
                            ? (i + 1) % 3
                            : e.key === 'ArrowLeft'
                              ? (i + 2) % 3
                              : -1;
                    if (next >= 0) {
                      e.preventDefault();
                      setTab(ids[next]);
                      document.getElementById(`tab-${ids[next]}`)?.focus();
                    }
                  }}
                  aria-controls="search-body"
                  data-testid={`tab-${id}`}
                  onClick={() => setTab(id)}
                >
                  {label} <span className="n">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={fileInput}
          className="sr-only"
          tabIndex={-1}
          type="file"
          data-testid="import-file-input"
          aria-label="Import LinkedIn export"
          accept=".zip,.csv,.json"
          disabled={saving}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <div className="pane-body" id="search-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {(error || aiError || feedbackError) && (
            <p className="note bad" role="alert">
              {error || aiError || feedbackError}
            </p>
          )}
          <SavedSearches
            criteria={criteria}
            strictTitleOnly={strictTitleOnly}
            canRun={isConfirmed}
            busy={searching || aiReranking}
            onRun={runSavedSearch}
            showForm={showSave && !importMode}
            showList={tab === 'saved-searches' && !importMode}
            onSaved={() => {
              setShowSave(false);
              saveToggle.current?.focus();
            }}
            onCancel={() => {
              setShowSave(false);
              saveToggle.current?.focus();
            }}
          />
          {loadingAccount ? (
            <p className="zero" role="status">
              Loading your saved connections…
            </p>
          ) : reading ? (
            <div className="zero" role="status">
              <p>Reading {fileName}…</p>
              <button className="btn" onClick={cancelImport}>
                Cancel
              </button>
            </div>
          ) : review ? (
            <div className="imp stack" data-testid="import-summary">
              <div>
                <h2 ref={importHeading} tabIndex={-1}>
                  Check your import
                </h2>
                <p className="hint">Nothing is saved until you confirm.</p>
                <p className="mono break-text">{fileName}</p>
              </div>
              <table className="imp-table">
                <caption className="sr-only">Files used</caption>
                <thead>
                  <tr>
                    <th>File used</th>
                    <th>Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {(importSummary?.filesUsed || [{ name: fileName, rows: stagedRows.length }]).map((f) => (
                    <tr key={f.name}>
                      <td>{f.name}</td>
                      <td>{f.rows.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importCoverage.length > 0 && (
                <div>
                  <h3>Match coverage</h3>
                  <ul className="hint">
                    {importCoverage.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <h3>Your profile context</h3>
                <p className="hint">
                  {!stagedContext
                    ? 'No profile files in this import (connections only).'
                    : contextCounts.length
                      ? `Found: ${contextCounts.join(' · ')}`
                      : 'Profile files found, but they were empty.'}
                </p>
              </div>
              {importSummary?.warnings.map((w, i) => (
                <p className="note warn" key={i}>
                  {w}
                </p>
              ))}
              {!!importSummary?.filesSkipped.length && (
                <details>
                  <summary>
                    <Icon name="chev" className="chev" />
                    {importSummary.filesSkipped.length} files skipped (not read)
                  </summary>
                  <p className="hint break-text">{importSummary.filesSkipped.join(', ')}</p>
                </details>
              )}
              <p className="hint">Message text is never stored; only counts and dates.</p>
              <p className="hint">
                AI requests include relationship facts (message counts, last contact month, shared employers)
                but never your notes or job applications.
              </p>
              <div className="import-mobile-changes">{changes}</div>
              <div className="actions import-actions">
                <button
                  className="btn primary import-confirm"
                  data-testid="import-confirm"
                  disabled={!hasStaged || saving}
                  onClick={confirmConnections}
                >
                  {saving
                    ? 'Saving…'
                    : shell.count != null && shell.count > 0
                      ? `Replace my ${shell.count.toLocaleString()} connections with these ${stagedRows.length.toLocaleString()}`
                      : `Save these ${stagedRows.length.toLocaleString()} connections`}
                </button>
                <button className="btn" disabled={saving} onClick={() => fileInput.current?.click()}>
                  Choose a different file
                </button>
                <button className="btn ghost" disabled={saving} onClick={cancelImport}>
                  Cancel
                </button>
              </div>
            </div>
          ) : importMode || (!isConfirmed && tab === 'results') ? (
            importUI
          ) : tab === 'saved-people' ? (
            <FavoritesList
              favorites={favorites}
              loading={favoritesLoading}
              notice={favoritesNotice}
              busy={favoritesBusy}
              selectedId={favorite?.id}
              onOpen={(f) => {
                setSelectedId(favoritePersonId(f));
                detailRoute.open(favoritePersonId(f));
              }}
              onRemove={(f) =>
                void toggleFavorite(f.id, {
                  'Full Name': f.name,
                  Position: f.position,
                  Company: f.company,
                  URL: f.url,
                })
              }
            />
          ) : tab === 'results' ? (
            <>
              {(ai.disabled || showsFreeTierNotice(ai)) && (
                <p className="hint ai-search-note">
                  {ai.checking
                    ? 'Checking whether AI features are available…'
                    : ai.disabled
                      ? ai.rerankNote
                      : AI_FREE_TIER_NOTICE}
                </p>
              )}
              {searching ? (
                <div role="status">
                  <span className="sr-only">Searching…</span>
                  {Array.from({ length: 8 }, (_, i) => (
                    <div className="skel" key={i} aria-hidden="true">
                      <i />
                      <div>
                        <i className="w1" />
                        <i className="w2" />
                        <i className="w3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : hasResults ? (
                <>
                  <ul className="rows" aria-label="People who could help">
                    {results.main.map((item, i) => renderResultCard(item, i + 1))}
                  </ul>
                  {!!results.irrelevant.length && (
                    <details ref={irrelevantGroup} data-testid="irrelevant-group">
                      <summary className="group-h">
                        <Icon name="chev" className="chev" />
                        Marked irrelevant ({results.irrelevant.length})
                      </summary>
                      <ul className="rows">
                        {results.irrelevant.map((item) => renderResultCard(item, 0, true))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <div className="zero">
                  <h2>{resultsQuery ? `No one matches “${resultsQuery}”` : 'People who could help'}</h2>
                  <p>
                    {resultsQuery
                      ? `Try fewer or broader words, such as a role or company.${strictTitleOnly ? ' Turn off Title matches only to widen your search.' : ''}`
                      : 'Describe who you are looking for. Search ranks your connections and explains each match.'}
                  </p>
                </div>
              )}
              <div className="search-data-actions">
                <button className="linkbtn" disabled={saving} onClick={() => setImportMode(true)}>
                  Import a new export
                </button>
                <button className="linkbtn" disabled={saving} onClick={clearLoaded}>
                  Clear loaded data
                </button>
              </div>
            </>
          ) : null}
        </div>
        <StatusFooter search />
      </div>
      <DetailPane open={!!detailRoute.value && !review && !importMode} onClose={detailRoute.close}>
        {review ? (
          changes
        ) : activePerson && !importMode ? (
          <>
            <PersonHeading person={activePerson} />
            <div className="d-actions">
              <button
                className="btn"
                data-testid="star"
                aria-pressed={favoriteIds.has(activeStarId)}
                disabled={!activeStarId || favoritesBusy[activeStarId]}
                onClick={() => void toggleFavorite(activeStarId, activeRow!)}
              >
                <Icon name="star" />
                {favoriteIds.has(activeStarId) ? 'Saved' : 'Save'}
              </button>
              {activeItem && voteButtons(activeItem)}
            </div>
            {activeItem && (
              <section className="d-sec">
                <h3>Why this person</h3>
                <ul className="sig">
                  {detailedReasons.map((reason, i) => (
                    <li key={i}>
                      <Icon name={/^(Moved |Added:)/.test(reason) ? 'info' : 'check'} />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
                <details className="order-details">
                  <summary>
                    <Icon name="chev" className="chev" />
                    How the order is built
                  </summary>
                  <table className="score">
                    <tbody>
                      <tr>
                        <td>Relevance tier</td>
                        <td>{activeItem.row.terms}</td>
                      </tr>
                      <tr>
                        <td>Relevance score</td>
                        <td>{activeItem.row.relevance}</td>
                      </tr>
                      <tr>
                        <td>Relationship bonus</td>
                        <td>+{activeItem.row.score - activeItem.row.relevance}</td>
                      </tr>
                      {similarity && (
                        <tr>
                          <td>Semantic similarity</td>
                          <td>{similarity}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <p className="hint">
                    Better matches come first; your relationship only changes the order within a relevance
                    tier.
                  </p>
                  {activeItem.row.reasons.some((r) => r.startsWith('AI:')) && (
                    <p className="hint">Reordered by AI</p>
                  )}
                </details>
              </section>
            )}
            <PersonFacts person={activePerson} />
            {common && (
              <section className="d-sec">
                <h3>Members who also know {personName(activePerson).split(' ')[0]}</h3>
                <p>
                  {members.length ? members.join(', ') : 'No other sharing members found for this person.'}
                </p>
                {selectedPersonKey && members.length > 0 && (
                  <Link
                    className="btn sm network-link"
                    to={`/network?node=${encodeURIComponent('p:' + selectedPersonKey)}`}
                  >
                    <Icon name="network" />
                    Show in Network
                  </Link>
                )}
              </section>
            )}
          </>
        ) : (
          <div className="empty-pane">
            <p>
              {importMode || !isConfirmed
                ? 'Your export is read in your browser. Only the selected files are opened; message text is never kept.'
                : 'Pick a person from the list to see their details.'}
            </p>
          </div>
        )}
      </DetailPane>
    </section>
  );
};
export default RecommenderScreen;
