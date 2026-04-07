// screens/RecommenderScreen.tsx
import React, { useMemo, useState } from 'react';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';

type Row = Record<string, unknown>;

type RankedRow = {
  row: Row;
  score: number;
  matchedTokens: string[];
  reasons: string[];
};

const MAX_RESULTS = 10;

// -----------------------------
// Key / value helpers
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
  // normalize for matching headers like "Email Address" vs "email_address"
  return k
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ''); // keep alnum only
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

// -----------------------------
// RFC-4180-ish CSV parser
// - Handles commas, quotes, escaped quotes
// - Handles newlines inside quoted fields
// - Splits rows only on newline outside quotes
// -----------------------------
function parseCsvRfc4180(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, ''); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (ch === '"') {
      // Escaped quote
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
      // Handle CRLF
      if (ch === '\r' && next === '\n') i++;

      row.push(cell);
      cell = '';

      // Skip completely empty lines
      const isEmpty = row.every((v) => v.trim() === '');
      if (!isEmpty) rows.push(row.map((v) => v.trim()));

      row = [];
      continue;
    }

    cell += ch;
  }

  // last cell
  row.push(cell);
  if (!row.every((v) => v.trim() === '')) {
    rows.push(row.map((v) => v.trim()));
  }

  return rows;
}

function findHeaderRowIndex(table: string[][]): number {
  // LinkedIn export: scan until we find a row containing First Name + Last Name
  const has = (r: string[], s: string) =>
    r.some((c) => c.trim().toLowerCase() === s.toLowerCase());

  for (let i = 0; i < table.length; i++) {
    const r = table[i];
    if (has(r, 'First Name') && has(r, 'Last Name')) return i;
  }

  // fallback: first row
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
    // ignore short / blank rows
    if (r.every((v) => v.trim() === '')) continue;

    const obj: Row = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] || `col_${c}`;
      obj[key] = (r[c] ?? '').trim();
    }

    // If it looks like LinkedIn schema, add a derived full name field
    const first = getField(obj, ['First Name', 'first_name', 'firstname']);
    const last = getField(obj, ['Last Name', 'last_name', 'lastname']);
    if (first || last) {
      obj['Full Name'] = `${first} ${last}`.trim();
    }

    out.push(obj);
  }

  return out;
}

// -----------------------------
// Baseline (fallback) keyword scoring
// -----------------------------
function scoreRowKeyword(row: Row, tokens: string[]): RankedRow {
  // LinkedIn fields (and fallbacks)
  const fullName =
    getField(row, ['Full Name']) ||
    `${getField(row, ['First Name', 'first_name', 'firstname'])} ${getField(row, [
      'Last Name',
      'last_name',
      'lastname',
    ])}`.trim();

  const position = getField(row, ['Position', 'title', 'role', 'position']);
  const company = getField(row, ['Company', 'org', 'company', 'organization', 'firm']);
  const email = getField(row, ['Email Address', 'email', 'email_address']);
  const url = getField(row, ['URL', 'profile', 'linkedin', 'link']);
  const connectedOn = getField(row, ['Connected On', 'connected_on', 'connectedon', 'date']);

  const allText = Object.values(row).map(toText).join(' ');

  const fieldText = {
    name: fullName.toLowerCase(),
    position: position.toLowerCase(),
    company: company.toLowerCase(),
    email: email.toLowerCase(),
    url: url.toLowerCase(),
    connectedOn: connectedOn.toLowerCase(),
    all: allText.toLowerCase(),
  };

  const weights = {
    name: 6,
    position: 4,
    company: 4,
    email: 2,
    url: 2,
    connectedOn: 1,
    all: 1,
  };

  const matchedByField: Record<keyof typeof fieldText, Set<string>> = {
    name: new Set(),
    position: new Set(),
    company: new Set(),
    email: new Set(),
    url: new Set(),
    connectedOn: new Set(),
    all: new Set(),
  };

  let score = 0;

  for (const t of tokens) {
    if (!t) continue;

    // Count token once, in the best matching field
    const checks: Array<[keyof typeof fieldText, number]> = [
      ['name', weights.name],
      ['position', weights.position],
      ['company', weights.company],
      ['email', weights.email],
      ['url', weights.url],
      ['connectedOn', weights.connectedOn],
      ['all', weights.all],
    ];

    for (const [field, w] of checks) {
      if (fieldText[field].includes(t)) {
        score += w;
        matchedByField[field].add(t);
        break;
      }
    }
  }

  const matchedTokens = Array.from(
    new Set(Object.values(matchedByField).flatMap((s) => Array.from(s)))
  );

  const reasons: string[] = [];
  const pushReason = (label: string, field: keyof typeof matchedByField) => {
    const arr = Array.from(matchedByField[field]);
    if (arr.length) reasons.push(`${label}: ${arr.slice(0, 8).join(', ')}`);
  };

  pushReason('Name match', 'name');
  pushReason('Position match', 'position');
  pushReason('Company match', 'company');
  pushReason('Email match', 'email');

  if (!reasons.length && matchedTokens.length) reasons.push(`Matched: ${matchedTokens.join(', ')}`);

  return { row, score, matchedTokens, reasons };
}

