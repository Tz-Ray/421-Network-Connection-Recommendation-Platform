import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { getAuth } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import type { ConnectionDoc } from '../lib/connectionsStore';

const DEFAULT_PAGE_SIZE = 50;

const ConnectionsScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [rows, setRows] = useState<ConnectionDoc[]>([]);

  const [filter, setFilter] = useState('');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageIndex, setPageIndex] = useState(0);

  // Only the newest request may write state: a slow first read must not land on
  // top of a faster Refresh issued after it.
  const requestId = useRef(0);

  async function loadConnections() {
    const myRequest = ++requestId.current;

    setLoading(true);
    setError('');

    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error('Not signed in.');

      const col = collection(db, 'users', user.uid, 'connections');
      const snap = await getDocs(col);

      if (myRequest !== requestId.current) return;

      const data = snap.docs.map((d) => d.data() as ConnectionDoc);
      setRows(data);
    } catch (e: any) {
      if (myRequest !== requestId.current) return;
      setError(e?.message ?? 'Failed to load connections.');
      setRows([]);
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadConnections();
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((r) => {
      const s = `${r.fullName ?? ''} ${r.company ?? ''} ${r.position ?? ''} ${r.email ?? ''}`.toLowerCase();
      return s.includes(q);
    });
  }, [rows, filter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);

  const page = useMemo(() => {
    const start = safePageIndex * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePageIndex, pageSize]);

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
                <span>Import CSV</span>
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
                onClick={() => void loadConnections()}
                disabled={loading}
                className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon name="refresh" className="text-sm" />
                <span>Refresh</span>
              </button>
            </div>
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
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Email</th>
                    <th className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="p-4 text-slate-400" colSpan={6}>
                        Loading connections…
                      </td>
                    </tr>
                  ) : page.length === 0 ? (
                    <tr>
                      <td className="p-4 text-slate-400" colSpan={6}>
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