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
  EMAIL_KEYS,
  FIRST_NAME_KEYS,
  FULL_NAME_KEYS,
  LAST_NAME_KEYS,
  POSITION_KEYS,
  SESSION_KEY,
  URL_KEYS,
  docToCompact,
  docToRow,
  loadConnections,
  saveConnections,
} from '../lib/connectionsStore';

type Row = Record<string, unknown>;

type RankedRow = {
  row: Row;
  score: number;
  matchedTokens: string[];
  reasons: string[];
};

type CandidateSummary = {
  id: string; // c0..cN
  name: string;
  position: string;
  company: string;
  email?: string;
  url?: string;
  connectedOn?: string;
};

const MAX_RESULTS = 10;
const AI_POOL_SIZE = 50;
const AI_BASE = (import.meta as any).env?.VITE_AI_PROXY_URL || 'http://localhost:8787';

// -----------------------------
// Aliases (INTENDED for title matching)
// -----------------------------
const ALIASES: Record<string, string[]> = {
  'software engineer': ['swe', 'software developer', 'developer', 'full stack', 'fullstack', 'backend', 'frontend', 'web developer'],
  swe: ['software engineer', 'software developer', 'developer'],
  developer: ['software engineer', 'software developer', 'full stack', 'backend', 'frontend'],
  'software developer': ['software engineer', 'developer'],
  'full stack': ['fullstack', 'frontend', 'backend', 'software engineer'],
  fullstack: ['full stack', 'frontend', 'backend', 'software engineer'],
  backend: ['back end', 'api', 'services', 'software engineer'],
  frontend: ['front end', 'ui', 'web developer', 'software engineer'],
  devops: ['sre', 'infrastructure', 'platform', 'cloud', 'ci/cd'],
  sre: ['devops', 'reliability', 'infrastructure'],
  security: ['infosec', 'appsec', 'security engineer'],

  'data scientist': ['data science', 'machine learning', 'ml', 'ai', 'statistics', 'analytics'],
  'data science': ['data scientist', 'data analyst', 'machine learning', 'ml', 'ai'],
  'data analyst': ['analytics', 'bi', 'sql', 'reporting'],
  'data engineer': ['etl', 'pipelines', 'warehousing', 'sql'],
  ml: ['machine learning', 'ai', 'data scientist'],
  ai: ['machine learning', 'ml', 'data science'],

  pm: ['product manager', 'product management'],
  'product manager': ['pm', 'product management', 'roadmap'],
  sales: ['account executive', 'business development', 'revenue', 'gtm'],
  gtm: ['go-to-market', 'sales', 'marketing', 'growth'],
  ae: ['account executive', 'sales'],
  'account executive': ['ae', 'sales'],
  csm: ['customer success manager', 'customer success'],

  ceo: ['founder', 'chief executive officer'],
  cto: ['chief technology officer', 'engineering leader', 'architecture'],
  cfo: ['chief financial officer', 'finance'],
  coo: ['chief operating officer', 'operations'],
};

function expandWithAliases(text: string): string {
  const lower = text.toLowerCase();
  const extras: string[] = [];

  for (const [key, vals] of Object.entries(ALIASES)) {
    if (key.length <= 3) {
      const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower)) extras.push(...vals);
    } else {
      if (lower.includes(key)) extras.push(...vals);
    }
  }

  return extras.length ? `${text} ${extras.join(' ')}` : text;
}

// -----------------------------
// Helpers
// -----------------------------
function toText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(toText).join(' ');
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

function normalizeKey(k: string) {
  return k.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function getField(row: Row, keys: string[]): string {
  const keySet = new Set(keys.map(normalizeKey));
  for (const [k, v] of Object.entries(row)) {
    if (keySet.has(normalizeKey(k))) return toText(v);
  }
  return '';
}

function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,;]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function isRoleQuery(criteria: string): boolean {
  const c = normalizeText(criteria);
  const roleHints = [
    'engineer', 'developer', 'software', 'fullstack', 'backend', 'frontend', 'devops', 'sre',
    'data', 'scientist', 'analyst', 'designer', 'product', 'manager', 'director', 'vp',
    'cto', 'cfo', 'coo', 'ceo', 'founder', 'sales', 'marketing', 'account', 'executive'
  ];
  return roleHints.some((k) => c.includes(k));
}