// -----------------------------
// Lightweight “semantic” matcher (fully local)
// TF-IDF + cosine similarity + small synonym/alias expansion
// -----------------------------

// Very small stopword list (keeps vectors cleaner)
const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','else','with','without','to','of','in','on','at','for','from','by','as',
  'i','we','you','they','he','she','it','this','that','these','those','is','are','was','were','be','been','being',
  'need','needs','looking','seeking','find','someone','person','candidate','intro','introduction'
]);

// Phrase/term expansions for common roles/abbreviations
// (Extend this list over time as you see real queries.)
const ALIASES: Record<string, string[]> = {
  // --- Acronyms / shorthand ---
  "cs": ["computer science", "software engineer", "software engineering", "developer", "programming", "coding", "swe", "data scientist", "data science"],
  "swe": ["software engineer", "software developer", "engineer", "software development"],
  "sde": ["software engineer", "software developer", "engineer", "software development"],
  "pm": ["product manager", "product management", "product"],
  "tpm": ["technical program manager", "program manager", "project manager"],
  "pmo": ["program management", "project management"],
  "sdr": ["sales development representative", "sales", "lead generation", "outbound"],
  "bdr": ["business development representative", "sales", "lead generation", "outbound"],
  "ae": ["account executive", "sales", "closing", "quota"],
  "csm": ["customer success manager", "customer success", "account management", "retention"],
  "revops": ["revenue operations", "sales operations", "marketing operations", "go-to-market operations"],
  "salesops": ["sales operations", "revenue operations", "crm", "pipeline"],
  "mops": ["marketing operations", "demand generation", "marketing automation"],
  "fp&a": ["financial planning", "financial analysis", "finance", "budgeting", "forecasting"],

  // --- Founder / leadership ---
  "founder": ["cofounder", "ceo", "startup", "entrepreneur", "founding"],
  "cofounder": ["founder", "ceo", "startup", "founding"],

  "ceo": ["chief executive officer", "founder", "executive", "leadership", "strategy"],
  "coo": ["chief operating officer", "operations", "operator", "scaling", "process"],
  "cfo": ["chief financial officer", "finance", "fundraising", "fp&a", "controller", "accounting"],
  "cto": ["chief technology officer", "engineering leader", "software", "architecture", "technical leadership"],
  "cio": ["chief information officer", "it leader", "security", "systems"],
  "ciso": ["chief information security officer", "security", "infosec", "risk"],
  "cpo": ["chief product officer", "product leadership", "product strategy", "product management"],
  "cmo": ["chief marketing officer", "marketing leadership", "growth", "brand", "demand gen"],
  "cro": ["chief revenue officer", "sales leadership", "go-to-market", "revenue", "growth"],
  "vp": ["vice president", "leadership", "head of"],
  "director": ["head of", "leader", "management"],
  "head": ["head of", "director", "leadership"],

  // --- VC / investing (optional) ---
  "partner": ["general partner", "gp", "investor", "venture capital"],
  "principal": ["investor", "venture capital", "deal lead"],
  "associate": ["investor", "venture capital", "sourcing"],
  "analyst": ["research", "analysis", "investor"],
  "venture": ["venture capital", "investor", "startup"],
  "investor": ["venture capital", "angel", "capital", "funding"],

  // --- Engineering families ---
  "engineer": ["developer", "software engineer", "software developer", "engineering"],
  "software engineer": ["developer", "software development", "programming", "coding", "computer science"],
  "software developer": ["developer", "software engineer", "programming", "coding"],
  "full stack": ["fullstack", "frontend", "backend", "web developer", "software engineer"],
  "fullstack": ["full stack", "frontend", "backend", "web developer", "software engineer"],
  "backend": ["back end", "api", "services", "software engineer"],
  "back end": ["backend", "api", "services", "software engineer"],
  "frontend": ["front end", "ui", "web developer", "software engineer"],
  "front end": ["frontend", "ui", "web developer", "software engineer"],
  "mobile": ["ios", "android", "mobile engineer", "app developer"],
  "ios": ["mobile", "iphone", "swift", "mobile engineer"],
  "android": ["mobile", "kotlin", "mobile engineer"],
  "devops": ["site reliability", "sre", "infrastructure", "cloud", "ci/cd", "platform"],
  "sre": ["site reliability engineer", "devops", "infrastructure", "reliability"],
  "platform engineer": ["platform", "devops", "infrastructure", "cloud"],
  "security": ["infosec", "application security", "ciso", "security engineer"],
  "qa": ["quality assurance", "test engineer", "automation"],
  "test engineer": ["qa", "quality assurance", "automation"],
  "engineering manager": ["em", "people manager", "engineering leadership"],
  "em": ["engineering manager", "engineering leadership"],

  // --- Data / AI families ---
  "data science": ["data scientist", "data analyst", "analytics", "machine learning", "ml", "statistics", "ai"],
  "data scientist": ["data science", "machine learning", "ml", "statistics", "analytics"],
  "ml engineer": ["machine learning engineer", "ml", "ai", "modeling", "data scientist"],
  "machine learning": ["ml", "data scientist", "data science", "ai"],
  "ml": ["machine learning", "data science", "data scientist", "ai"],
  "ai": ["artificial intelligence", "machine learning", "ml", "data science"],
  "data analyst": ["analytics", "business intelligence", "bi", "sql", "reporting"],
  "bi": ["business intelligence", "analytics", "dashboards", "reporting"],
  "analytics engineer": ["analytics", "data", "sql", "pipelines"],
  "data engineer": ["data pipelines", "etl", "warehousing", "sql", "spark"],
  "research scientist": ["research", "machine learning", "ai", "data science"],

  // --- Product / design ---
  "product manager": ["pm", "product management", "product strategy", "roadmap"],
  "technical product manager": ["product manager", "pm", "technical", "engineering"],
  "program manager": ["project manager", "tpm", "delivery", "operations"],
  "project manager": ["program manager", "delivery", "coordination"],
  "ux designer": ["product designer", "user experience", "ux", "ui"],
  "ux": ["user experience", "product designer", "ux designer"],
  "ui": ["user interface", "visual design", "product designer"],
  "product designer": ["ux", "ui", "design", "user experience"],

  // --- Sales / GTM ---
  "sales": ["go-to-market", "gtm", "account executive", "business development", "revenue"],
  "gtm": ["go-to-market", "sales", "marketing", "growth"],
  "account executive": ["ae", "sales", "closing", "quota"],
  "sales manager": ["sales leadership", "team lead", "revenue"],
  "sales director": ["sales leadership", "vp sales", "revenue"],
  "vp sales": ["sales leadership", "sales director", "revenue"],
  "business development": ["biz dev", "partnerships", "alliances", "sales"],
  "biz dev": ["business development", "partnerships", "alliances", "sales"],
  "partnerships": ["business development", "alliances", "strategic partnerships"],
  "customer success": ["csm", "retention", "account management"],
  "customer success manager": ["csm", "customer success", "retention", "account management"],
  "account manager": ["customer success", "retention", "renewals"],

  // --- Marketing / growth ---
  "marketing": ["growth", "demand generation", "content", "brand"],
  "growth": ["marketing", "acquisition", "activation", "retention"],
  "demand generation": ["demand gen", "performance marketing", "lead gen"],
  "demand gen": ["demand generation", "performance marketing", "lead gen"],
  "product marketing": ["positioning", "messaging", "go-to-market"],
  "content marketing": ["content", "brand", "communications"],
  "pr": ["public relations", "communications", "brand"],

  // --- Ops / finance / legal / people ---
  "operations": ["ops", "coo", "operator", "process", "scaling"],
  "ops": ["operations", "coo", "operator", "process", "scaling"],
  "finance": ["cfo", "fp&a", "accounting", "controller"],
  "controller": ["accounting", "finance", "bookkeeping", "close"],
  "accounting": ["controller", "finance", "bookkeeping"],
  "legal": ["general counsel", "counsel", "contracts", "compliance"],
  "counsel": ["lawyer", "legal", "contracts"],
  "general counsel": ["legal", "lawyer", "contracts", "compliance"],
  "hr": ["people ops", "talent", "recruiting", "human resources"],
  "recruiter": ["recruiting", "talent acquisition", "hiring"],
  "talent acquisition": ["recruiting", "recruiter", "hiring"],
  "people ops": ["hr", "talent", "employee experience"],
};

