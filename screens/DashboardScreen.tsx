import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/AuthContext';
import { loadConnections, type ConnectionDoc } from '../lib/connectionsStore';
import {
  BarChart,
  Bar,
  XAxis,
  ResponsiveContainer,
  Cell
} from 'recharts';

const TOP_COMPANIES = 8;
const RECENT_COUNT = 5;

function displayName(d: ConnectionDoc): string {
  const name = d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
  return name || '(no name)';
}

const DashboardScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const [docs, setDocs] = useState<ConnectionDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>('');

  // StrictMode mounts effects twice in dev. The ref alone guards the fetch --
  // pairing it with a cleanup `cancelled` flag would let the first (and only)
  // mount's cleanup discard the result. See CLAUDE.md.
  const loadStarted = useRef(false);

  useEffect(() => {
    if (loadStarted.current) return;
    if (!user) return;
    loadStarted.current = true;

    const uid = user.uid;
    setLoading(true);

    void (async () => {
      try {
        const rows = await loadConnections(uid);
        setDocs(rows);
      } catch (e: any) {
        setLoadError(e?.message ?? 'Could not load your connections.');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const summary = useMemo(() => {
    const total = docs.length;

    const missingTitles = docs.filter((d) => !(d.position ?? '').trim()).length;
    const pctMissingTitle = total ? Math.round((missingTitles / total) * 100) : 0;

    const counts = new Map<string, number>();
    for (const d of docs) {
      const company = (d.company ?? '').trim();
      if (!company) continue;
      counts.set(company, (counts.get(company) ?? 0) + 1);
    }

    const topCompanies = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_COMPANIES)
      .map(([name, count]) => ({ name, count }));

    // Latest `Connected On` first; anything Date.parse cannot read sorts last.
    const recent = docs
      .map((d) => {
        const raw = (d.connectedOnRaw ?? '').trim();
        const ts = raw ? Date.parse(raw) : NaN;
        return { doc: d, ts };
      })
      .sort((a, b) => {
        const aBad = Number.isNaN(a.ts);
        const bBad = Number.isNaN(b.ts);
        if (aBad && bBad) return 0;
        if (aBad) return 1;
        if (bBad) return -1;
        return b.ts - a.ts;
      })
      .slice(0, RECENT_COUNT)
      .map((e) => e.doc);

    return {
      total,
      pctMissingTitle,
      companyCount: counts.size,
      topCompanies,
      recent,
    };
  }, [docs]);

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-7xl mx-auto w-full">

          {(loading || loadError) && (
            <p className="text-sm text-slate-400 mb-4">
              {loading ? 'Loading your network…' : loadError}
            </p>
          )}

          {/* Summary Stats Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-6">
            <StatCard
              title="Connections saved"
              value={summary.total.toLocaleString()}
              subtext="In your account"
              icon="contacts"
              delay="0ms"
            />
            <StatCard
              title="Missing a title"
              value={`${summary.pctMissingTitle}%`}
              subtext="Rows with no Position"
              icon="help_outline"
              delay="100ms"
            />
            <StatCard
              title="Companies"
              value={summary.companyCount.toLocaleString()}
              subtext="Distinct employers"
              icon="business_center"
              delay="200ms"
            />
          </div>

          {/* Connections actions */}
          <div
            className="glass-panel rounded-xl p-4 md:p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-fade-in-up"
            style={{ animationDelay: '350ms', animationFillMode: 'both' }}
          >
            <div>
              <h4 className="text-lg font-bold text-white">Connections</h4>
              <p className="text-sm text-slate-400">
                Import your LinkedIn connections CSV, save them to your account, and use them in the recommender.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => navigate('/recommender')}
                className="bg-primary hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <Icon name="upload_file" className="text-sm" />
                <span>Import CSV</span>
              </button>

              <button
                onClick={() => navigate('/connections')}
                className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-white/10"
              >
                <Icon name="contacts" className="text-sm" />
                <span>View Saved</span>
              </button>
            </div>
          </div>

          {/* Main Bento Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 auto-rows-min">

            {/* Top companies */}
            <div
              className="lg:col-span-8 glass-panel rounded-xl bento-card p-4 md:p-6 flex flex-col h-[380px] md:h-[424px] animate-fade-in-up"
              style={{ animationDelay: '400ms', animationFillMode: 'both' }}
            >
              <div className="flex flex-col sm:flex-row justify-between items-start mb-6 gap-4">
                <div>
                  <h4 className="text-lg font-bold text-white">Top companies</h4>
                  <p className="text-sm text-slate-400">
                    Where most of your saved connections work
                  </p>
                </div>
              </div>

              <div className="flex-1 min-h-0 w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.topCompanies} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 10, fontWeight: 'bold' }}
                      dy={10}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {summary.topCompanies.map((entry, index) => (
                        <Cell
                          key={`cell-${entry.name}`}
                          fill="#135bec"
                          fillOpacity={Math.max(0.3, 1 - (index * 0.08))}
                          className="hover:fill-primary hover:opacity-100 transition-all duration-300 cursor-pointer"
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Most recent connections */}
            <div
              className="lg:col-span-4 glass-panel rounded-xl bento-card p-4 md:p-6 flex flex-col h-[380px] md:h-[424px] animate-fade-in-up"
              style={{ animationDelay: '500ms', animationFillMode: 'both' }}
            >
              <h4 className="text-lg font-bold text-white mb-6">Most recent connections</h4>

              {summary.recent.length === 0 ? (
                <div className="flex-1 flex flex-col items-start justify-center gap-4">
                  <p className="text-sm text-slate-400">
                    No connections yet. Import a LinkedIn export to get started.
                  </p>
                  <button
                    onClick={() => navigate('/recommender')}
                    className="bg-primary hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    <Icon name="upload_file" className="text-sm" />
                    <span>Import CSV</span>
                  </button>
                </div>
              ) : (
                <div className="flex-1 overflow-auto custom-scrollbar pr-2 space-y-3">
                  {summary.recent.map((d, i) => (
                    <div
                      key={`${d.url ?? ''}-${i}`}
                      className="p-3 rounded-lg bg-transparent border border-transparent hover:bg-slate-800/40 hover:border-slate-700/50 transition-all duration-300"
                    >
                      <p className="text-sm font-bold truncate text-slate-100">{displayName(d)}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {(d.position ?? '').trim() || 'No title'}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {(d.company ?? '').trim() || 'No company'}
                      </p>
                    </div>
                  ))}
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

// Sub-components
const StatCard = ({ title, value, trend, trendUp, subtext, icon, primary, delay }: any) => (
  <div
    className="glass-panel p-5 md:p-6 rounded-xl bento-card cursor-pointer group animate-fade-in-up"
    style={{ animationDelay: delay, animationFillMode: 'both' }}
  >
    <p className="text-slate-400 text-sm font-medium mb-1 group-hover:text-slate-300 transition-colors">{title}</p>
    <h3 className="text-2xl font-extrabold text-white group-hover:text-primary transition-colors">{value}</h3>
    <div className={`flex items-center mt-2 text-xs font-bold ${primary ? 'text-primary' : (trendUp ? 'text-emerald-500' : 'text-slate-400')}`}>
      <Icon name={icon} className="text-sm mr-1" />
      <span>{trend || subtext}</span>
    </div>
  </div>
);

export default DashboardScreen;