// Company stopwords / low-signal tokens that cause junk matches
const COMPANY_STOPWORDS = new Set([
  'inc', 'llc', 'ltd', 'co', 'company', 'corp', 'corporation',
  'group', 'partners', 'capital', 'ventures', 'holdings',
  'technologies', 'technology', 'tech', 'systems', 'solutions', 'services',
  'engineering', 'engineer', 'web', 'app', 'apps', 'labs', 'studio', 'studios',
  'consulting', 'associates'
]);

function filterCompanyTokens(tokens: string[]): string[] {
  return tokens
    .map((t) => t.toLowerCase())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !COMPANY_STOPWORDS.has(t));
}

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

// -----------------------------
// RFC-4180-ish CSV parser
// -----------------------------
function parseCsvRfc4180(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;

      row.push(cell);
      cell = '';

      const isEmpty = row.every((v) => v.trim() === '');
      if (!isEmpty) rows.push(row.map((v) => v.trim()));

      row = [];
      continue;
    }

    cell += ch;
  }

  row.push(cell);
  if (!row.every((v) => v.trim() === '')) {
    rows.push(row.map((v) => v.trim()));
  }

  return rows;
}

function findHeaderRowIndex(table: string[][]): number {
  const hasHeader = (r: string[], header: string) =>
    r.some((c) => normalizeKey(c) === normalizeKey(header));

  for (let i = 0; i < table.length; i++) {
    const r = table[i];
    if (hasHeader(r, 'First Name') && hasHeader(r, 'Last Name')) return i;
  }

  return table.length > 0 ? 0 : -1;
}

function parseCsvToObjects(text: string): Row[] {
  const table = parseCsvRfc4180(text);
  const headerIdx = findHeaderRowIndex(table);
  if (headerIdx === -1) return [];

  const headers = table[headerIdx].map((h) => h.trim());
  const dataRows = table.slice(headerIdx + 1);

  const out: Row[] = [];

  for (const r of dataRows) {
    if (r.every((v) => v.trim() === '')) continue;

    const obj: Row = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      obj[key] = (r[c] ?? '').trim();
    }

    // Only synthesize a full name when the export did not already supply one.
    if (!getField(obj, FULL_NAME_KEYS).trim()) {
      const first = getField(obj, FIRST_NAME_KEYS);
      const last = getField(obj, LAST_NAME_KEYS);
      if (first || last) obj['Full Name'] = `${first} ${last}`.trim();
    }

    out.push(obj);
  }

  return out;
}