function normalizeToken(t: string): string {
  const cleaned = t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!cleaned) return '';
  // Very light stemming for common suffixes
  if (cleaned.length > 4) {
    if (cleaned.endsWith('ing')) return cleaned.slice(0, -3);
    if (cleaned.endsWith('ed')) return cleaned.slice(0, -2);
    if (cleaned.endsWith('s')) return cleaned.slice(0, -1);
  }
  return cleaned;
}

function tokenizeForTfidf(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/g)
    .map((t) => normalizeToken(t))
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));

  return raw;
}

function expandWithAliases(text: string): string {
  const lower = text.toLowerCase();
  const extras: string[] = [];

  for (const [key, vals] of Object.entries(ALIASES)) {
    // Use word boundaries for short keys like "cs", "ml", "pm"
    if (key.length <= 3) {
      const re = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(lower)) extras.push(...vals);
    } else {
      if (lower.includes(key)) extras.push(...vals);
    }
  }

  return extras.length ? `${text} ${extras.join(' ')}` : text;
}

type SparseVec = Map<number, number>;
type TfidfIndex = {
  tokenToIndex: Map<string, number>;
  indexToToken: string[];
  idf: Float32Array;
  docVecs: SparseVec[];       // aligned with rows order
  docNorms: Float32Array;     // aligned with rows order
};

