// experimental/sql-insights/InsightsScreen.tsx
//
// EXPERIMENTAL (feature key `sql-insights`). Loaded only through the
// React.lazy import in App.tsx that exists when VITE_EXPERIMENTAL=on, so the
// production build contains none of this screen, sql.js or its .wasm.
//
// Runs SQL (sql.js: SQLite compiled to WebAssembly) over the signed-in user's
// own saved connections, entirely in this tab: the database lives in a Web
// Worker (insights.worker.ts), so a runaway query cannot freeze the page; it is
// stopped after a timeout and the worker is rebuilt (insightsClient.ts). It
// reads Firestore through the store (read-only) and writes nothing anywhere:
// no Firestore, no sessionStorage, no IndexedDB, no network.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Sidebar } from '../../components/Sidebar';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import { auth } from '../../firebase';
import { loadConnections, loadNetworkContext } from '../../lib/connectionsStore';
import { CARDS, FUNCTIONS_ABOUT, MAX_ROWS, SCHEMA, type InsightCard } from './insightsDb';
import { CELL_CHARS, RESULT_CHARS, TITLE_CHARS, cellDisplay, type Cell } from './resultLimits';
import { InsightsClient, type ClientStatus, type QueryOutcome } from './insightsClient';
import type { LimitedResult } from './workerCore';
import { loadSqlWasm } from './loadSqlJs';
// Inlined into this lazy chunk (no separate worker file), so a build without
// VITE_EXPERIMENTAL=on emits nothing for it.
import InsightsWorker from './insights.worker?worker&inline';

/** Time one editor query may run before its worker is stopped and rebuilt. */
const EDITOR_TIMEOUT_MS = 5_000;
/** Time all ready-made cards together may run. */
const CARDS_BUDGET_MS = 15_000;

/** Exactly one of `result` / `error` is set; `refused` marks a guard refusal, `stopped` a timeout. */
type Outcome = QueryOutcome;

type Phase =
  | { kind: 'loading'; step: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: number; buildMs: number; hasContext: boolean };

function errorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

/** Says when values or rows were cut; nothing when the result is complete. */
const ClipNote: React.FC<{ result: LimitedResult }> = ({ result }) => {
  if (!result.clippedTotal && result.clippedCells === 0) return null;
  return (
    <p className="text-xs text-amber-200/90 mb-2" data-testid="sql-result-truncated">
      {result.clippedTotal &&
        `Truncated: results are limited to ${RESULT_CHARS.toLocaleString()} characters, so only the first ${result.rows.length.toLocaleString()} row${result.rows.length === 1 ? '' : 's'} are shown. `}
      {result.clippedCells > 0 &&
        `Long values are cut to ${CELL_CHARS} characters (hover a cell for up to ${TITLE_CHARS.toLocaleString()}).`}
    </p>
  );
};