// -----------------------------
// Scoring (hard guards against stopword leakage)
// -----------------------------
function scoreRow(
  row: Row,
  titleTokens: string[],
  rawCompanyTokens: string[],
  criteriaNormalized: string,
  roleQuery: boolean,
  strictTitleOnly: boolean
): RankedRow {
  const fullName =
    getField(row, FULL_NAME_KEYS) ||
    `${getField(row, FIRST_NAME_KEYS)} ${getField(row, LAST_NAME_KEYS)}`.trim();

  const position = getField(row, POSITION_KEYS);
  const company = getField(row, COMPANY_KEYS);

  const pos = normalizeText(position);
  const comp = normalizeText(company);

  const companyTokens = filterCompanyTokens(rawCompanyTokens);

  const phraseHit = criteriaNormalized.length >= 4 && pos.includes(criteriaNormalized);

  const titleHits: string[] = [];
  const companyHits: string[] = [];

  for (const t of titleTokens) {
    if (t && pos.includes(t)) titleHits.push(t);
  }

  for (const t of companyTokens) {
    if (t && comp.includes(t)) companyHits.push(t);
  }

  const uniqTitle = Array.from(new Set(titleHits));
  const uniqCompany = Array.from(new Set(companyHits));

  if (roleQuery && strictTitleOnly && uniqTitle.length === 0 && !phraseHit) {
    return { row, score: 0, matchedTokens: [], reasons: [] };
  }

  if (uniqTitle.length === 0 && uniqCompany.length === 0 && !phraseHit) {
    return { row, score: 0, matchedTokens: [], reasons: [] };
  }

  let score = 0;
  const reasons: string[] = [];

  if (phraseHit) {
    score += 50;
    reasons.push(`Title phrase match: "${criteriaNormalized}"`);
  }

  if (uniqTitle.length) {
    score += 20 * uniqTitle.length;
    reasons.push(`Title match: ${uniqTitle.slice(0, 8).join(', ')}`);
  }

  if (uniqCompany.length) {
    const base = 2 * uniqCompany.length;
    const penalty = roleQuery && uniqTitle.length === 0 && !phraseHit ? 0.2 : 1.0;
    score += Math.max(1, Math.floor(base * penalty));

    if (roleQuery && uniqTitle.length === 0 && !phraseHit) {
      reasons.push(`Weak match (company-only): ${uniqCompany.slice(0, 8).join(', ')}`);
    } else {
      reasons.push(`Company match: ${uniqCompany.slice(0, 8).join(', ')}`);
    }
  }

  const nameLower = normalizeText(fullName);
  for (const t of companyTokens) {
    if (t && nameLower.includes(t)) score += 2;
  }

  const matchedTokens = Array.from(new Set([...uniqTitle, ...uniqCompany]));

  if (roleQuery && (!position || position === '-' || position === '—')) {
    reasons.push('Note: this connection has no title in the CSV export.');
  }

  return { row, score, matchedTokens, reasons };
}

