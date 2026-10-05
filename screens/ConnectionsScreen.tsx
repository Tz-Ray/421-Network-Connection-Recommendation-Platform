import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/AuthContext';
import {
  docToRow,
  loadConnections,
  loadNetworkContext,
  type ConnectionDoc,
  type NetworkContext,
} from '../lib/connectionsStore';
import { relationshipSignals } from '../lib/relationship';
import { auth } from '../firebase';
import {
  MAX_GRAPH_KEYS,
  isGraphMember,
  joinGraph,
  leaveGraph,
  loadCommonConnections,
  personKeyFor,
  resolveGraphDisplayName,
  type CommonConnections,
  type GraphSyncResult,
} from '../lib/networkGraph';

const DEFAULT_PAGE_SIZE = 50;

type SortMode = 'default' | 'warmest' | 'common';

type GraphStatus = 'loading' | 'out' | 'in' | 'error';

function displayName(d: ConnectionDoc): string {
  const name = d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
  return name || '';
}

const ConnectionsScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [rows, setRows] = useState<ConnectionDoc[]>([]);
  const [networkContext, setNetworkContext] = useState<NetworkContext | null>(null);

  const [filter, setFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);

  // Only the newest request may write state: a slow first read must not land on
  // top of a faster Refresh issued after it.
  const requestId = useRef(0);

  // Common-connections graph (opt-in).
  const [graphStatus, setGraphStatus] = useState<GraphStatus>('loading');
  const [graphError, setGraphError] = useState('');
  const [graphBusy, setGraphBusy] = useState(false);
  const [common, setCommon] = useState<CommonConnections | null>(null);
  const [lastSync, setLastSync] = useState<GraphSyncResult | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [keyByRow, setKeyByRow] = useState<Map<ConnectionDoc, string | null>>(() => new Map());
  const graphRequestId = useRef(0);
  const graphLoadStarted = useRef(false);

  async function loadGraph(uid: string) {
    const myRequest = ++graphRequestId.current;
    const stillMine = () => myRequest === graphRequestId.current && auth.currentUser?.uid === uid;

    setGraphStatus('loading');
    setGraphError('');
    try {
      const member = await isGraphMember(uid);
      if (!stillMine()) return;
      if (!member) {
        setCommon(null);
        setGraphStatus('out');
        return;
      }
      const result = await loadCommonConnections(uid);
      if (!stillMine()) return;
      setCommon(result);
      setGraphStatus('in');
    } catch (e: any) {
      if (!stillMine()) return;
      setCommon(null);
      setGraphError(e?.message ?? 'Failed to load common connections.');
      setGraphStatus('error');
    }
  }

  // Once per mount. Ref guard only, no cleanup flag (StrictMode double-mount:
  // the first mount is the only one that fetches).
  useEffect(() => {
    if (!user || graphLoadStarted.current) return;
    graphLoadStarted.current = true;
    void loadGraph(user.uid);
  }, [user]);

  // Graph keys of the user's own connections, only while opted in.
  useEffect(() => {
    if (graphStatus !== 'in') return;
    let cancelled = false;
    void Promise.all(rows.map((r) => personKeyFor(docToRow(r)))).then((keys) => {
      if (cancelled) return;
      setKeyByRow(new Map(rows.map((r, i) => [r, keys[i]])));
    });
    return () => {
      cancelled = true;
    };
  }, [rows, graphStatus]);

  async function handleJoin() {
    if (!user || graphBusy) return;
    const uid = user.uid;
    setGraphBusy(true);
    setGraphError('');
    try {
      const name = await resolveGraphDisplayName(uid);
      const result = await joinGraph(uid, name, rows.map(docToRow));
      if (auth.currentUser?.uid !== uid) return;
      setLastSync(result);
      await loadGraph(uid);
    } catch (e: any) {
      if (auth.currentUser?.uid !== uid) return;
      // The opt-in doc and some batches may already be written: show the real state
      // (with "Stop sharing" when the user is now a member) before the error.
      await loadGraph(uid);
      if (auth.currentUser?.uid !== uid) return;
      setGraphError(e?.message ?? 'Could not start sharing.');
    } finally {
      setGraphBusy(false);
    }
  }

  async function handleLeave() {
    if (!user || graphBusy) return;
    const uid = user.uid;
    setGraphBusy(true);
    setGraphError('');
    try {
      await leaveGraph(uid);
      if (auth.currentUser?.uid !== uid) return;
      ++graphRequestId.current; // drop any in-flight graph load
      setCommon(null);
      setLastSync(null);
      setExpandedMember(null);
      setGraphStatus('out');
      if (sortMode === 'common') setSortMode('default');
    } catch (e: any) {
      if (auth.currentUser?.uid !== uid) return;
      setGraphError(e?.message ?? 'Could not stop sharing. Please try again.');
    } finally {
      setGraphBusy(false);
    }
  }

  function inCommonCount(r: ConnectionDoc): number {
    if (graphStatus !== 'in' || !common) return 0;
    const key = keyByRow.get(r);
    return key ? common.othersByPerson.get(key)?.length ?? 0 : 0;
  }

  // personKey -> names from the user's OWN connection docs.
  const namesByKey = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of rows) {
      const key = keyByRow.get(r);
      if (!key) continue;
      const name = displayName(r) || '(no name)';
      const list = m.get(key);
      if (list) list.push(name);
      else m.set(key, [name]);
    }
    return m;
  }, [rows, keyByRow]);

  const noUrlCount = useMemo(() => {
    let n = 0;
    for (const r of rows) if (keyByRow.has(r) && keyByRow.get(r) === null) n++;
    return n;
  }, [rows, keyByRow]);

  async function loadAll() {
    const myRequest = ++requestId.current;

    setLoading(true);
    setError('');

    try {
      if (!user) throw new Error('Not signed in.');
      const uid = user.uid;

      // The owner context is optional: a failed read degrades to "no context"
      // (no warmth bonus) instead of hiding the connections.
      const [docs, ctx] = await Promise.all([
        loadConnections(uid),
        loadNetworkContext(uid).catch(() => null),
      ]);

      if (myRequest !== requestId.current) return;

      setRows(docs);
      setNetworkContext(ctx);
    } catch (e: any) {
      if (myRequest !== requestId.current) return;
      setError(e?.message ?? 'Failed to load connections.');
      setRows([]);
      setNetworkContext(null);
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [user]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((r) => {
      const s = `${r.fullName ?? ''} ${r.company ?? ''} ${r.position ?? ''} ${r.email ?? ''}`.toLowerCase();
      return s.includes(q);
    });
  }, [rows, filter]);

  const sorted = useMemo(() => {
    if (sortMode === 'common') {
      const withCount = filtered.map((row) => ({ row, n: inCommonCount(row) }));
      withCount.sort((a, b) => b.n - a.n || displayName(a.row).localeCompare(displayName(b.row)));
      return withCount.map((w) => w.row);
    }
    if (sortMode !== 'warmest') return filtered;

    const now = new Date();
    const withBonus = filtered.map((row) => ({
      row,
      bonus: relationshipSignals(docToRow(row), networkContext, now).bonus,
    }));

    withBonus.sort((a, b) => {
      if (b.bonus !== a.bonus) return b.bonus - a.bonus;
      return displayName(a.row).localeCompare(displayName(b.row));
    });

    return withBonus.map((w) => w.row);
  }, [filtered, sortMode, networkContext, common, keyByRow, graphStatus]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  const page = useMemo(() => {
    const start = safePageIndex * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, safePageIndex, pageSize]);

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-7xl mx-auto w-full space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white">Connections</h1>
              <p className="text-slate-400 mt-1 text-sm">
                Saved connections for your account. Use them in the recommender anytime.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => navigate('/recommender')}
                className="bg-primary hover:bg-primary/90 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <Icon name="upload_file" className="text-sm" />
                <span>Import LinkedIn data</span>
              </button>

              <button
                onClick={() => navigate('/recommender', { state: { loadFromAccount: true } })}
                className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={rows.length === 0}
              >
                <Icon name="bolt" className="text-sm" />
                <span>Use in Recommender</span>
              </button>

              <button
                onClick={() => {
                  void loadAll();
                  if (user) void loadGraph(user.uid);
                }}
                disabled={loading}
                className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="refresh" className="text-sm" />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <div className="glass-panel rounded-xl p-4 md:p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
                  <Icon name="hub" className="text-primary" />
                  Common connections
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  See which of your connections other members also know, and who you share the most people with.
                </p>
              </div>
              {graphStatus === 'in' && (
                <button
                  onClick={() => void handleLeave()}
                  disabled={graphBusy}
                  className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  <Icon name="link_off" className="text-sm" />
                  <span>{graphBusy ? 'Removing…' : 'Stop sharing'}</span>
                </button>
              )}
            </div>

            {graphError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200">{graphError}</div>
            )}

            {graphStatus === 'loading' && <p className="text-sm text-slate-400">Checking sharing status…</p>}

            {graphStatus === 'error' && (
              <p className="text-sm text-slate-400">Common connections are unavailable right now. Try Refresh.</p>
            )}

            {graphStatus === 'out' && (
              <div className="space-y-3">
                <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
                  <li>
                    What is shared: a one-way hash of each connection's LinkedIn profile URL, plus your display name.
                  </li>
                  <li>Never shared: names, titles, companies, emails, messages or notes.</li>
                  <li>Other members who also have that person can see that you do.</li>
                  <li>Connections without a LinkedIn profile URL are not shared.</li>
                  <li>
                    Up to {MAX_GRAPH_KEYS.toLocaleString()} connections are shared. You can stop sharing any time and your
                    entries are removed.
                  </li>
                </ul>
                <button
                  onClick={() => void handleJoin()}
                  disabled={graphBusy || loading}
                  className="bg-primary hover:bg-primary/90 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Icon name="share" className="text-sm" />
                  <span>{graphBusy ? 'Sharing…' : 'Share my connections'}</span>
                </button>
              </div>
            )}

            {graphStatus === 'in' && common && (
              <div className="space-y-4">
                <p className="text-sm text-slate-300">
                  {lastSync
                    ? `Synced: ${lastSync.added.toLocaleString()} added, ${lastSync.removed.toLocaleString()} removed, ${lastSync.kept.toLocaleString()} unchanged.`
                    : `Sharing ${common.myNodeCount.toLocaleString()} connections.`}
                  {(() => {
                    const skipped = lastSync ? lastSync.skippedNoUrl : noUrlCount;
                    return skipped > 0 ? ` ${skipped.toLocaleString()} without a profile URL not shared.` : '';
                  })()}
                  {lastSync && lastSync.capped > 0
                    ? ` ${lastSync.capped.toLocaleString()} over the ${MAX_GRAPH_KEYS.toLocaleString()}-connection limit not shared.`
                    : ''}
                  {' '}Saving new connections updates what you share.
                </p>

                <div>
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-2">
                    Members you share connections with
                  </h3>
                  {common.members.length === 0 ? (
                    <p className="text-sm text-slate-500">No other members share connections with you yet.</p>
                  ) : (
                    <ul className="divide-y divide-white/5 border border-white/10 rounded-lg max-h-[320px] overflow-auto custom-scrollbar">
                      {common.members.map((m) => {
                        const open = expandedMember === m.uid;
                        const names = open
                          ? m.personKeys.flatMap((k) => namesByKey.get(k) ?? []).sort((a, b) => a.localeCompare(b))
                          : [];
                        return (
                          <li key={m.uid}>
                            <button
                              onClick={() => setExpandedMember(open ? null : m.uid)}
                              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/5"
                            >
                              <span className="flex items-center gap-2 text-sm font-bold text-slate-100">
                                <Icon name={open ? 'expand_less' : 'expand_more'} className="text-sm text-slate-400" />
                                {m.displayName}
                              </span>
                              <span className="text-xs font-bold text-primary whitespace-nowrap">
                                {m.personKeys.length.toLocaleString()} in common
                              </span>
                            </button>
                            {open && (
                              <div className="px-9 pb-3 text-sm text-slate-300">
                                {names.length > 0
                                  ? names.join(', ')
                                  : keyByRow.size === 0
                                    ? 'Loading names…'
                                    : 'None of these are in your current saved connections.'}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="glass-panel rounded-xl p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 bg-slate-800/50 px-3 md:px-4 py-2 rounded-lg border border-slate-700 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all duration-300 shadow-inner">
                  <Icon name="search" className="text-slate-400 text-sm mr-1" />
                  <input
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPageIndex(0);
                    }}
                    placeholder="Filter by name, company, role, email..."
                    className="bg-transparent border-none focus:ring-0 text-sm w-full text-slate-200 placeholder:text-slate-500 outline-none"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {loading
                    ? 'Loading...'
                    : `Showing ${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} saved connections`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <span className="text-xs text-slate-400 font-bold">Sort</span>
                  <select
                    value={sortMode}
                    onChange={(e) => {
                      setSortMode(e.target.value as SortMode);
                      setPageIndex(0);
                    }}
                    className="bg-transparent text-sm text-slate-200 outline-none"
                    disabled={loading}
                  >
                    <option value="default">Default order</option>
                    <option value="warmest">Warmest first</option>
                    <option value="common" disabled={graphStatus !== 'in'}>
                      Most in common
                    </option>
                  </select>
                </div>

                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <span className="text-xs text-slate-400 font-bold">Rows/page</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPageIndex(0);
                    }}
                    className="bg-transparent text-sm text-slate-200 outline-none"
                    disabled={loading}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                <button
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                  disabled={loading || safePageIndex === 0}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border transition ${
                    loading || safePageIndex === 0
                      ? 'border-white/10 text-slate-600 bg-white/5 cursor-not-allowed'
                      : 'border-white/10 text-slate-200 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  Prev
                </button>
                <button
                  onClick={() => setPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={loading || safePageIndex >= totalPages - 1}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border transition ${
                    loading || safePageIndex >= totalPages - 1
                      ? 'border-white/10 text-slate-600 bg-white/5 cursor-not-allowed'
                      : 'border-white/10 text-slate-200 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  Next
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <div className="mt-4 overflow-auto custom-scrollbar max-h-[620px] rounded-xl border border-white/10">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-background-dark/95 backdrop-blur border-b border-white/10">
                  <tr className="text-left">
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Name</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Position</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Company</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Connected On</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Messages</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Last contact</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider whitespace-nowrap">In common</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Email</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-4 text-slate-400" colSpan={9}>
                        Loading connections…
                      </td>
                    </tr>
                  ) : page.length === 0 ? (
                    <tr>
                      <td className="p-4 text-slate-400" colSpan={9}>
                        No connections found.
                      </td>
                    </tr>
                  ) : (
                    page.map((r, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                        <td className="p-3 font-bold text-slate-100 whitespace-nowrap">{r.fullName || '—'}</td>
                        <td className="p-3 text-slate-300">{r.position || <span className="text-slate-600">—</span>}</td>
                        <td className="p-3 text-slate-300">{r.company || <span className="text-slate-600">—</span>}</td>
                        <td className="p-3 text-slate-400 whitespace-nowrap">{r.connectedOnRaw || <span className="text-slate-600">—</span>}</td>
                        <td className="p-3 text-slate-400 whitespace-nowrap">
                          {r.messageCount != null ? r.messageCount.toLocaleString() : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="p-3 text-slate-400 whitespace-nowrap">
                          {r.lastMessagedAt || <span className="text-slate-600">—</span>}
                        </td>
                        <td className="p-3 text-slate-300 whitespace-nowrap">
                          {(() => {
                            const n = inCommonCount(r);
                            return n > 0 ? n.toLocaleString() : <span className="text-slate-600">—</span>;
                          })()}
                        </td>
                        <td className="p-3 text-slate-400">{r.email || <span className="text-slate-600">—</span>}</td>
                        <td className="p-3">
                          {r.url ? (
                            <a
                              className="text-primary hover:underline inline-flex items-center gap-1"
                              href={r.url}
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
                    ))
                  )}
                </tbody>
              </table>
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

export default ConnectionsScreen;
