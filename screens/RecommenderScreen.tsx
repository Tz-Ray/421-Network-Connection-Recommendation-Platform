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

// ---------- helpers ----------
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
  return k.trim().toLowerCase().replace(/\s+/g, '_');
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

// Basic CSV parser (handles commas + quotes; assumes no newlines inside quoted fields)
function parseCsv(text: string): Row[] {
  const clean = text.replace(/^\uFEFF/, ''); // strip BOM
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        // escaped quote
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headers = parseLine(lines[0]);
  const rows: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    const row: Row = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] ?? `col_${c}`;
      row[key] = cells[c] ?? '';
    }
    rows.push(row);
  }

  return rows;
}

function scoreRow(row: Row, tokens: string[]): RankedRow {
  // Try to detect common fields (works even if CSV columns differ slightly)
  const name = getField(row, ['name', 'full_name', 'fullname']);
  const title = getField(row, ['title', 'role', 'position']);
  const org = getField(row, ['org', 'company', 'organization', 'firm']);
  const industry = getField(row, ['industry', 'sector']);
  const expertise = getField(row, ['expertise', 'skills', 'keywords', 'tags']);
  const location = getField(row, ['location', 'city', 'region']);

  const fieldText = {
    name: name.toLowerCase(),
    title: title.toLowerCase(),
    org: org.toLowerCase(),
    industry: industry.toLowerCase(),
    expertise: expertise.toLowerCase(),
    location: location.toLowerCase(),
    all: Object.values(row).map(toText).join(' ').toLowerCase(),
  };

  const weights = {
    name: 6,
    expertise: 5,
    title: 4,
    org: 4,
    industry: 3,
    location: 2,
    all: 1,
  };

  const matchedByField: Record<string, Set<string>> = {
    name: new Set(),
    expertise: new Set(),
    title: new Set(),
    org: new Set(),
    industry: new Set(),
    location: new Set(),
    all: new Set(),
  };

  let score = 0;

  for (const t of tokens) {
    if (!t) continue;

    // Count token once, in the "best" matching field
    const checks: Array<[keyof typeof fieldText, number]> = [
      ['name', weights.name],
      ['expertise', weights.expertise],
      ['title', weights.title],
      ['org', weights.org],
      ['industry', weights.industry],
      ['location', weights.location],
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
    if (arr.length) reasons.push(`${label}: ${arr.slice(0, 6).join(', ')}`);
  };

  pushReason('Name match', 'name');
  pushReason('Expertise match', 'expertise');
  pushReason('Title match', 'title');
  pushReason('Org match', 'org');
  pushReason('Industry match', 'industry');
  pushReason('Location match', 'location');
  if (!reasons.length && matchedTokens.length) reasons.push(`Matched: ${matchedTokens.join(', ')}`);

  return { row, score, matchedTokens, reasons };
}

// ---------- component ----------
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
        parsed = parseCsv(text);
      } else {
        throw new Error('Unsupported file type. Please upload a .csv or .json file.');
      }

      if (!parsed.length) throw new Error('No rows found in file.');

      // Collect columns
      const colSet = new Set<string>();
      for (const r of parsed.slice(0, 50)) {
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white">
                Connection Recommender
              </h1>
              <p className="text-slate-400 mt-1 text-sm">
                Upload a CSV/JSON network file, enter criteria, and get top matches.
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

          {/* Criteria + search */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-7 glass-panel rounded-xl p-4 md:p-6">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Criteria
              </p>
              <textarea
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="Example: Spokane healthcare operator, fundraising, enterprise sales..."
                className="w-full min-h-[120px] mac-input rounded-lg p-3 text-sm text-slate-100 placeholder:text-slate-500"
              />

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {rows.length === 0
                    ? 'Load a file first.'
                    : 'Tip: use keywords like industry, role, skills, company, etc.'}
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
                Results
              </p>

              {results.length === 0 ? (
                <div className="text-sm text-slate-400">
                  {rows.length === 0 ? (
                    <p>Upload a network file to begin.</p>
                  ) : (
                    <p>Run a search to see top matches.</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {results.map((r, idx) => {
                    const name = getField(r.row, ['name', 'full_name', 'fullname']) || '(no name)';
                    const title = getField(r.row, ['title', 'role', 'position']);
                    const org = getField(r.row, ['org', 'company', 'organization', 'firm']);

                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-white/10 bg-white/5 hover:border-primary/30 transition-colors p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-white leading-tight">{name}</p>
                            {(title || org) && (
                              <p className="text-xs text-slate-400 mt-1">
                                {[title, org].filter(Boolean).join(' • ')}
                              </p>
                            )}
                          </div>
                          <div className="text-xs font-extrabold text-primary bg-primary/15 border border-primary/20 px-2 py-1 rounded-md">
                            Score {r.score}
                          </div>
                        </div>

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
                            {r.matchedTokens.slice(0, 8).map((t) => (
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

      {/* Decorative Background Orbs (matches Dashboard vibe) */}
      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

export default RecommenderScreen;