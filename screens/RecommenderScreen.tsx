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
      // escaped quote
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
      // handle CRLF
      if (ch === '\r' && next === '\n') i++;

      row.push(cell);
      cell = '';

      // skip blank lines
      const isEmpty = row.every((v) => v.trim() === '');
      if (!isEmpty) rows.push(row.map((v) => v.trim()));

      row = [];
      continue;
    }

    cell += ch;
  }

  // last row
  row.push(cell);
  if (!row.every((v) => v.trim() === '')) {
    rows.push(row.map((v) => v.trim()));
  }

  return rows;
}

function findHeaderRowIndex(table: string[][]): number {
  // LinkedIn export: scan until we find a row containing First Name + Last Name
  const hasHeader = (r: string[], header: string) =>
    r.some((c) => normalizeKey(c) === normalizeKey(header));

  for (let i = 0; i < table.length; i++) {
    const r = table[i];
    if (hasHeader(r, 'First Name') && hasHeader(r, 'Last Name')) return i;
  }

  // fallback: if no LinkedIn header detected, assume first non-empty row is header
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
// Optional: parse Connected On date flexibly (best-effort)
// Not required for keyword search, but useful to display/sort later.
// -----------------------------
function parseConnectedOn(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // Try native parse first (handles ISO, many locale formats)
  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) return native;

  // Try "DD MMM YYYY" like "20 Feb 2022"
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const day = Number(m[1]);
    const monStr = m[2].toLowerCase();
    const year = Number(m[3]);

    const months: Record<string, number> = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };

    const key = monStr.slice(0, 3);
    const mon = months[monStr] ?? months[key];
    if (mon != null && !Number.isNaN(day) && !Number.isNaN(year)) {
      const d = new Date(Date.UTC(year, mon, day));
      if (!Number.isNaN(d.getTime())) return d;
    }
  }

  // Try US numeric: MM/DD/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mm = Number(m2[1]);
    const dd = Number(m2[2]);
    const yyyy = Number(m2[3]);
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

// -----------------------------
// Ranking / search (simple “database search”)
// - Weighted substring matches on key fields
// - Explanations based on which fields matched
// -----------------------------
function scoreRow(row: Row, tokens: string[]): RankedRow {
  // LinkedIn fields (and fallbacks)
  const fullName =
    getField(row, ['Full Name']) ||
    `${getField(row, ['First Name', 'first_name', 'firstname'])} ${getField(row, ['Last Name', 'last_name', 'lastname'])}`.trim();

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

  // Store a parsed date (best-effort) without losing raw data
  if (connectedOn && row['Connected On Parsed'] == null) {
    const parsed = parseConnectedOn(connectedOn);
    if (parsed) row['Connected On Parsed'] = parsed.toISOString();
  }

  return { row, score, matchedTokens, reasons };
}

// -----------------------------
// Screen
// -----------------------------
const RecommenderScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState<string>('');

  const [criteria, setCriteria] = useState<string>('');
  const [results, setResults] = useState<RankedRow[]>([]);

  const canSearch = rows.length > 0 && criteria.trim().length > 0;

  const stats = useMemo(() => {
    return {
      loaded: rows.length > 0,
      rowCount: rows.length,
      colCount: columns.length,
    };
  }, [rows, columns]);

  async function handleFile(file: File) {
    setError('');
    setResults([]);
    setCriteria('');
    setFileName(file.name);

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

      setRows(parsed);
      setColumns(Array.from(colSet));
    } catch (e: any) {
      setRows([]);
      setColumns([]);
      setError(e?.message ?? 'Failed to parse file.');
    }
  }

  function runSearch() {
    if (!canSearch) return;

    const tokens = tokenizeQuery(criteria);
    if (!tokens.length) return;

    const ranked = rows
      .map((r) => scoreRow({ ...r }, tokens)) // shallow copy so derived fields don’t mutate original array unexpectedly
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
                Upload a LinkedIn Connections CSV (or JSON), enter criteria, and run a simple search (no saving yet).
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
                {stats.loaded && (
                  <p className="text-sm text-slate-400 mt-1">
                    Loaded {stats.rowCount.toLocaleString()} rows • {stats.colCount} columns detected
                  </p>
                )}
              </div>

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
            </div>

            {error && (
              <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            {stats.loaded && columns.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Detected columns (sample)
                </p>
                <div className="flex flex-wrap gap-2">
                  {columns.slice(0, 18).map((c) => (
                    <span
                      key={c}
                      className="text-[11px] px-2 py-1 rounded-md bg-white/5 border border-white/10 text-slate-300"
                    >
                      {c}
                    </span>
                  ))}
                  {columns.length > 18 && (
                    <span className="text-[11px] px-2 py-1 rounded-md bg-white/5 border border-white/10 text-slate-400">
                      +{columns.length - 18} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Criteria + search + results */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-7 glass-panel rounded-xl p-4 md:p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Criteria
              </p>
              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="Example: healthcare, Spokane, CTO, fundraising, enterprise sales..."
                className="w-full min-h-[120px] mac-input rounded-lg p-3 text-sm text-slate-100 placeholder:text-slate-500"
              />

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {rows.length === 0
                    ? 'Load a file first.'
                    : 'Tip: keywords match Name / Position / Company (and other columns as fallback).'}
                </p>

                <button
                  onClick={runSearch}
                  disabled={!canSearch}
                  className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
                    canSearch
                      ? 'bg-primary hover:bg-primary/90 text-white'
                      : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/10'
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

              {results.length === 0 ? (
                <div className="text-sm text-slate-400">
                  {rows.length === 0 ? <p>Upload a network file to begin.</p> : <p>Run a search to see results.</p>}
                </div>
              ) : (
                <div className="space-y-3">
                  {results.map((r, idx) => {
                    const name =
                      getField(r.row, ['Full Name']) ||
                      `${getField(r.row, ['First Name', 'first_name', 'firstname'])} ${getField(r.row, ['Last Name', 'last_name', 'lastname'])}`.trim() ||
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
                            {email && <p>Email: <span className="text-slate-300">{email}</span></p>}
                            {connectedOn && <p>Connected On: <span className="text-slate-300">{connectedOn}</span></p>}
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