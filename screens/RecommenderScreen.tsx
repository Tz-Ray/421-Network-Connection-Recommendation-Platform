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

  // LinkedIn exports: scan until we find a row with First Name + Last Name
  for (let i = 0; i < table.length; i++) {
    const r = table[i];
    if (hasHeader(r, 'First Name') && hasHeader(r, 'Last Name')) return i;
  }

  // fallback: first non-empty row
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

    // Add derived Full Name for LinkedIn-like schemas
    const first = getField(obj, ['First Name', 'first_name', 'firstname']);
    const last = getField(obj, ['Last Name', 'last_name', 'lastname']);
    if (first || last) obj['Full Name'] = `${first} ${last}`.trim();

    out.push(obj);
  }

  return out;
}

// -----------------------------
// Ranking / search
// - Weighted substring matches on key fields
// - Explanations based on which fields matched
// -----------------------------
function scoreRow(row: Row, tokens: string[]): RankedRow {
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

    const tokens = tokenizeQuery(criteria);
    if (!tokens.length) return;

    const ranked = confirmedRows
      .map((r) => scoreRow(r, tokens))
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
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white">
              Connection Recommender 
            </h1>
            <p className="text-slate-400 mt-1 text-sm">
              Step 1: Upload CSV → Step 2: Review connections → Step 3: Confirm → Step 4: Search.
            </p>
          </div>

          {/* Step 1: Upload */}
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
          </div>

          {/* Step 2: Preview connections + Step 3 confirm */}
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
                  title="In the future, this is where we will save uploaded connections to a user account."
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

          {/* Step 4: Search (enabled only after confirm) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-7 glass-panel rounded-xl p-4 md:p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Criteria</p>

              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="Example: healthcare, CTO, fundraising, enterprise sales..."
                className="w-full min-h-[120px] mac-input rounded-lg p-3 text-sm text-slate-100 placeholder:text-slate-500"
                disabled={!isConfirmed}
              />

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {!hasStaged
                    ? 'Upload a file first.'
                    : !isConfirmed
                    ? 'Confirm connections to enable search.'
                    : 'Search matches Name / Position / Company (and other columns as fallback).'}
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

                        {(email || url) && (
                          <div className="mt-2 text-[11px] text-slate-400 space-y-1">
                            {email && (
                              <p>
                                Email: <span className="text-slate-300">{email}</span>
                              </p>
                            )}
                            {url && (
                              <a
                                className="text-primary hover:underline inline-flex items-center gap-1"
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Icon name="open_in_new" className="text-sm" />
                                <span>Profile</span>
                              </a>
                            )}
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