import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/AuthContext';
import { auth } from '../firebase';
import { docToRow, loadConnections, type ConnectionDoc } from '../lib/connectionsStore';
import {
  MAX_GRAPH_KEYS,
  isGraphMember,
  joinGraph,
  leaveGraph,
  loadCommonConnections,
  loadGraphNode,
  personKeyFor,
  resolveGraphDisplayName,
  syncNetworkGraph,
  type CommonConnections,
  type GraphNodeDoc,
  type GraphSyncResult,
} from '../lib/networkGraph';
import {
  buildGraphView,
  layoutGraph,
  memberNodeId,
  personNodeId,
  type GraphLayout,
  type GraphNode,
  type GraphView,
  type MemberNode,
  type PersonNode,
} from '../lib/graphView';

type Status = 'loading' | 'out' | 'in' | 'error';
type Busy = null | 'join' | 'leave' | 'sync';
type Selection = { kind: 'member'; uid: string } | { kind: 'person'; key: string } | null;

const VIEW_W = 1240;
const VIEW_H = 840;
const PEOPLE_TABLE_LIMIT = 200;

const COLORS = {
  you: '#135bec',
  member: '#f59e0b',
  person: '#38bdf8',
  unshared: '#64748b',
  youEdge: 'rgba(96, 140, 255, 0.28)',
  memberEdge: 'rgba(245, 158, 11, 0.30)',
};