function buildDocText(row: Row): string {
  // Focus on the fields users tend to search on
  const fullName =
    getField(row, ['Full Name']) ||
    `${getField(row, ['First Name', 'first_name', 'firstname'])} ${getField(row, [
      'Last Name',
      'last_name',
      'lastname',
    ])}`.trim();

  const position = getField(row, ['Position', 'title', 'role', 'position']);
  const company = getField(row, ['Company', 'org', 'company', 'organization', 'firm']);

  const base = `${fullName} ${position} ${company}`.trim();

  // Add alias expansions to help semantic-ish matching
  return expandWithAliases(base);
}

function buildTfidfIndex(rows: Row[]): TfidfIndex | null {
  if (!rows.length) return null;

  // 1) Build vocabulary + df
  const tokenToIndex = new Map<string, number>();
  const indexToToken: string[] = [];
  const df = new Map<number, number>();

  const docTokens: string[][] = rows.map((r) => tokenizeForTfidf(buildDocText(r)));

  for (const tokens of docTokens) {
    const seen = new Set<number>();
    for (const tok of tokens) {
      let idx = tokenToIndex.get(tok);
      if (idx === undefined) {
        idx = indexToToken.length;
        tokenToIndex.set(tok, idx);
        indexToToken.push(tok);
      }
      if (!seen.has(idx)) {
        seen.add(idx);
        df.set(idx, (df.get(idx) ?? 0) + 1);
      }
    }
  }

  const N = rows.length;
  const idfArr = new Float32Array(indexToToken.length);
  for (let i = 0; i < indexToToken.length; i++) {
    const dfi = df.get(i) ?? 0;
    // Smooth IDF: log((N+1)/(df+1)) + 1
    idfArr[i] = Math.log((N + 1) / (dfi + 1)) + 1;
  }

  // 2) Build per-doc TF-IDF sparse vectors + norms
  const docVecs: SparseVec[] = [];
  const docNorms = new Float32Array(N);

  for (let di = 0; di < N; di++) {
    const tokens = docTokens[di];
    const counts = new Map<number, number>();
    for (const tok of tokens) {
      const idx = tokenToIndex.get(tok);
      if (idx === undefined) continue;
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
    }

    const total = tokens.length || 1;
    const vec: SparseVec = new Map();
    let norm2 = 0;

    for (const [idx, c] of counts.entries()) {
      const tf = c / total;
      const w = tf * idfArr[idx];
      vec.set(idx, w);
      norm2 += w * w;
    }

    docVecs.push(vec);
    docNorms[di] = Math.sqrt(norm2) || 0;
  }

  return { tokenToIndex, indexToToken, idf: idfArr, docVecs, docNorms };
}