const ResultTable: React.FC<{ result: LimitedResult; maxHeight?: string }> = ({ result, maxHeight = 'max-h-[420px]' }) => {
  if (result.rows.length === 0) {
    return <p className="text-sm text-slate-400">No rows.</p>;
  }
  return (
    <div className={`overflow-auto custom-scrollbar ${maxHeight} rounded-xl border border-white/10`}>
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-background-dark/95 backdrop-blur border-b border-white/10">
          <tr className="text-left">
            {result.columns.map((c, i) => (
              <th key={i} className="p-2.5 text-xs font-extrabold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5">
              {row.map((v, j) => {
                if (v === null) {
                  return (
                    <td key={j} className="p-2.5 text-slate-300 align-top">
                      <span className="text-slate-600">—</span>
                    </td>
                  );
                }
                const d = cellDisplay(v);
                return (
                  <td key={j} title={d.title} className="p-2.5 text-slate-300 align-top [overflow-wrap:anywhere] max-w-[32rem]">
                    {d.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const BarView: React.FC<{ result: LimitedResult }> = ({ result }) => {
  const data = result.rows.map((r) => ({
    label: r[0] === null ? '(none)' : cellDisplay(r[0], 60).text,
    value: Number(r[1]) || 0,
  }));
  if (data.length === 0) return <p className="text-sm text-slate-400">No rows.</p>;
  const height = Math.max(140, data.length * 30 + 20);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{ background: '#101622', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
            labelStyle={{ color: '#e2e8f0' }}
            itemStyle={{ color: '#93c5fd' }}
            formatter={(v: number) => [v.toLocaleString(), result.columns[1] ?? 'value']}
          />
          <Bar dataKey="value" fill="#135bec" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

const CardView: React.FC<{
  card: InsightCard;
  outcome: Outcome | undefined;
  onRunInEditor: (card: InsightCard) => void;
}> = ({ card, outcome, onRunInEditor }) => (
  <section
    data-card={card.id}
    className="glass-panel rounded-xl bento-card p-4 md:p-6 flex flex-col gap-3 min-w-0"
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-lg font-bold text-white">{card.title}</h4>
        <p className="text-sm text-slate-400">{card.about}</p>
      </div>
      <button
        onClick={() => onRunInEditor(card)}
        className="shrink-0 bg-white/5 hover:bg-white/10 text-slate-200 text-sm font-bold py-2 px-3 rounded-lg flex items-center gap-1.5 whitespace-nowrap border border-white/10 transition-all active:scale-[0.98]"
      >
        <Icon name="code" className="text-base" />
        <span>Run in editor</span>
      </button>
    </div>

    {!outcome ? (
      <p className="text-sm text-slate-400">Running…</p>
    ) : outcome.error !== undefined || !outcome.result ? (
      <p
        data-stopped={outcome.stopped ? 'true' : 'false'}
        className="text-sm text-red-200 bg-red-500/10 border border-red-500/20 rounded-lg p-3"
      >
        {outcome.error}
      </p>
    ) : card.view === 'bar' ? (
      <BarView result={outcome.result} />
    ) : (
      <>
        <ClipNote result={outcome.result} />
        <ResultTable result={outcome.result} maxHeight="max-h-[300px]" />
      </>
    )}

    <details className="text-sm">
      <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none">
        Show SQL{outcome?.result ? ` · ${outcome.result.ms.toFixed(1)} ms` : ''}
      </summary>
      <pre className="mt-2 p-3 rounded-lg bg-black/30 border border-white/10 text-xs text-slate-300 overflow-x-auto custom-scrollbar whitespace-pre">
        {card.sql}
      </pre>
    </details>
  </section>
);

const InsightsScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>({ kind: 'loading', step: 'Loading your saved connections…' });
  const [cardOutcomes, setCardOutcomes] = useState<Record<string, Outcome>>({});
  const [editorSql, setEditorSql] = useState<string>(CARDS[0].sql);
  const [editorOutcome, setEditorOutcome] = useState<Outcome | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [dbStatus, setDbStatus] = useState<ClientStatus>('starting');

  const clientRef = useRef<InsightsClient | null>(null);
  const editorBusyRef = useRef(false);
  const alive = useRef(true);
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Terminate the worker (and its database) when the screen really unmounts.
  // StrictMode's simulated unmount runs before the worker exists, so it stops nothing.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, []);

  // StrictMode mounts effects twice in dev: the ref alone guards the load (a
  // cleanup `cancelled` flag would discard the only fetch). See CLAUDE.md.
  const loadStarted = useRef(false);
  useEffect(() => {
    if (loadStarted.current || !user) return;
    loadStarted.current = true;
    const uid = user.uid;

    void (async () => {
      try {
        const [docs, ctx] = await Promise.all([loadConnections(uid), loadNetworkContext(uid).catch(() => null)]);
        if (!alive.current || auth.currentUser?.uid !== uid) return;
        if (docs.length === 0) {
          setPhase({ kind: 'empty' });
          return;
        }

        setPhase({ kind: 'loading', step: `Building the database from ${docs.length.toLocaleString()} connections…` });
        const client = new InsightsClient({
          createWorker: () => new InsightsWorker(),
          onStatus: (s) => {
            if (alive.current) setDbStatus(s);
          },
        });
        clientRef.current = client;
        const { buildMs } = await client.init({ wasm: loadSqlWasm(), docs, ctx });
        if (!alive.current) return;
        setPhase({ kind: 'ready', rows: docs.length, buildMs, hasContext: ctx != null });

        // All cards share one time budget; each renders as soon as its answer arrives.
        const deadline = performance.now() + CARDS_BUDGET_MS;
        const stoppedMessage = `Stopped: the cards ran for more than ${CARDS_BUDGET_MS / 1000} s together.`;
        for (const c of CARDS) {
          void client.query(c.sql, { deadline, stoppedMessage }).then((o) => {
            if (alive.current) setCardOutcomes((prev) => ({ ...prev, [c.id]: o }));
          });
        }
      } catch (e) {
        if (alive.current) setPhase({ kind: 'error', message: `Could not load Insights: ${errorText(e)}` });
      }
    })();
  }, [user]);

  const runEditor = useCallback((sql: string) => {
    const client = clientRef.current;
    if (!client || editorBusyRef.current) return;
    editorBusyRef.current = true;
    setEditorBusy(true);
    void client
      .query(sql, {
        timeoutMs: EDITOR_TIMEOUT_MS,
        stoppedMessage: `Query stopped after ${EDITOR_TIMEOUT_MS / 1000} s. The database is being rebuilt in the background; you can run another query.`,
      })
      .then((o) => {
        editorBusyRef.current = false;
        if (!alive.current) return;
        setEditorBusy(false);
        setEditorOutcome(o);
      });
  }, []);

  const runInEditor = useCallback(
    (card: InsightCard) => {
      setEditorSql(card.sql);
      runEditor(card.sql);
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [runEditor]
  );

  const ready = phase.kind === 'ready';

  return (
    <div
      data-experimental="sql-insights"
      className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display"
    >
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-7xl mx-auto w-full">
          <div className="glass-panel rounded-xl p-4 md:p-6 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-2xl font-extrabold text-white">Insights</h2>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                  Experimental
                </span>
              </div>
              <p className="text-sm text-slate-400">
                SQL over your saved connections, run in this browser tab with SQLite (WebAssembly). Read-only;
                nothing is sent or saved anywhere, and note text is not loaded.
              </p>
            </div>
            {ready && (
              <p className="text-xs text-slate-400 whitespace-nowrap flex items-center gap-1.5">
                <Icon name="storage" className="text-sm" />
                {phase.rows.toLocaleString()} connections · built in {phase.buildMs.toFixed(0)} ms
                {phase.hasContext ? ' · with your profile data' : ''}
              </p>
            )}
          </div>

          {phase.kind === 'loading' && <p className="text-sm text-slate-400 mb-4">{phase.step}</p>}

          {phase.kind === 'error' && (
            <p role="alert" className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200">
              {phase.message}
            </p>
          )}

          {phase.kind === 'empty' && (
            <div className="glass-panel rounded-xl p-6 flex flex-col items-start gap-4">
              <p className="text-sm text-slate-300">
                No saved connections yet. Import your LinkedIn data export (.zip) or Connections.csv in the Recommender
                and confirm it; Insights then runs over the saved copy.
              </p>
              <button
                onClick={() => navigate('/recommender')}
                className="bg-primary hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 text-white font-bold py-2.5 px-4 rounded-lg flex items-center gap-2 transition-all active:scale-[0.98]"
              >
                <Icon name="upload_file" className="text-sm" />
                <span>Import in the Recommender</span>
              </button>
            </div>
          )}

          {ready && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-8">
                {CARDS.map((c) => (
                  <CardView key={c.id} card={c} outcome={cardOutcomes[c.id]} onRunInEditor={runInEditor} />
                ))}
              </div>

              <div ref={editorRef} className="glass-panel rounded-xl p-4 md:p-6 mb-8 scroll-mt-4" data-testid="sql-editor">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <h4 className="text-lg font-bold text-white">SQL editor</h4>
                    <p className="text-sm text-slate-400">
                      One SELECT (or WITH … SELECT) statement. Up to {MAX_ROWS} rows are shown; a query is stopped
                      after {EDITOR_TIMEOUT_MS / 1000} s. Ctrl+Enter runs it.
                    </p>
                  </div>
                  <button
                    onClick={() => runEditor(editorSql)}
                    disabled={editorBusy}
                    className="bg-primary hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 text-white font-bold py-2.5 px-4 rounded-lg flex items-center gap-2 whitespace-nowrap transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
                  >
                    <Icon name="play_arrow" className="text-sm" />
                    <span>Run query</span>
                  </button>
                </div>

                <textarea
                  aria-label="SQL query"
                  value={editorSql}
                  onChange={(e) => setEditorSql(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      runEditor(editorSql);
                    }
                  }}
                  spellCheck={false}
                  rows={9}
                  className="w-full mac-input rounded-lg p-3 font-mono text-xs text-slate-200 custom-scrollbar"
                />

                {(dbStatus === 'restarting' || dbStatus === 'broken') && (
                  <p className="mt-3 text-xs text-slate-400" data-testid="sql-db-status">
                    {dbStatus === 'restarting'
                      ? 'Rebuilding the database after a stopped query…'
                      : 'The database could not be rebuilt; reload the page to try again.'}
                  </p>
                )}

                <div className="mt-4" data-testid="sql-result">
                  {editorBusy && (
                    <p className="text-sm text-slate-400" data-testid="sql-running">
                      Running…
                    </p>
                  )}
                  {!editorBusy && editorOutcome?.error !== undefined && (
                    <p
                      role="alert"
                      data-refused={editorOutcome.refused ? 'true' : 'false'}
                      data-stopped={editorOutcome.stopped ? 'true' : 'false'}
                      className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200 flex items-start gap-2"
                    >
                      <Icon
                        name={editorOutcome.refused ? 'lock' : editorOutcome.stopped ? 'timer_off' : 'error_outline'}
                        className="text-base"
                      />
                      <span>
                        {editorOutcome.refused
                          ? `Not run: ${editorOutcome.error}`
                          : editorOutcome.stopped
                            ? editorOutcome.error
                            : `SQL error: ${editorOutcome.error}`}
                      </span>
                    </p>
                  )}
                  {!editorBusy && editorOutcome?.result && (
                    <>
                      <p className="text-xs text-slate-400 mb-2" data-testid="sql-result-summary">
                        {editorOutcome.result.capped
                          ? `Showing the first ${MAX_ROWS} rows (the query returned more).`
                          : `${editorOutcome.result.rows.length.toLocaleString()} row${editorOutcome.result.rows.length === 1 ? '' : 's'}`}
                        {` · ${editorOutcome.result.ms.toFixed(1)} ms`}
                      </p>
                      <ClipNote result={editorOutcome.result} />
                      <ResultTable result={editorOutcome.result} />
                    </>
                  )}
                </div>
              </div>

              <div className="glass-panel rounded-xl p-4 md:p-6" data-testid="sql-schema">
                <h4 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                  <Icon name="table_chart" className="text-base" />
                  Schema
                </h4>
                <p className="text-sm text-slate-400 mb-4">Tables you can query. The database lives only in this tab.</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {SCHEMA.map((t) => (
                    <div key={t.name} className="rounded-lg border border-white/10 bg-black/20 p-3 min-w-0">
                      <p className="font-mono text-sm font-bold text-primary">{t.name}</p>
                      <p className="text-xs text-slate-400 mb-2">{t.about}</p>
                      <ul className="space-y-0.5">
                        {t.columns.map((c) => (
                          <li key={c.name} className="text-xs text-slate-300 flex gap-2">
                            <span className="font-mono text-slate-100 shrink-0">{c.name}</span>
                            <span className="font-mono text-slate-500 shrink-0">{c.type}</span>
                            <span className="text-slate-400 min-w-0">{c.about}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <ul className="mt-4 space-y-1">
                  {FUNCTIONS_ABOUT.map((f) => (
                    <li key={f} className="text-xs text-slate-400 font-mono">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </main>

      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

export default InsightsScreen;