function displayName(d: ConnectionDoc): string {
  return d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

const NetworkScreen: React.FC = () => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [docs, setDocs] = useState<ConnectionDoc[]>([]);
  const [keys, setKeys] = useState<(string | null)[]>([]);
  const [common, setCommon] = useState<CommonConnections | null>(null);
  const [lastSync, setLastSync] = useState<GraphSyncResult | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const requestId = useRef(0);
  const loadStarted = useRef(false);

  async function loadAll(uid: string, opts: { connections: boolean } = { connections: true }) {
    const mine = ++requestId.current;
    const stillMine = () => mine === requestId.current && auth.currentUser?.uid === uid;
    setStatus('loading');
    setError('');
    try {
      if (opts.connections) {
        const loaded = await loadConnections(uid);
        const k = await Promise.all(loaded.map((d) => personKeyFor(docToRow(d))));
        if (!stillMine()) return;
        setDocs(loaded);
        setKeys(k);
      }
      const member = await isGraphMember(uid);
      if (!stillMine()) return;
      if (!member) {
        setCommon(null);
        setStatus('out');
        return;
      }
      const result = await loadCommonConnections(uid);
      if (!stillMine()) return;
      setCommon(result);
      setStatus('in');
    } catch (e: any) {
      if (!stillMine()) return;
      setCommon(null);
      setError(e?.message ?? 'Failed to load the network graph.');
      setStatus('error');
    }
  }

  // Once per mount. Ref guard only, no cleanup flag (StrictMode double-mount).
  useEffect(() => {
    if (!user || loadStarted.current) return;
    loadStarted.current = true;
    void loadAll(user.uid);
  }, [user]);

  async function runAction(kind: Exclude<Busy, null>) {
    if (!user || busy) return;
    const uid = user.uid;
    setBusy(kind);
    setActionError('');
    try {
      if (kind === 'join') {
        const name = await resolveGraphDisplayName(uid);
        const result = await joinGraph(uid, name, docs.map(docToRow));
        if (auth.currentUser?.uid !== uid) return;
        setLastSync(result);
      } else if (kind === 'sync') {
        const result = await syncNetworkGraph(uid, docs.map(docToRow));
        if (auth.currentUser?.uid !== uid) return;
        setLastSync(result);
      } else {
        await leaveGraph(uid);
        if (auth.currentUser?.uid !== uid) return;
        setLastSync(null);
        setSelection(null);
      }
      await loadAll(uid, { connections: false });
    } catch (e: any) {
      if (auth.currentUser?.uid !== uid) return;
      // Some writes may have landed: show the real state, then the error.
      await loadAll(uid, { connections: false });
      if (auth.currentUser?.uid !== uid) return;
      setActionError(
        e?.message ??
          (kind === 'join' ? 'Could not start sharing.' : kind === 'leave' ? 'Could not stop sharing.' : 'Could not re-sync.')
      );
    } finally {
      setBusy(null);
    }
  }

  const view = useMemo<GraphView>(
    () =>
      buildGraphView({
        myRows: docs.map((d, i) => ({
          personKey: keys[i] ?? null,
          name: displayName(d),
          position: d.position,
          company: d.company,
        })),
        common: status === 'in' ? common : null,
        youLabel: 'You',
      }),
    [docs, keys, common, status]
  );
  const layout = useMemo(() => layoutGraph(view), [view]);

  const noUrl = view.totals.noUrl;
  const sharingCount = common?.myNodeCount ?? 0;

  return (
    <div className="flex h-screen overflow-hidden bg-background-dark text-slate-100 font-display">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col relative overflow-y-auto overflow-x-hidden custom-scrollbar">
        <Header onMenuToggle={() => setSidebarOpen(!isSidebarOpen)} />

        <div className="p-4 md:p-8 pb-20 max-w-7xl mx-auto w-full space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-extrabold text-white">Network graph</h1>
              <p className="text-slate-400 mt-1 text-sm">
                Who else in Connection Recommender knows the people you know, and who could introduce you.
              </p>
            </div>
            <button
              onClick={() => user && void loadAll(user.uid)}
              disabled={status === 'loading' || busy !== null}
              className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed self-start"
            >
              <Icon name="refresh" className="text-sm" />
              <span>Refresh</span>
            </button>
          </div>

          {/* Sharing card */}
          <section className="glass-panel rounded-xl p-4 md:p-6 space-y-4" aria-labelledby="sharing-title" data-testid="sharing-card">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div>
                <h2 id="sharing-title" className="text-lg font-extrabold text-white flex items-center gap-2">
                  <Icon name="hub" className="text-primary" />
                  Sharing
                  {status === 'in' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                      On
                    </span>
                  )}
                  {status === 'out' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                      Off
                    </span>
                  )}
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Sharing is opt-in. It lets you and other members see how many connections you have in common.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {status === 'out' && (
                  <button
                    onClick={() => void runAction('join')}
                    disabled={busy !== null}
                    className="bg-primary hover:bg-primary/90 text-white font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon name="share" className="text-sm" />
                    <span>{busy === 'join' ? 'Sharing…' : 'Share my connections'}</span>
                  </button>
                )}
                {status === 'in' && (
                  <>
                    <button
                      onClick={() => void runAction('sync')}
                      disabled={busy !== null}
                      className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Icon name="sync" className="text-sm" />
                      <span>{busy === 'sync' ? 'Syncing…' : 'Re-sync now'}</span>
                    </button>
                    <button
                      onClick={() => void runAction('leave')}
                      disabled={busy !== null}
                      className="bg-white/5 hover:bg-red-500/10 hover:text-red-300 text-slate-200 font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-all border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Icon name="link_off" className="text-sm" />
                      <span>{busy === 'leave' ? 'Removing…' : 'Stop sharing'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {actionError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-200" role="alert">
                {actionError}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <h3 className="text-xs font-extrabold text-emerald-300 uppercase tracking-wider mb-2">What is shared</h3>
                <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
                  <li>A one-way hash of each connection's LinkedIn profile link (not the link itself).</li>
                  <li>Your display name, so other members can see who they share people with.</li>
                  <li>Other members who also have that person can see that you do.</li>
                </ul>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <h3 className="text-xs font-extrabold text-slate-300 uppercase tracking-wider mb-2">Never shared</h3>
                <ul className="text-sm text-slate-300 list-disc pl-5 space-y-1">
                  <li>Names, titles, companies, emails, notes or messages of your connections.</li>
                  <li>Your email address.</li>
                  <li>Connections without a LinkedIn profile link (they are skipped).</li>
                </ul>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Known limitation: a member who already knows someone's profile link can check whether other members have that
              person too. Up to {fmt(MAX_GRAPH_KEYS)} connections are shared. Stop sharing removes all your entries.
            </p>

            {status === 'in' && (
              <div className="text-sm text-slate-300 space-y-2" data-testid="sync-status">
                <p>
                  Sharing <strong className="text-white">{fmt(sharingCount)}</strong> of your connections
                  {noUrl > 0 ? ` (${fmt(noUrl)} without a profile link are not shared)` : ''}. Saving new connections updates
                  what you share automatically.
                </p>
                {lastSync ? (
                  <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2" aria-label="Last sync">
                    {(
                      [
                        ['Added', lastSync.added],
                        ['Removed', lastSync.removed],
                        ['Kept', lastSync.kept],
                        ['Skipped (no URL)', lastSync.skippedNoUrl],
                        [`Over ${fmt(MAX_GRAPH_KEYS)} cap`, lastSync.capped],
                      ] as const
                    ).map(([label, n]) => (
                      <div key={label} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                        <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
                        <dd className="text-lg font-extrabold text-white">{fmt(n)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-xs text-slate-500">No sync in this visit yet. Re-sync now shows added / removed / kept numbers.</p>
                )}
              </div>
            )}
            {status === 'out' && docs.length === 0 && (
              <p className="text-sm text-amber-200">
                You have no saved connections yet. <Link to="/recommender" className="text-primary hover:underline">Import your LinkedIn data</Link>{' '}
                first, then share.
              </p>
            )}
          </section>

          {/* Graph */}
          <section className="glass-panel rounded-xl p-4 md:p-6 space-y-4" aria-labelledby="graph-title">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <h2 id="graph-title" className="text-lg font-extrabold text-white flex items-center gap-2">
                <Icon name="share" className="text-primary" />
                Your common connections
              </h2>
              {status === 'in' && <Counts view={view} />}
            </div>

            {status === 'loading' && (
              <div className="h-64 flex items-center justify-center text-slate-400 animate-pulse" data-testid="graph-loading">
                Loading your network…
              </div>
            )}
            {status === 'error' && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-sm text-red-200 space-y-2" role="alert">
                <p>The network graph could not be loaded: {error}</p>
                <button
                  onClick={() => user && void loadAll(user.uid)}
                  className="bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-1.5 px-3 rounded-lg border border-white/10"
                >
                  Try again
                </button>
              </div>
            )}
            {status === 'out' && (
              <div className="h-48 flex flex-col items-center justify-center text-center text-slate-400 gap-2" data-testid="graph-out">
                <Icon name="hub" className="text-4xl text-slate-600" />
                <p>Share your connections to see who else knows the people you know.</p>
              </div>
            )}
            {status === 'in' && (
              <>
                {view.members.length === 0 && (
                  <p className="text-sm text-slate-300 bg-white/5 border border-white/10 rounded-lg p-3" data-testid="graph-empty">
                    No other members share connections with you yet. When someone who knows the same people starts sharing,
                    they appear here.
                  </p>
                )}
                <div className="flex flex-col lg:flex-row gap-4">
                  <GraphCanvas view={view} layout={layout} selection={selection} onSelect={setSelection} />
                  <SidePanel view={view} selection={selection} onSelect={setSelection} />
                </div>
                <Legend view={view} />
                <StoredDocs view={view} myUid={user?.uid ?? ''} />
                <GraphTables view={view} onSelect={setSelection} />
              </>
            )}
          </section>
        </div>
      </main>

      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] md:w-[40%] md:h-[40%] bg-primary/20 blur-[150px] rounded-full -z-10 pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[50%] h-[50%] md:w-[30%] md:h-[30%] bg-blue-900/10 blur-[120px] rounded-full -z-10 pointer-events-none"></div>
    </div>
  );
};

// -----------------------------
// Counts + legend
// -----------------------------

const Counts: React.FC<{ view: GraphView }> = ({ view }) => {
  const t = view.totals;
  const items: [string, number][] = [
    ['members', t.members],
    ['people in common', t.sharedPeople],
    ['not shared with anyone', t.unshared],
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs" data-testid="graph-counts">
      {items.map(([label, n]) => (
        <span key={label} className="bg-white/5 border border-white/10 rounded-full px-3 py-1 text-slate-300">
          <strong className="text-white" data-count={label}>
            {fmt(n)}
          </strong>{' '}
          {label}
        </span>
      ))}
    </div>
  );
};

const Legend: React.FC<{ view: GraphView }> = ({ view }) => (
  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
    <span className="flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full" style={{ background: COLORS.you }} /> You
    </span>
    <span className="flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full" style={{ background: COLORS.member }} /> Other member (size = people in common)
    </span>
    <span className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS.person }} /> Person you both know (bigger = more members)
    </span>
    <span className="flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full border border-dashed" style={{ borderColor: COLORS.unshared }} /> Your
      connections nobody else has
    </span>
    {view.totals.hiddenPeople > 0 && (
      <span className="text-amber-200" data-testid="hidden-note">
        Showing the {fmt(view.totals.shownPeople)} people most members share; +{fmt(view.totals.hiddenPeople)} more in the
        table below.
      </span>
    )}
    <span>Scroll to zoom, drag to pan, click a node for details.</span>
  </div>
);

// -----------------------------
// SVG graph (pan / zoom / highlight)
// -----------------------------

type Transform = { k: number; x: number; y: number };

const GraphCanvas: React.FC<{
  view: GraphView;
  layout: GraphLayout;
  selection: Selection;
  onSelect: (s: Selection) => void;
}> = ({ view, layout, selection, onSelect }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tf, setTf] = useState<Transform>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = toSvg(svg, e.clientX, e.clientY);
      setTf((t) => {
        const k = Math.min(6, Math.max(0.4, t.k * Math.exp(-e.deltaY * 0.0015)));
        // Keep the point under the cursor fixed.
        return { k, x: pt.x - ((pt.x - t.x) * k) / t.k, y: pt.y - ((pt.y - t.y) * k) / t.k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const selectedId =
    selection?.kind === 'member' ? memberNodeId(selection.uid) : selection?.kind === 'person' ? personNodeId(selection.key) : null;
  const active = hover ?? selectedId;

  const neighbors = useMemo(() => {
    if (!active) return null;
    const s = new Set<string>([active]);
    for (const e of view.edges) {
      if (e.source === active) s.add(e.target);
      if (e.target === active) s.add(e.source);
    }
    return s;
  }, [active, view.edges]);

  const pos = (id: string) => layout.positions.get(id) ?? { x: 0, y: 0 };
  const rad = (id: string) => layout.radius.get(id) ?? 4;

  function nodeHandlers(n: GraphNode) {
    const sel: Selection =
      n.kind === 'member' ? { kind: 'member', uid: n.uid } : n.kind === 'person' ? { kind: 'person', key: n.personKey } : null;
    return {
      onMouseEnter: () => setHover(n.id),
      onMouseLeave: () => setHover((h) => (h === n.id ? null : h)),
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(sel && selectedId === n.id ? null : sel);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(sel);
        }
      },
    };
  }

  const members = view.nodes.filter((n): n is MemberNode => n.kind === 'member');
  const people = view.nodes.filter((n): n is PersonNode => n.kind === 'person');
  const unshared = view.nodes.find((n) => n.kind === 'unshared');
  // Members stay readable when another node is highlighted; people fade more.
  const dim = (id: string) => (neighbors && !neighbors.has(id) ? (id.startsWith('m:') ? 0.45 : 0.12) : 1);

  return (
    <div className="relative flex-1 min-w-0 rounded-xl border border-white/10 bg-black/20 overflow-hidden">
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        {(
          [
            ['add', 'Zoom in', () => setTf((t) => ({ k: Math.min(6, t.k * 1.25), x: t.x * 1.25, y: t.y * 1.25 }))],
            ['remove', 'Zoom out', () => setTf((t) => ({ k: Math.max(0.4, t.k / 1.25), x: t.x / 1.25, y: t.y / 1.25 }))],
            ['center_focus_strong', 'Reset view', () => setTf({ k: 1, x: 0, y: 0 })],
          ] as const
        ).map(([icon, label, fn]) => (
          <button
            key={icon}
            onClick={fn}
            aria-label={label}
            title={label}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900/80 border border-white/10 text-slate-300 hover:text-white hover:bg-slate-800"
          >
            <Icon name={icon} className="text-base" />
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        data-testid="graph-svg"
        role="img"
        aria-label={`Graph: you, ${view.totals.members} other members and ${view.totals.shownPeople} people you share. The same data is in the tables below.`}
        viewBox={`${-VIEW_W / 2} ${-VIEW_H / 2} ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto block select-none touch-none cursor-grab active:cursor-grabbing"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = toSvg(e.currentTarget, e.clientX, e.clientY);
          drag.current = { x: p.x, y: p.y, tx: tf.x, ty: tf.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const p = toSvg(e.currentTarget, e.clientX, e.clientY);
          const dx = p.x - d.x;
          const dy = p.y - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 3) return;
          if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
          d.moved = true;
          setTf((t) => ({ ...t, x: d.tx + dx, y: d.ty + dy }));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          justDragged.current = !!d?.moved;
          if (d?.moved) e.currentTarget.releasePointerCapture?.(e.pointerId);
        }}
        onClick={(e) => {
          if (justDragged.current) {
            justDragged.current = false;
            return;
          }
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`}>
          <ellipse
            cx={0}
            cy={0}
            rx={layout.ring.rx}
            ry={layout.ring.ry}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeDasharray="4 6"
            pointerEvents="none"
          />
          <g pointerEvents="none">
            {view.edges.map((e) => {
              const a = pos(e.source);
              const b = pos(e.target);
              const on = active && (e.source === active || e.target === active);
              const stroke =
                e.kind === 'member-person' ? COLORS.memberEdge : e.kind === 'you-unshared' ? 'rgba(148,163,184,0.35)' : COLORS.youEdge;
              return (
                <line
                  key={`${e.source}>${e.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={on ? (e.kind === 'member-person' ? '#fbbf24' : '#93b4ff') : stroke}
                  strokeWidth={(on ? 1.8 : 0.8) / tf.k}
                  strokeDasharray={e.kind === 'you-unshared' ? '4 4' : undefined}
                  opacity={active && !on ? 0.06 : 1}
                />
              );
            })}
          </g>

          {people.map((p) => {
            const { x, y } = pos(p.id);
            const isActive = active === p.id;
            return (
              <g key={p.id} opacity={dim(p.id)} {...nodeHandlers(p)} className="cursor-pointer" data-node-kind="person">
                <circle
                  cx={x}
                  cy={y}
                  r={rad(p.id) + (isActive ? 2 : 0)}
                  fill={COLORS.person}
                  stroke={selectedId === p.id ? '#fff' : 'rgba(16,22,34,0.9)'}
                  strokeWidth={1 / tf.k}
                >
                  <title>{`${p.label}: also known by ${p.memberUids.length} member${p.memberUids.length === 1 ? '' : 's'}`}</title>
                </circle>
              </g>
            );
          })}

          {unshared && unshared.kind === 'unshared' && (() => {
            const { x, y } = pos(unshared.id);
            return (
              <g opacity={dim(unshared.id)} onMouseEnter={() => setHover(unshared.id)} onMouseLeave={() => setHover(null)}>
                <circle cx={x} cy={y} r={rad(unshared.id)} fill="rgba(100,116,139,0.15)" stroke={COLORS.unshared} strokeDasharray="3 3" strokeWidth={1.2} />
                <text x={x} y={y + 5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#cbd5e1">
                  {fmt(unshared.count)}
                </text>
                <Label x={x} y={y + rad(unshared.id) + 17} anchor="middle" text="not shared with anyone" size={14} color="#94a3b8" k={tf.k} />
              </g>
            );
          })()}

          {/* You */}
          {(() => {
            const { x, y } = pos('you');
            return (
              <g opacity={dim('you')} onMouseEnter={() => setHover('you')} onMouseLeave={() => setHover(null)}>
                <circle cx={x} cy={y} r={rad('you')} fill={COLORS.you} stroke="#fff" strokeWidth={2} />
                <text x={x} y={y + 6} textAnchor="middle" fontSize={16} fontWeight={800} fill="#fff">
                  You
                </text>
              </g>
            );
          })()}

          {members.map((m) => {
            const { x, y } = pos(m.id);
            const r = rad(m.id);
            const len = Math.hypot(x, y) || 1;
            const ux = x / len;
            const uy = y / len;
            const anchor = ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle';
            const lx = x + ux * (r + 8);
            const ly = y + uy * (r + 8) + (Math.abs(uy) > 0.6 ? (uy > 0 ? 14 : -6) : 5);
            const isSel = selectedId === m.id;
            return (
              <g
                key={m.id}
                opacity={dim(m.id)}
                {...nodeHandlers(m)}
                className="cursor-pointer outline-none"
                tabIndex={0}
                role="button"
                aria-label={`${m.label}: ${m.sharedCount} people in common`}
                aria-pressed={isSel}
                data-node-kind="member"
                data-member-name={m.label}
                data-member-uid={m.uid}
                data-shared={m.sharedCount}
              >
                <circle cx={x} cy={y} r={r} fill={COLORS.member} stroke={isSel ? '#fff' : 'rgba(16,22,34,0.9)'} strokeWidth={isSel ? 3 : 1.5} />
                <text x={x} y={y + 4.5} textAnchor="middle" fontSize={r > 15 ? 12 : 10} fontWeight={800} fill="#1f1300" pointerEvents="none">
                  {m.sharedCount > 999 ? `${Math.round(m.sharedCount / 100) / 10}k` : m.sharedCount}
                </text>
                <Label x={lx} y={ly} anchor={anchor} text={m.label} size={16} color="#fde68a" k={tf.k} bold />
              </g>
            );
          })}

          {/* Hover label for a person, drawn last so it sits on top. */}
          {active?.startsWith('p:') &&
            (() => {
              const p = people.find((n) => n.id === active);
              if (!p) return null;
              const { x, y } = pos(p.id);
              return (
                <Label
                  x={x}
                  y={y - rad(p.id) - 6}
                  anchor="middle"
                  text={`${p.label} · ${p.memberUids.length} member${p.memberUids.length === 1 ? '' : 's'}`}
                  size={16}
                  color="#e0f2fe"
                  k={tf.k}
                  bold
                />
              );
            })()}
        </g>
      </svg>
    </div>
  );
};

/** Text with a dark halo so it stays readable over edges; constant on-screen size. */
const Label: React.FC<{ x: number; y: number; anchor: 'start' | 'middle' | 'end'; text: string; size: number; color: string; k: number; bold?: boolean }> = ({
  x,
  y,
  anchor,
  text,
  size,
  color,
  k,
  bold,
}) => {
  const s = size / Math.max(0.6, Math.min(k, 2.5)) ** 0.5;
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={s}
      fontWeight={bold ? 700 : 500}
      fill={color}
      stroke="#101622"
      strokeWidth={3 / Math.max(1, k)}
      paintOrder="stroke"
      pointerEvents="none"
    >
      {text}
    </text>
  );
};

function toSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

// -----------------------------
// Side panel
// -----------------------------

const SidePanel: React.FC<{ view: GraphView; selection: Selection; onSelect: (s: Selection) => void }> = ({
  view,
  selection,
  onSelect,
}) => {
  const memberName = (uid: string) => view.members.find((m) => m.uid === uid)?.displayName ?? 'A member';
  let body: React.ReactNode;

  if (selection?.kind === 'member') {
    const m = view.members.find((x) => x.uid === selection.uid);
    if (!m) {
      body = <p className="text-sm text-slate-400">That member is no longer sharing.</p>;
    } else {
      body = (
        <div className="space-y-3" data-member-uid={m.uid}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">Member</p>
            <h3 className="text-lg font-extrabold text-white">{m.displayName}</h3>
            <p className="text-sm text-slate-300" data-testid="panel-shared">
              You both know <strong className="text-white">{fmt(m.sharedCount)}</strong> {m.sharedCount === 1 ? 'person' : 'people'}.
              {m.knownCount < m.sharedCount && ` ${fmt(m.sharedCount - m.knownCount)} of them are not in your saved connections any more.`}
            </p>
          </div>
          <p className="text-sm text-slate-300 bg-primary/10 border border-primary/20 rounded-lg p-3">
            <Icon name="tips_and_updates" className="text-sm text-primary mr-1 align-middle" />
            Ask {m.displayName} for an introduction or a warm word before you reach out to someone you both know. They can
            also introduce you to people in their own network.
          </p>
          {m.overlaps.length > 0 && (
            <p className="text-xs text-slate-400">
              Also knows some of these people:{' '}
              {m.overlaps.slice(0, 4).map((o, i) => (
                <React.Fragment key={o.uid}>
                  {i > 0 && ', '}
                  <button className="text-amber-200 hover:underline" onClick={() => onSelect({ kind: 'member', uid: o.uid })}>
                    {o.displayName}
                  </button>{' '}
                  ({fmt(o.count)})
                </React.Fragment>
              ))}
              {m.overlaps.length > 4 && ` and ${m.overlaps.length - 4} more`}
            </p>
          )}
          <div>
            <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-1">
              People you share ({fmt(m.people.length)}, names from your own connections)
            </h4>
            <ul className="max-h-[300px] overflow-auto custom-scrollbar divide-y divide-white/5 border border-white/10 rounded-lg" data-testid="panel-people">
              {m.people.map((p) => (
                <li key={p.personKey}>
                  <button
                    onClick={() => onSelect({ kind: 'person', key: p.personKey })}
                    className="w-full text-left px-3 py-1.5 hover:bg-white/5"
                  >
                    <span className="text-sm font-bold text-slate-100">{p.label}</span>
                    {(p.position || p.company) && (
                      <span className="block text-xs text-slate-400 truncate">
                        {[p.position, p.company].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }
  } else if (selection?.kind === 'person') {
    const p = view.people.find((x) => x.personKey === selection.key);
    if (!p) {
      body = <p className="text-sm text-slate-400">No longer shared.</p>;
    } else {
      body = (
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-sky-300">Your connection</p>
            <h3 className="text-lg font-extrabold text-white">{p.names.join(' / ')}</h3>
            {(p.position || p.company) && (
              <p className="text-sm text-slate-400">{[p.position, p.company].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <p className="text-sm text-slate-300">
            Also known by {fmt(p.memberUids.length)} member{p.memberUids.length === 1 ? '' : 's'}:
          </p>
          <ul className="space-y-1">
            {p.memberUids.map((u) => (
              <li key={u}>
                <button className="text-sm font-bold text-amber-200 hover:underline" onClick={() => onSelect({ kind: 'member', uid: u })}>
                  {memberName(u)}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-300 bg-primary/10 border border-primary/20 rounded-lg p-3">
            Ask {memberName(p.memberUids[0])} how well they know {p.label} before you reach out, or for an introduction.
          </p>
        </div>
      );
    }
  } else {
    const top = view.members[0];
    body = (
      <div className="space-y-3 text-sm text-slate-300">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Details</p>
        <p>Click a member (amber) to see the people you both know, or a person (blue) to see who else knows them.</p>
        {top && (
          <p>
            You share the most people with{' '}
            <button className="font-bold text-amber-200 hover:underline" onClick={() => onSelect({ kind: 'member', uid: top.uid })}>
              {top.displayName}
            </button>{' '}
            ({fmt(top.sharedCount)}).
          </p>
        )}
        {view.memberPairs[0] && (
          <p className="text-xs text-slate-400">
            Among the people you share, {view.memberPairs[0].aName} and {view.memberPairs[0].bName} overlap the most (
            {fmt(view.memberPairs[0].count)}).
          </p>
        )}
      </div>
    );
  }

  return (
    <aside
      className="lg:w-80 shrink-0 rounded-xl border border-white/10 bg-slate-900/60 p-4 lg:max-h-[620px] overflow-auto custom-scrollbar"
      data-testid="side-panel"
      aria-live="polite"
    >
      {selection && (
        <button onClick={() => onSelect(null)} className="float-right text-slate-400 hover:text-white" aria-label="Close details">
          <Icon name="close" className="text-base" />
        </button>
      )}
      {body}
    </aside>
  );
};

// -----------------------------
// "What the database stores"
// -----------------------------

const StoredDocs: React.FC<{ view: GraphView; myUid: string }> = ({ view, myUid }) => {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<{ label: string; doc: GraphNodeDoc | null }[] | null>(null);
  const [err, setErr] = useState('');
  const sample = useMemo(() => view.people.slice(0, 3), [view.people]);
  const sampleKey = sample.map((p) => p.personKey).join(',');

  useEffect(() => {
    if (!open || sample.length === 0) return;
    let cancelled = false;
    setDocs(null);
    setErr('');
    Promise.all(sample.map(async (p) => ({ label: p.label, doc: await loadGraphNode(p.personKey) })))
      .then((d) => !cancelled && setDocs(d))
      .catch((e) => !cancelled && setErr(e?.message ?? 'Could not read the stored documents.'));
    return () => {
      cancelled = true;
    };
  }, [open, sampleKey]);

  const nameOf = new Map(view.members.map((m) => [m.uid, m.displayName]));

  return (
    <details
      className="rounded-xl border border-white/10 bg-white/5"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      data-testid="stored-docs"
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-200 flex items-center gap-2">
        <Icon name="storage" className="text-sm text-primary" />
        What the database stores
      </summary>
      <div className="px-4 pb-4 space-y-3">
        <p className="text-sm text-slate-400">
          For {sample.length === 0 ? 'your shared people' : `${sample.length} of your shared people`}: the name on the left
          comes from your own saved connections on this device; the right side is the exact document in the shared
          database. It holds only a hash and member ids.
        </p>
        {sample.length === 0 && <p className="text-sm text-slate-500">Nothing shared with other members yet.</p>}
        {err && <p className="text-sm text-red-200">{err}</p>}
        {open && sample.length > 0 && !docs && !err && <p className="text-sm text-slate-400">Reading…</p>}
        {docs?.map(({ label, doc }) => (
          <div key={doc?.personKey ?? label} className="grid md:grid-cols-[200px_1fr] gap-3 items-start">
            <div className="rounded-lg bg-sky-500/10 border border-sky-500/20 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-sky-300">You see (local)</p>
              <p className="text-sm font-bold text-white">{label}</p>
            </div>
            <pre className="rounded-lg bg-black/40 border border-white/10 p-3 text-xs text-slate-300 overflow-x-auto custom-scrollbar whitespace-pre">
              {doc
                ? `graph_people/${doc.personKey}\n{\n  members: [\n${doc.members
                    .map((u) => `    "${u}"${u === myUid ? '  // you' : nameOf.has(u) ? `  // ${nameOf.get(u)} (from graph_members)` : ''}`)
                    .join(',\n')}\n  ],\n  updatedAt: ${doc.updatedAt ?? 'null'}\n}`
                : 'document not found'}
            </pre>
          </div>
        ))}
        {docs && (
          <p className="text-xs text-slate-500">
            The // comments are added here for reading; they are not stored. Member names come from graph_members/&lt;uid&gt; =
            {' { displayName, updatedAt }'}.
          </p>
        )}
      </div>
    </details>
  );
};

// -----------------------------
// Accessible tables
// -----------------------------

const GraphTables: React.FC<{ view: GraphView; onSelect: (s: Selection) => void }> = ({ view, onSelect }) => {
  const memberName = (uid: string) => view.members.find((m) => m.uid === uid)?.displayName ?? 'A member';
  return (
    <div className="space-y-4">
      <div className="overflow-auto custom-scrollbar rounded-xl border border-white/10">
        <table className="min-w-full text-sm" data-testid="members-table">
          <caption className="text-left px-3 py-2 text-xs font-extrabold text-slate-400 uppercase tracking-wider">
            Members you share connections with
          </caption>
          <thead className="bg-background-dark/95 border-b border-white/10">
            <tr className="text-left">
              <th scope="col" className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Member</th>
              <th scope="col" className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">People in common</th>
              <th scope="col" className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Biggest overlap with another member</th>
            </tr>
          </thead>
          <tbody>
            {view.members.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-3 text-slate-400">No other members yet.</td>
              </tr>
            ) : (
              view.members.map((m) => (
                <tr key={m.uid} className="border-b border-white/5 hover:bg-white/5" data-member-row={m.displayName}>
                  <th scope="row" className="p-3 text-left font-bold text-slate-100">
                    <button className="hover:underline" onClick={() => onSelect({ kind: 'member', uid: m.uid })}>
                      {m.displayName}
                    </button>
                  </th>
                  <td className="p-3 text-slate-300" data-shared={m.sharedCount}>{fmt(m.sharedCount)}</td>
                  <td className="p-3 text-slate-400">
                    {m.overlaps[0] ? `${m.overlaps[0].displayName} (${fmt(m.overlaps[0].count)})` : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <details className="rounded-xl border border-white/10">
        <summary className="cursor-pointer px-3 py-2 text-xs font-extrabold text-slate-400 uppercase tracking-wider">
          People you share with other members ({fmt(view.people.length)})
        </summary>
        <div className="overflow-auto custom-scrollbar max-h-[420px]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-background-dark/95 border-b border-white/10">
              <tr className="text-left">
                <th scope="col" className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Name</th>
                <th scope="col" className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Position</th>
                <th scope="col" className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Company</th>
                <th scope="col" className="p-3 text-xs font-extrabold text-slate-400 uppercase tracking-wider">Also known by</th>
              </tr>
            </thead>
            <tbody>
              {view.people.slice(0, PEOPLE_TABLE_LIMIT).map((p) => (
                <tr key={p.personKey} className="border-b border-white/5 hover:bg-white/5">
                  <th scope="row" className="p-3 text-left font-bold text-slate-100 whitespace-nowrap">{p.label}</th>
                  <td className="p-3 text-slate-300">{p.position || '—'}</td>
                  <td className="p-3 text-slate-300">{p.company || '—'}</td>
                  <td className="p-3 text-slate-300">{p.memberUids.map(memberName).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.people.length > PEOPLE_TABLE_LIMIT && (
            <p className="p-3 text-xs text-slate-500">
              +{fmt(view.people.length - PEOPLE_TABLE_LIMIT)} more. Click a member for their full list.
            </p>
          )}
        </div>
      </details>
    </div>
  );
};

export default NetworkScreen;