function buildQueryVec(index: TfidfIndex, query: string): { vec: SparseVec; norm: number } {
  // Expand query with aliases (e.g., "cs" -> "software engineer", "data science" -> "data analyst", etc.)
  const expanded = expandWithAliases(query);
  const tokens = tokenizeForTfidf(expanded);

  const counts = new Map<number, number>();
  for (const tok of tokens) {
    const idx = index.tokenToIndex.get(tok);
    if (idx === undefined) continue;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  const total = tokens.length || 1;
  const vec: SparseVec = new Map();
  let norm2 = 0;

  for (const [idx, c] of counts.entries()) {
    const tf = c / total;
    const w = tf * index.idf[idx];
    vec.set(idx, w);
    norm2 += w * w;
  }

  return { vec, norm: Math.sqrt(norm2) || 0 };
}

function rankRowsSemantic(index: TfidfIndex, rows: Row[], criteria: string, limit: number): RankedRow[] {
  const q = buildQueryVec(index, criteria);
  if (!q.norm || q.vec.size === 0) return [];

  const results: RankedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const dVec = index.docVecs[i];
    const dNorm = index.docNorms[i];
    if (!dNorm) continue;

    let dot = 0;
    const contribs: Array<[number, number]> = [];

    for (const [idx, qw] of q.vec.entries()) {
      const dw = dVec.get(idx);
      if (!dw) continue;
      const c = qw * dw;
      dot += c;
      contribs.push([idx, c]);
    }

    const sim = dot / (dNorm * q.norm);
    if (!Number.isFinite(sim) || sim <= 0) continue;

    contribs.sort((a, b) => b[1] - a[1]);
    const topTokens = contribs.slice(0, 8).map(([idx]) => index.indexToToken[idx]);

    results.push({
      row: rows[i],
      // keep score roughly human-readable
      score: Math.round(sim * 1000),
      matchedTokens: topTokens,
      reasons: topTokens.length ? [`Semantic match: ${topTokens.slice(0, 6).join(', ')}`] : [],
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// -----------------------------
// Screen
// -----------------------------
const RecommenderScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  // stagedRows: parsed rows immediately after upload
  // confirmedRows: the snapshot after user clicks "Confirm Connections"
  const [fileName, setFileName] = useState<string>('');
  const [stagedRows, setStagedRows] = useState<Row[]>([]);
  const [confirmedRows, setConfirmedRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string>('');

  const [criteria, setCriteria] = useState<string>('');
  const [results, setResults] = useState<RankedRow[]>([]);

  // Preview pagination (so “all connections” is browsable even for thousands)
  const [pageSize, setPageSize] = useState<number>(50);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const hasStaged = stagedRows.length > 0;
  const isConfirmed = confirmedRows.length > 0;

  const canSearch = isConfirmed && criteria.trim().length > 0;

  // Precompute TF-IDF index whenever the confirmed dataset changes
  const tfidfIndex = useMemo(() => buildTfidfIndex(confirmedRows), [confirmedRows]);

  const stats = useMemo(() => {
    return {
      stagedCount: stagedRows.length,
      confirmedCount: confirmedRows.length,
      colCount: columns.length,
    };
  }, [stagedRows, confirmedRows, columns]);

  const previewRows = stagedRows; // show what was loaded (before confirm)
  const totalPages = Math.max(1, Math.ceil(previewRows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  const previewSlice = useMemo(() => {
    const start = safePageIndex * pageSize;
    return previewRows.slice(start, start + pageSize);
  }, [previewRows, safePageIndex, pageSize]);

  function resetForNewFile(newFileName: string) {
    setFileName(newFileName);
    setError('');
    setResults([]);
    setCriteria('');
    setConfirmedRows([]); // require confirm again
    setPageIndex(0);
  }

  async function handleFile(file: File) {
    resetForNewFile(file.name);

    const text = await file.text();

    try {
      let parsed: Row[] = [];

      if (file.name.toLowerCase().endsWith('.json')) {
        const json = JSON.parse(text);
        if (!Array.isArray(json)) throw new Error('JSON must be an array of objects.');
        parsed = json as Row[];
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        parsed = parseCsvToObjects(text);
      } else {
        throw new Error('Unsupported file type. Please upload a .csv or .json file.');
      }

      if (!parsed.length) throw new Error('No rows found in file.');

      // Collect columns (sample first 100 rows)
      const colSet = new Set<string>();
      for (const r of parsed.slice(0, 100)) {
        Object.keys(r).forEach((k) => colSet.add(k));
      }

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

    // Snapshot: later this is where you'd write to Firestore tied to a user.
    setConfirmedRows(stagedRows);
    setResults([]);
    setCriteria('');
  }

  function clearLoaded() {
    setFileName('');
    setStagedRows([]);
    setConfirmedRows([]);
    setColumns([]);
    setError('');
    setResults([]);
    setCriteria('');
    setPageIndex(0);
  }

  function runSearch() {
    if (!canSearch) return;

    // 1) Try local semantic ranking (TF-IDF + cosine + alias expansion)
    if (tfidfIndex) {
      const semantic = rankRowsSemantic(tfidfIndex, confirmedRows, criteria, MAX_RESULTS);
      if (semantic.length) {
        setResults(semantic);
        return;
      }
    }

    // 2) Fallback: weighted keyword matching
    const tokens = tokenizeQuery(expandWithAliases(criteria));
    if (!tokens.length) return;

    const ranked = confirmedRows
      .map((r) => scoreRowKeyword(r, tokens))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS);

    setResults(ranked);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-7xl mx-auto w-full space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white">
                Connection Recommender (Prototype)
              </h1>
              <p className="text-slate-400 mt-1 text-sm">
                Upload a LinkedIn Connections CSV (or JSON), confirm, and search using a local semantic matcher (TF-IDF).
              </p>
            </div>
          </div>

          {/* Upload + dataset summary */}
          <div className="glass-panel rounded-xl p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Network file
                </p>
                <div className="flex items-center gap-2">
                  <Icon name="upload_file" className="text-primary" />
                  <p className="font-semibold text-white">
                    {fileName ? fileName : 'No file loaded'}
                  </p>
                </div>
                {hasStaged && (
                  <p className="text-sm text-slate-400 mt-1">
                    Loaded {stats.stagedCount.toLocaleString()} connections • {stats.colCount} columns detected
                    {isConfirmed ? (
                      <span className="ml-2 text-primary font-bold">• Ready to search</span>
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
          </div>

          {/* Preview connections + confirm */}
          <div className="glass-panel rounded-xl p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Loaded connections (preview)
                </p>
                <p className="text-sm text-slate-400">
                  {hasStaged
                    ? `Browse the full list (paginated). Then confirm to enable search.`
                    : `Upload a CSV/JSON to preview connections here.`}
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
                  disabled={!hasStaged}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
                    hasStaged ? 'bg-primary hover:bg-primary/90 text-white' : 'bg-white/5 text-slate-600 border border-white/10 cursor-not-allowed'
                  }`}
                >
                  <Icon name={isConfirmed ? 'check_circle' : 'check'} className="text-sm" />
                  <span>{isConfirmed ? 'Confirmed' : 'Confirm Connections'}</span>
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
                        <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Email</th>
                        <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewSlice.map((r, i) => {
                        const name =
                          getField(r, ['Full Name']) ||
                          `${getField(r, ['First Name', 'first_name', 'firstname'])} ${getField(r, [
                            'Last Name',
                            'last_name',
                            'lastname',
                          ])}`.trim() ||
                          '(no name)';

                        const pos = getField(r, ['Position', 'title', 'role', 'position']);
                        const comp = getField(r, ['Company', 'org', 'company', 'organization', 'firm']);
                        const connectedOn = getField(r, ['Connected On', 'connected_on', 'connectedon', 'date']);
                        const email = getField(r, ['Email Address', 'email', 'email_address']);
                        const url = getField(r, ['URL', 'profile', 'linkedin', 'link']);

                        return (
                          <tr key={`${safePageIndex}-${i}`} className="border-b border-white/5 hover:bg-white/5">
                            <td className="p-3 font-bold text-slate-100 whitespace-nowrap">{name}</td>
                            <td className="p-3 text-slate-300">{pos || <span className="text-slate-600">—</span>}</td>
                            <td className="p-3 text-slate-300">{comp || <span className="text-slate-600">—</span>}</td>
                            <td className="p-3 text-slate-400 whitespace-nowrap">
                              {connectedOn || <span className="text-slate-600">—</span>}
                            </td>
                            <td className="p-3 text-slate-400">{email || <span className="text-slate-600">—</span>}</td>
                            <td className="p-3">
                              {url ? (
                                <a
                                  className="text-primary hover:underline inline-flex items-center gap-1"
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <Icon name="open_in_new" className="text-sm" />
                                  <span className="text-xs font-bold">Open</span>
                                </a>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
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
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Criteria
              </p>
              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="Example: computer science, data science, healthcare, CTO, fundraising..."
                className="w-full min-h-[120px] mac-input rounded-lg p-3 text-sm text-slate-100 placeholder:text-slate-500"
                disabled={!isConfirmed}
              />

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {!hasStaged
                    ? 'Load a file first.'
                    : !isConfirmed
                    ? 'Confirm connections to enable search.'
                    : 'Uses TF-IDF + aliases (local/offline).'}
                </p>

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
              </div>
            </div>

            <div className="lg:col-span-5 glass-panel rounded-xl p-4 md:p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Top Matches
              </p>

              {!isConfirmed ? (
                <div className="text-sm text-slate-400">Confirm the loaded connections to run a search.</div>
              ) : results.length === 0 ? (
                <div className="text-sm text-slate-400">Run a search to see results.</div>
              ) : (
                <div className="space-y-3">
                  {results.map((r, idx) => {
                    const name =
                      getField(r.row, ['Full Name']) ||
                      `${getField(r.row, ['First Name', 'first_name', 'firstname'])} ${getField(r.row, [
                        'Last Name',
                        'last_name',
                        'lastname',
                      ])}`.trim() ||
                      '(no name)';

                    const title = getField(r.row, ['Position', 'title', 'role', 'position']);
                    const org = getField(r.row, ['Company', 'org', 'company', 'organization', 'firm']);
                    const email = getField(r.row, ['Email Address', 'email', 'email_address']);
                    const url = getField(r.row, ['URL', 'profile', 'linkedin', 'link']);
                    const connectedOn = getField(r.row, ['Connected On', 'connected_on', 'connectedon', 'date']);

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

                        {(email || connectedOn) && (
                          <div className="mt-2 text-[11px] text-slate-400 space-y-1">
                            {email && (
                              <p>
                                Email: <span className="text-slate-300">{email}</span>
                              </p>
                            )}
                            {connectedOn && (
                              <p>
                                Connected On: <span className="text-slate-300">{connectedOn}</span>
                              </p>
                            )}
                          </div>
                        )}

                        {url && (
                          <div className="mt-2">
                            <a
                              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Icon name="open_in_new" className="text-sm" />
                              <span>Profile</span>
                            </a>
                          </div>
                        )}

                        {r.reasons.length > 0 && (
                          <div className="mt-3 text-xs text-slate-300 space-y-1">
                            {r.reasons.slice(0, 3).map((reason, i) => (
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

      {/* Decorative Background Orbs */}
      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

export default RecommenderScreen;