function compactRow(row: Row) {
  const name =
    getField(row, FULL_NAME_KEYS) ||
    `${getField(row, FIRST_NAME_KEYS)} ${getField(row, LAST_NAME_KEYS)}`.trim();

  return {
    name: name || '(no name)',
    position: getField(row, POSITION_KEYS) || '',
    company: getField(row, COMPANY_KEYS) || '',
    email: getField(row, EMAIL_KEYS) || '',
    url: getField(row, URL_KEYS) || '',
    connectedOn: getField(row, CONNECTED_ON_KEYS) || '',
  };
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

  function resetForNewFile(newFileName: string) {
    setFileName(newFileName);
    setError('');
    setAiError('');
    setAiInfo('');
    setSaveInfo('');
    setResults([]);
    setCriteria('');
    setConfirmedRows([]);
    setPageIndex(0);
  }

  async function handleFile(file: File) {
    datasetVersion.current += 1;
    resetForNewFile(file.name);

    try {
      // Reading the file can reject (permissions, the file moved, a decode
      // error); keep that inside the same catch as the parse failures.
      const text = await file.text();

      let parsed: Row[] = [];

      if (file.name.toLowerCase().endsWith('.json')) {
        const json = JSON.parse(text);
        if (!Array.isArray(json)) throw new Error('JSON must be an array of objects.');

        const objects = json.filter(
          (r: unknown): r is Row =>
            r != null && typeof r === 'object' && !Array.isArray(r)
        );
        if (!objects.length) throw new Error('JSON file must be an array of objects.');

        parsed = objects;
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        parsed = parseCsvToObjects(text);
      } else {
        throw new Error('Unsupported file type. Please upload a .csv or .json file.');
      }

      if (!parsed.length) throw new Error('No rows found in file.');

      const colSet = new Set<string>();
      for (const r of parsed.slice(0, 100)) Object.keys(r).forEach((k) => colSet.add(k));

      setStagedRows(parsed);
      setColumns(Array.from(colSet));
    } catch (e: any) {
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
    setConfirmedRows(stagedRows);
    setResults([]);
    setCriteria('');
    setAiError('');

    try {
      const compact = stagedRows.map(compactRow);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(compact));
      setAiInfo(`AI dataset updated (${compact.length.toLocaleString()} connections).`);
    } catch {
      setAiInfo('AI dataset could not be stored (sessionStorage blocked).');
    }

    // Fire-and-forget: persist to the signed-in user's account. Local search must
    // work immediately and must not wait on (or fail because of) this write.
    const user = getAuth().currentUser;
    if (user) {
      const rowsToSave = stagedRows;
      setSaving(true);
      setSaveInfo(`Saving ${rowsToSave.length.toLocaleString()} connections to your account…`);

      void saveConnections(user.uid, rowsToSave)
        .then((n) => setSaveInfo(`Saved ${n.toLocaleString()} connections to your account.`))
        .catch((e: any) =>
          setSaveInfo(`Could not save to account: ${e?.message ?? 'unknown error'}`)
        )
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
        const docs = await loadConnections(uid);
        if (stale()) return;

        const rows: Row[] = docs.map(docToRow);

        const colSet = new Set<string>();
        for (const r of rows.slice(0, 100)) Object.keys(r).forEach((k) => colSet.add(k));

        setFileName(`Saved connections (${rows.length.toLocaleString()})`);
        setColumns(Array.from(colSet));
        setStagedRows(rows);
        setConfirmedRows(rows);
        setResults([]);
        setCriteria('');
        setAiError('');
        setPageIndex(0);
        setSaveInfo(`Loaded ${rows.length.toLocaleString()} connections from your account.`);

        try {
          const compact = docs.map(docToCompact);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(compact));
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
    } catch {
      // sessionStorage blocked; there is nothing cached to clear.
    }

    setFileName('');
    setStagedRows([]);
    setConfirmedRows([]);
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

    const roleQuery = isRoleQuery(criteria);
    const expanded = expandWithAliases(criteria);

    const titleTokens = tokenizeQuery(expanded);
    const companyTokens = tokenizeQuery(criteria);
    const critNorm = normalizeText(criteria);

    const rankedAll = confirmedRows
      .map((r) => scoreRow(r, titleTokens, companyTokens, critNorm, roleQuery, strictTitleOnly))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const top = rankedAll.slice(0, MAX_RESULTS);
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

    const roleQuery = isRoleQuery(criteria);
    const expanded = expandWithAliases(criteria);

    const titleTokens = tokenizeQuery(expanded);
    const companyTokens = tokenizeQuery(criteria);
    const critNorm = normalizeText(criteria);

    const scoredAll = confirmedRows
      .map((r) => scoreRow(r, titleTokens, companyTokens, critNorm, roleQuery, strictTitleOnly))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const pool = scoredAll.slice(0, AI_POOL_SIZE);
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
      };
    });

    setAiReranking(true);
    try {
      const resp = await fetch(`${AI_BASE}/gemini/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: expanded, candidates }),
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
              Upload CSV → Review → Confirm → Search (AI reasons now render fully even with quotes).
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
                    accept=".csv,.json"
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

          {/* Preview + Confirm */}
          <div className="glass-panel rounded-xl p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Loaded connections (preview)
                </p>
                <p className="text-sm text-slate-400">
                  {hasStaged ? `Browse the list. Confirm to enable search + AI tab.` : `Upload a CSV/JSON to preview.`}
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
                    disabled={!canSearch || aiReranking}
                    className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] border ${
                      !canSearch || aiReranking
                        ? 'bg-white/5 text-slate-600 border-white/10 cursor-not-allowed'
                        : 'bg-white/5 hover:bg-white/10 text-slate-200 border-white/10'
                    }`}
                    title="Use Gemini (via local proxy) to rerank best candidates and provide stronger reasons."
                  >
                    <Icon name="smart_toy" className="text-sm" />
                    <span>{aiReranking ? 'Reranking…' : 'AI Rerank'}</span>
                  </button>
                </div>
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
                            {r.reasons.slice(0, 5).map((reason, i) => (
                              <p key={i} className="text-slate-400">
                                <span className="text-slate-300 font-bold">•</span> {reason}
                              </p>
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