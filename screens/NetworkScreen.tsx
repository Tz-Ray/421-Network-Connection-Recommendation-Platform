import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
  MEMBER_LABEL_PX,
  PERSON_LABEL_PX,
  WORKBENCH_HEIGHT,
  WORKBENCH_WIDTH,
  buildGraphView,
  layoutWorkbench,
  memberNodeId,
  personNodeId,
  pickGraphPeople,
  type GraphNode,
  type GraphView,
  type MemberNode,
} from '../lib/graphView';

import { useDetailRoute, useMedia } from '../components/DetailPane';
import { useShell } from '../components/AppShell';
import { initials } from '../lib/presentation';
import '../styles/network.css';

type Status = 'loading' | 'out' | 'in' | 'error';
type Busy = null | 'join' | 'leave' | 'sync';
type Selection = { kind: 'member'; uid: string } | { kind: 'person'; key: string } | null;

const PEOPLE_TABLE_LIMIT = 200;

function displayName(d: ConnectionDoc): string {
  return d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

const NetworkScreen: React.FC = () => {
  const { announce, profile } = useShell();
  const detail = useDetailRoute('node');
  const narrow = useMedia('(max-width: 1023px)');
  const [tab, setTab] = useState<'graph' | 'list'>(() =>
    window.matchMedia('(max-width: 639px)').matches ? 'list' : 'graph',
  );
  const [info, setInfo] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const stopRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const sharingHeading = useRef<HTMLHeadingElement>(null);
  const [zoom, setZoom] = useState(1);
  const { user } = useAuth();

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [docs, setDocs] = useState<ConnectionDoc[]>([]);
  const [keys, setKeys] = useState<(string | null)[]>([]);
  const [common, setCommon] = useState<CommonConnections | null>(null);
  const [lastSync, setLastSync] = useState<GraphSyncResult | null>(null);

  const requestId = useRef(0);
  const loadStarted = useRef(false);

  async function loadAll(uid: string, opts: { connections: boolean } = { connections: true }) {
    const mine = ++requestId.current;
    const stillMine = () => mine === requestId.current && auth.currentUser?.uid === uid;
    if (opts.connections) setStatus('loading');
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
        detail.clear();
      }
      await loadAll(uid, { connections: false });
      announce(
        kind === 'leave'
          ? 'Sharing stopped. Your shared entries were removed.'
          : kind === 'join'
            ? 'Sharing is on.'
            : 'Shared connections updated.',
      );
    } catch (e: any) {
      if (auth.currentUser?.uid !== uid) return;
      // Some writes may have landed: show the real state, then the error.
      await loadAll(uid, { connections: false });
      if (auth.currentUser?.uid !== uid) return;
      setActionError(
        e?.message ??
          (kind === 'join'
            ? 'Could not start sharing.'
            : kind === 'leave'
              ? 'Could not stop sharing.'
              : 'Could not re-sync.'),
      );
    } finally {
      setBusy(null);
      if (kind !== 'sync') requestAnimationFrame(() => sharingHeading.current?.focus());
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
    [docs, keys, common, status],
  );

  const noUrl = view.totals.noUrl;
  const sharingCount = common?.myNodeCount ?? 0;

  const routeSelection: Selection = detail.value?.startsWith('m:')
    ? { kind: 'member', uid: detail.value.slice(2) }
    : detail.value?.startsWith('p:')
      ? { kind: 'person', key: detail.value.slice(2) }
      : null;
  function select(s: Selection) {
    if (s) detail.open(s.kind === 'member' ? memberNodeId(s.uid) : personNodeId(s.key));
    else if (detail.value) detail.close();
  }
  useEffect(() => {
    if (!confirmStop) return;
    confirmRef.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setConfirmStop(false);
        stopRef.current?.focus();
      }
    };
    const outside = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !stopRef.current?.contains(e.target as Node)) {
        setConfirmStop(false);
        stopRef.current?.focus();
      }
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('pointerdown', outside);
    };
  }, [confirmStop]);
  useEffect(() => {
    if (!narrow || !detail.value) return;
    document.getElementById('network-detail')?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') detail.close();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [narrow, detail.value]);
  const what = (
    <>
      <div className="shared-cols">
        <div>
          <h4>
            <Icon name="check" />
            Shared, and what members see
          </h4>
          <ul>
            <li>A one-way hash of each connection’s LinkedIn profile link, never the link itself.</li>
            <li>Your display name.</li>
            <li>
              A member who already has one of your connections sees that you know that person too. Nothing
              about your other connections.
            </li>
          </ul>
        </div>
        <div>
          <h4>
            <Icon name="lock" />
            Never shared
          </h4>
          <ul>
            <li>Names, titles, companies, emails, notes or messages of your connections.</li>
            <li>Your email address.</li>
            <li>Connections without a profile link (skipped).</li>
          </ul>
        </div>
      </div>
      <p className="hint">
        Known limitation: a member who already knows someone’s profile link can check whether other members
        have that person. Up to {fmt(MAX_GRAPH_KEYS)} connections are shared. Stop sharing removes all your
        entries.
      </p>
      <StoredDocs view={view} myUid={user?.uid ?? ''} />
    </>
  );
  const side = (
    <SidePanel
      view={view}
      selection={routeSelection}
      onSelect={select}
      name={profile.displayName || user?.displayName || 'You'}
      sharingCount={sharingCount}
      total={docs.length}
    />
  );
  return (
    <section className="view net-view on" id="v-network">
      <div className="net">
        <div className="net-main">
          <section className="panel share-card" aria-labelledby="sharing-title" data-testid="sharing-card">
            <div className="panel-b">
              <div className="share-state">
                <h2 id="sharing-title" ref={sharingHeading} tabIndex={-1}>
                  <span className={`dot ${status === 'in' ? '' : 'off'}`}>
                    {busy === 'leave'
                      ? 'Stopping…'
                      : status === 'in'
                        ? 'Sharing is on'
                        : status === 'loading'
                          ? 'Loading sharing status…'
                          : status === 'error'
                            ? 'Sharing status unavailable'
                            : 'Sharing is off'}
                  </span>
                </h2>
                {status === 'in' && (
                  <>
                    <span className="muted">
                      {fmt(sharingCount)} of {fmt(docs.length)} shared
                    </span>
                    <button
                      className="linkbtn"
                      aria-expanded={info}
                      aria-controls="share-info"
                      onClick={() => setInfo(!info)}
                    >
                      What members see
                    </button>
                  </>
                )}
                <div className="acts">
                  {status === 'out' && (
                    <button
                      className="btn primary"
                      data-testid="network-share"
                      disabled={busy !== null || !docs.length}
                      onClick={() => void runAction('join')}
                    >
                      <Icon name="network" />
                      {busy === 'join' ? 'Sharing…' : 'Share my connections'}
                    </button>
                  )}
                  {status === 'in' && (
                    <>
                      <button
                        className="btn sm"
                        disabled={busy !== null}
                        onClick={() => void runAction('sync')}
                      >
                        <Icon name="sync" />
                        {busy === 'sync' ? 'Syncing…' : 'Re-sync now'}
                      </button>
                      <button
                        className="btn sm"
                        ref={stopRef}
                        data-testid="network-stop"
                        disabled={busy !== null}
                        aria-expanded={confirmStop}
                        onClick={() => setConfirmStop(!confirmStop)}
                      >
                        {busy === 'leave' ? 'Stopping…' : 'Stop sharing…'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {confirmStop && (
                <div ref={popRef} className="note warn share-pop" role="group" aria-labelledby="share-pop-h">
                  <Icon name="alert" />
                  <div>
                    <b id="share-pop-h">Stop sharing?</b>
                    <p>
                      This will remove your {fmt(sharingCount)} shared entries, and other members will no
                      longer see that you know anyone. You can share again later.
                    </p>
                    <div className="actions">
                      <button
                        className="btn sm danger"
                        ref={confirmRef}
                        disabled={busy !== null}
                        onClick={() => {
                          setConfirmStop(false);
                          void runAction('leave');
                        }}
                      >
                        Stop sharing
                      </button>
                      <button
                        className="btn sm"
                        onClick={() => {
                          setConfirmStop(false);
                          stopRef.current?.focus();
                        }}
                      >
                        Keep sharing
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {actionError && (
                <p className="note bad" role="alert">
                  {actionError}
                </p>
              )}
              {status === 'out' && (
                <>
                  <p className="hint">
                    Share to see which other members know the same people you do, and who could introduce you.
                    It is optional and you can stop at any time.
                  </p>
                  {what}
                  {!docs.length && (
                    <p className="hint">
                      You have no saved connections yet.{' '}
                      <Link className="btn primary" to="/recommender" state={{ importConnections: true }}>
                        Import your LinkedIn data
                      </Link>{' '}
                      first, then share.
                    </p>
                  )}
                </>
              )}
              {status === 'in' && lastSync && (
                <p className="hint sync-summary" role="status">
                  Added {fmt(lastSync.added)} · Removed {fmt(lastSync.removed)} · Kept {fmt(lastSync.kept)}
                </p>
              )}
              {status === 'in' && (
                <div id="share-info" className="share-info" hidden={!info}>
                  {what}
                  <div data-testid="sync-status">
                    <p className="hint">
                      Sharing {fmt(sharingCount)} connections
                      {noUrl ? ` (${fmt(noUrl)} without a profile link are not shared)` : ''}. Saving new
                      connections updates what you share automatically.
                    </p>
                    {lastSync ? (
                      <dl className="sync-counts" aria-label="Last sync">
                        {(
                          [
                            ['Added', lastSync.added],
                            ['Removed', lastSync.removed],
                            ['Kept', lastSync.kept],
                            ['Skipped (no URL)', lastSync.skippedNoUrl],
                            [`Over ${fmt(MAX_GRAPH_KEYS)} cap`, lastSync.capped],
                          ] as const
                        ).map(([label, n]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{fmt(n)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="hint">
                        No sync in this visit yet. Re-sync now shows added / removed / kept numbers.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
          {narrow && detail.value ? (
            <section id="network-detail" tabIndex={-1} className="net-detail" aria-label="Selected node">
              <button className="btn ghost back-btn" onClick={detail.close}>
                <Icon name="left" />
                Back to the {tab === 'graph' ? 'graph' : 'list'}
              </button>
              {side}
            </section>
          ) : null}
          <section
            className="network-content"
            hidden={narrow && !!detail.value}
            aria-labelledby="graph-title"
          >
            <h2 id="graph-title" className="sr-only">
              Your common connections
            </h2>
            {status === 'loading' && (
              <p className="zero" role="status" data-testid="graph-loading">
                Loading your network…
              </p>
            )}
            {status === 'error' && (
              <div className="note bad" role="alert">
                <div>
                  <p>The network graph could not be loaded: {error}</p>
                  <button className="btn" onClick={() => user && void loadAll(user.uid)}>
                    Try again
                  </button>
                </div>
              </div>
            )}
            {status === 'out' && (
              <div className="lock-panel" data-testid="graph-out">
                <Icon name="lock" />
                <div>
                  <b>The graph appears after you choose to share</b>
                  <p className="muted">
                    Until then this page shows nothing about other members, and they see nothing about you.
                  </p>
                </div>
              </div>
            )}
            {status === 'in' && (
              <>
                <Counts view={view} />
                {!view.members.length && (
                  <p className="note" data-testid="graph-empty">
                    No other members share connections with you yet. When someone who knows the same people
                    starts sharing, they appear here.
                  </p>
                )}
                <div className="net-bar">
                  <div className="tabs" role="tablist" aria-label="Network views">
                    {(['graph', 'list'] as const).map((t) => (
                      <button
                        key={t}
                        className="tab"
                        role="tab"
                        aria-selected={tab === t}
                        tabIndex={tab === t ? 0 : -1}
                        id={`network-tab-${t}`}
                        aria-controls={`network-panel-${t}`}
                        onKeyDown={(e) => {
                          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                          e.preventDefault();
                          const next =
                            e.key === 'Home'
                              ? 'graph'
                              : e.key === 'End'
                                ? 'list'
                                : t === 'graph'
                                  ? 'list'
                                  : 'graph';
                          setTab(next);
                          document.getElementById(`network-tab-${next}`)?.focus();
                        }}
                        data-testid={t === 'list' ? 'network-list-tab' : undefined}
                        onClick={() => setTab(t)}
                      >
                        {t === 'graph' ? 'Graph' : 'List'}
                      </button>
                    ))}
                  </div>
                  {tab === 'graph' && (
                    <div className="graph-tools" role="group" aria-label="Zoom">
                      <button
                        className="icon-btn"
                        aria-label="Zoom out"
                        title="Zoom out"
                        disabled={zoom <= ZOOM_MIN}
                        onClick={() => setZoom((z) => clampZoom(z - 0.25))}
                      >
                        <Icon name="minus" />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Zoom in"
                        title="Zoom in"
                        disabled={zoom >= ZOOM_MAX}
                        onClick={() => setZoom((z) => clampZoom(z + 0.25))}
                      >
                        <Icon name="plus" />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Reset zoom"
                        title="Reset zoom"
                        onClick={() => setZoom(1)}
                      >
                        <Icon name="reset" />
                      </button>
                      <span className="mono muted">{Math.round(zoom * 100)}%</span>
                    </div>
                  )}
                </div>
                {tab === 'graph' ? (
                  <figure
                    className="net-fig"
                    role="tabpanel"
                    id="network-panel-graph"
                    aria-labelledby="network-tab-graph"
                  >
                    <figcaption id="g-cap" className="muted">
                      Pick a member (square) to see the people you both know.{' '}
                      <span className="hover-hint">Hover to preview their lines.</span>{' '}
                      {zoom > 1 && 'Scroll inside the box to move around.'}
                    </figcaption>
                    <GraphCanvas
                      view={view}
                      selection={routeSelection}
                      onSelect={select}
                      zoom={zoom}
                      setZoom={setZoom}
                    />
                  </figure>
                ) : (
                  <GraphTables view={view} onSelect={select} selection={routeSelection} />
                )}
              </>
            )}
          </section>
        </div>
        {!narrow && (
          <aside className="net-side" aria-label="Selected node">
            {status === 'in' ? (
              side
            ) : status === 'loading' ? (
              <p className="side-sec muted">Loading your network…</p>
            ) : (
              <div className="side-sec">
                <h3>How it works</h3>
                <ol className="steps">
                  <li>You share hashes of your connections’ profile links.</li>
                  <li>Members who share the same person are linked to it.</li>
                  <li>You see members you have people in common with, and who.</li>
                </ol>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
};

const Counts: React.FC<{ view: GraphView }> = ({ view }) => (
  <div className="network-counts" data-testid="graph-counts">
    {(
      [
        ['members', view.totals.members],
        ['people in common', view.totals.sharedPeople],
        ['not shared with anyone', view.totals.unshared],
      ] as const
    ).map(([label, n]) => (
      <span key={label}>
        <strong data-count={label}>{fmt(n)}</strong>{' '}
        {label === 'not shared with anyone' ? 'no other member knows' : label}
      </span>
    ))}
  </div>
);
const Legend: React.FC = () => (
  <div className="legend">
    <span>
      <i className="lgd you" />
      You
    </span>
    <span>
      <i className="lgd mem" />
      Member (square)
    </span>
    <span>
      <i className="lgd per" />
      Shared person (circle)
    </span>
    <span>Lines: the selected member or person</span>
  </div>
);

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
function clampZoom(z: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}

const GraphCanvas: React.FC<{
  view: GraphView;
  selection: Selection;
  onSelect: (s: Selection) => void;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
}> = ({ view, selection, onSelect, zoom, setZoom }) => {
  const coarse = useMedia('(pointer: coarse)');
  const W = WORKBENCH_WIDTH;
  const H = WORKBENCH_HEIGHT;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  // Drawing units per screen pixel: `fit` at 100% (rounded up; the layout makes room for labels of
  // that size) and `unit` as drawn now (label fonts use it, so they stay 12px / 13px on screen).
  const [fit, setFit] = useState(1);
  const [unit, setUnit] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const shown = useRef<string[] | null>(null);
  const centre = useRef({ x: 0.5, y: 0.5 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const focusKey = selection
    ? selection.kind === 'member'
      ? `m:${selection.uid}`
      : `p:${selection.key}`
    : '';
  // A clicked person keeps the set that was on screen (shown.current, updated after each render).
  const people = useMemo(() => pickGraphPeople(view, selection, shown.current), [view, focusKey]);
  const keep = selection?.kind === 'person' ? personNodeId(selection.key) : undefined;
  const layout = useMemo(
    () => layoutWorkbench(view, { people, labelScale: fit, keep }),
    [view, people, fit, keep],
  );
  const drawn = useMemo(() => {
    const ids = new Set(layout.people);
    return people.filter((p) => ids.has(p.id));
  }, [people, layout]);
  useEffect(() => {
    shown.current = drawn.map((p) => p.personKey);
    // A hovered person that is no longer drawn never gets its mouseleave.
    setHover((h) => (h?.startsWith('p:') && !drawn.some((p) => p.id === h) ? null : h));
  }, [drawn]);

  function measure() {
    const el = box.current;
    const sv = svg.current;
    if (!el || !sv) return;
    const w = el.offsetWidth - 2 * el.clientLeft;
    const h = el.offsetHeight - 2 * el.clientTop;
    if (w > 0 && h > 0) {
      const k = Math.ceil(20 * Math.max(W / w, H / h) - 1e-6) / 20;
      setFit((old) => (old === k ? old : k));
    }
    const r = sv.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const u = Math.max(W / r.width, H / r.height);
      setUnit((old) => (Math.abs(old - u) < 0.002 ? old : u));
    }
  }
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (box.current) ro.observe(box.current);
    if (svg.current) ro.observe(svg.current);
    const el = box.current;
    const wheel = (e: WheelEvent) => {
      if (
        !e.deltaY ||
        (zoomRef.current > ZOOM_MIN && !e.ctrlKey) ||
        (e.deltaY > 0 && zoomRef.current <= ZOOM_MIN)
      )
        return;
      e.preventDefault();
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.1 : -0.1)));
    };
    el?.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el?.removeEventListener('wheel', wheel);
    };
  }, [setZoom]);
  // Zoom keeps the point at the centre of the box where it was; 100% shows the whole drawing.
  useLayoutEffect(() => {
    const el = box.current;
    if (el) {
      if (zoom <= ZOOM_MIN) {
        centre.current = { x: 0.5, y: 0.5 };
        el.scrollLeft = 0;
        el.scrollTop = 0;
      } else {
        el.scrollLeft = centre.current.x * el.scrollWidth - el.clientWidth / 2;
        el.scrollTop = centre.current.y * el.scrollHeight - el.clientHeight / 2;
      }
    }
    measure();
  }, [zoom]);
  const onScroll = () => {
    const el = box.current;
    if (!el || zoom <= ZOOM_MIN) return;
    centre.current = {
      x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
      y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
    };
  };

  const selected =
    selection?.kind === 'member'
      ? memberNodeId(selection.uid)
      : selection?.kind === 'person'
        ? personNodeId(selection.key)
        : 'you';
  const active = hover || selected;
  const members = view.nodes.filter((n): n is MemberNode => n.kind === 'member');
  const linesFor = (id: string | null): [string, string][] => {
    if (!id) return [];
    const member = members.find((m) => m.id === id);
    if (member) return drawn.filter((p) => p.memberUids.includes(member.uid)).map((p) => [member.id, p.id]);
    const person = drawn.find((p) => p.id === id);
    return person ? person.memberUids.map((u) => [memberNodeId(u), person.id]) : [];
  };
  const line =
    (cls: string) =>
    ([a, b]: [string, string]) => {
      const p = layout.positions[a];
      const q = layout.positions[b];
      return p && q ? (
        <line key={`${cls}-${a}-${b}`} className={cls} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
      ) : null;
    };
  const label = (id: string, px: number, cls: string) => {
    const b = layout.labels[id];
    if (!b || b.inside) return null;
    const x = b.anchor === 'middle' ? b.x + b.width / 2 : b.anchor === 'end' ? b.x + b.width : b.x;
    return (
      <text
        className={cls}
        x={x}
        y={b.y + b.height / 2}
        dominantBaseline="central"
        textAnchor={b.anchor}
        style={{ fontSize: Math.min(b.fontSize, px * unit), strokeWidth: 3 * unit }}
      >
        {b.text}
      </text>
    );
  };
  const node = (n: GraphNode, body: React.ReactNode, hitR: number) => {
    const p = layout.positions[n.id];
    const choose = () =>
      onSelect(
        n.kind === 'member'
          ? { kind: 'member', uid: n.uid }
          : n.kind === 'person'
            ? { kind: 'person', key: n.personKey }
            : null,
      );
    return (
      <g
        key={n.id}
        className={`gnode ${selected === n.id ? 'sel' : ''} ${n.kind === 'person' && n.memberUids.some((u) => memberNodeId(u) === active) ? 'hi' : ''}`}
        tabIndex={0}
        role="button"
        aria-label={
          n.kind === 'member'
            ? `${n.label}, member, ${n.sharedCount} people in common`
            : n.kind === 'person'
              ? `${n.label}, shared connection, also known by ${n.memberUids.length} members`
              : 'You'
        }
        aria-pressed={selected === n.id}
        data-node-kind={n.kind}
        data-member-name={n.kind === 'member' ? n.label : undefined}
        data-member-uid={n.kind === 'member' ? n.uid : undefined}
        data-shared={n.kind === 'member' ? n.sharedCount : undefined}
        onClick={choose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose();
          }
        }}
        onMouseEnter={() => setHover(n.id)}
        onMouseLeave={() => setHover(null)}
      >
        <title>{n.label}</title>
        <circle className="n-hit" cx={p.x} cy={p.y} r={hitR} />
        {body}
      </g>
    );
  };
  const you = view.nodes.find((n) => n.kind === 'you')!;
  const yp = layout.positions.you;
  const focusedMember =
    selection?.kind === 'member' ? view.members.find((m) => m.uid === selection.uid) : null;
  const total = focusedMember ? focusedMember.knownCount : view.totals.sharedPeople;
  return (
    <>
      <div
        className={`graph-box${zoom > ZOOM_MIN ? ' zoomed' : ''}`}
        ref={box}
        data-testid="network-graph"
        onScroll={onScroll}
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          role="group"
          aria-labelledby="g-cap"
          data-testid="graph-svg"
        >
          {members.map((m) => line('e-you')(['you', m.id]))}
          {hover && hover !== selected ? linesFor(hover).map(line('e-mem hov')) : null}
          {linesFor(selected).map(line('e-hi'))}
          {node(
            you,
            <>
              <circle className="n-you" cx={yp.x} cy={yp.y} r={yp.r} />
              <text
                className="n-you-t"
                x={yp.x}
                y={yp.y}
                dominantBaseline="central"
                textAnchor="middle"
                style={{ fontSize: Math.min(yp.r * 0.75, 13 * unit) }}
              >
                You
              </text>
            </>,
            yp.r,
          )}
          {members.map((m) => {
            const p = layout.positions[m.id];
            return node(
              m,
              <>
                <rect className="n-mem" x={p.x - p.r} y={p.y - p.r} width={2 * p.r} height={2 * p.r} rx={7} />
                <text
                  className="n-mem-t"
                  x={p.x}
                  y={p.y}
                  dominantBaseline="central"
                  textAnchor="middle"
                  style={{
                    fontSize: Math.min(
                      layout.labels[m.id]?.inside ? layout.labels[m.id].fontSize : p.r * 1.05,
                      11 * unit,
                    ),
                  }}
                >
                  {initials(m.label)}
                </text>
                {label(m.id, MEMBER_LABEL_PX, 'n-lab')}
              </>,
              p.r * 1.2,
            );
          })}
          {drawn.map((d) => {
            const p = layout.positions[d.id];
            return node(
              d,
              <>
                <circle className="n-per" cx={p.x} cy={p.y} r={p.r} />
                {label(d.id, PERSON_LABEL_PX, 'n-plab')}
              </>,
              Math.max(p.r + 3, (coarse ? 22 : 14) * unit),
            );
          })}
        </svg>
      </div>
      <Legend />
      {total > 0 && (
        <p className="graph-note" data-testid="hidden-note">
          {drawn.length < total
            ? `The graph shows ${fmt(drawn.length)} of ${fmt(total)} ${focusedMember ? `people you share with ${focusedMember.displayName}` : 'shared people'}. The List tab has all shared people.`
            : `The graph shows all ${fmt(total)} ${focusedMember ? `people you share with ${focusedMember.displayName}` : 'shared people'}.`}
        </p>
      )}
    </>
  );
};

const SidePanel: React.FC<{
  view: GraphView;
  selection: Selection;
  onSelect: (s: Selection) => void;
  name: string;
  sharingCount: number;
  total: number;
}> = ({ view, selection, onSelect, name, sharingCount, total }) => {
  const memberName = (uid: string) => view.members.find((m) => m.uid === uid)?.displayName ?? 'A member';
  const m = selection?.kind === 'member' ? view.members.find((x) => x.uid === selection.uid) : null;
  const p = selection?.kind === 'person' ? view.people.find((x) => x.personKey === selection.key) : null;
  return (
    <div data-testid="side-panel">
      <p className="sr-only" role="status">
        {m
          ? `${m.displayName}: ${fmt(m.sharedCount)} people in common.`
          : p
            ? `${p.label}: also known by ${p.memberUids.length} members.`
            : selection
              ? 'No longer shared.'
              : `You share ${fmt(sharingCount)} connections.`}
      </p>
      {m ? (
        <div data-member-uid={m.uid}>
          <div className="side-sec">
            <span className="chip">Member</span>
            <h3>{m.displayName}</h3>
            <p data-testid="panel-shared">
              You both know <b>{fmt(m.sharedCount)}</b> {m.sharedCount === 1 ? 'person' : 'people'}.
              {m.knownCount < m.sharedCount &&
                ` ${fmt(m.sharedCount - m.knownCount)} of them are not in your saved connections any more.`}
            </p>
            <p className="intro">
              Ask {m.displayName} for an introduction or a warm word before you reach out to someone you both
              know.
            </p>
          </div>
          <div className="side-sec">
            <h4>People you both know ({fmt(m.people.length)})</h4>
            <ul className="plist mlist" data-testid="panel-people">
              {m.people.map((p) => (
                <li key={p.personKey}>
                  <button className="lnk" onClick={() => onSelect({ kind: 'person', key: p.personKey })}>
                    {p.label}
                  </button>
                  <span className="co">{[p.position, p.company].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </div>
          {!!m.overlaps.length && (
            <div className="side-sec">
              <h4>Also knows some of these people</h4>
              <ul className="plist mlist">
                {m.overlaps.slice(0, 4).map((o) => (
                  <li key={o.uid}>
                    <button className="lnk" onClick={() => onSelect({ kind: 'member', uid: o.uid })}>
                      {o.displayName}
                    </button>
                    <span className="co">{fmt(o.count)} in common</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : p ? (
        <>
          <div className="side-sec">
            <span className="chip">Your connection</span>
            <h3>{p.names.join(' / ')}</h3>
            <p className="muted">{[p.position, p.company].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="side-sec">
            <h4>
              Also known by {fmt(p.memberUids.length)} member{p.memberUids.length === 1 ? '' : 's'}
            </h4>
            <ul className="plist mlist">
              {p.memberUids.map((uid) => (
                <li key={uid}>
                  <button className="lnk" onClick={() => onSelect({ kind: 'member', uid })}>
                    {memberName(uid)}
                  </button>
                </li>
              ))}
            </ul>
            <p className="intro">
              You already know {p.label}. Ask {memberName(p.memberUids[0])} how well they know each other
              before reaching out.
            </p>
          </div>
        </>
      ) : selection ? (
        <div className="side-sec">
          <p>No longer shared.</p>
        </div>
      ) : (
        <>
          <div className="side-sec">
            <span className="chip">You</span>
            <h3>{name}</h3>
            <p>
              You share <b>{fmt(sharingCount)}</b> of {fmt(total)} connections.
              {view.totals.noUrl > 0 && ` ${fmt(view.totals.noUrl)} have no profile link and are not shared.`}
            </p>
          </div>
          <div className="side-sec">
            <h4>Members you share people with ({view.members.length})</h4>
            <ul className="plist mlist">
              {view.members.map((m) => (
                <li key={m.uid}>
                  <button className="lnk" onClick={() => onSelect({ kind: 'member', uid: m.uid })}>
                    {m.displayName}
                  </button>
                  <span className="co">{fmt(m.sharedCount)} people in common</span>
                </li>
              ))}
            </ul>
            <p className="hint">Pick a member to see the people you both know and who could introduce you.</p>
          </div>
        </>
      )}
    </div>
  );
};

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
      className="db"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      data-testid="stored-docs"
    >
      <summary>
        <Icon name="chev" className="chev" />
        <Icon name="storage" />
        What the database stores
      </summary>
      <div className="stack">
        <p>
          {sample.length
            ? `For ${sample.length} shared people: each name comes from your own saved connections. Beneath it is the exact document in the shared database, containing only a hash, member ids and an update timestamp.`
            : 'No shared documents to show yet.'}
        </p>
        {sample.length === 0 && <p>Nothing shared with other members yet.</p>}
        {err && (
          <p role="alert" className="err">
            {err}
          </p>
        )}
        {open && sample.length > 0 && !docs && !err && <p role="status">Reading…</p>}
        {docs?.map(({ label, doc }) => (
          <div key={doc?.personKey ?? label}>
            <div>
              <p className="lbl-s muted">You see (local)</p>
              <p>{label}</p>
            </div>
            <pre>
              {doc
                ? `graph_people/${doc.personKey}\n{\n  members: [\n${doc.members
                    .map(
                      (u, i) =>
                        `    "${u}"${i < doc.members.length - 1 ? ',' : ''}${u === myUid ? '  // you' : nameOf.has(u) ? `  // ${nameOf.get(u)} (from graph_members)` : ''}`,
                    )
                    .join('\n')}\n  ],\n  updatedAt: ${doc.updatedAt ?? 'null'}\n}`
                : 'document not found'}
            </pre>
          </div>
        ))}
        {docs && (
          <p>
            The // comments are added here for reading; they are not stored. Member names come from
            graph_members/&lt;uid&gt; ={' { displayName, updatedAt }'}.
          </p>
        )}
      </div>
    </details>
  );
};

const GraphTables: React.FC<{ view: GraphView; onSelect: (s: Selection) => void; selection: Selection }> = ({
  view,
  onSelect,
  selection,
}) => {
  const [limit, setLimit] = useState(PEOPLE_TABLE_LIMIT);
  const selectedMember = (uid: string) => selection?.kind === 'member' && selection.uid === uid;
  const selectedPerson = (key: string) => selection?.kind === 'person' && selection.key === key;
  const memberName = (uid: string) => view.members.find((m) => m.uid === uid)?.displayName ?? 'A member';
  return (
    <div
      className="network-tables stack"
      role="tabpanel"
      id="network-panel-list"
      aria-labelledby="network-tab-list"
    >
      <p className="hint">People are ordered by the number of members who know them, then by name.</p>
      <div className="tbl-wrap">
        <table className="tbl" data-testid="members-table">
          <caption className="sr-only">Members you share connections with</caption>
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col" className="num">
                People in common
              </th>
              <th scope="col" className="overlap-column">
                Biggest overlap with another member
              </th>
            </tr>
          </thead>
          <tbody>
            {view.members.length ? (
              view.members.map((m) => (
                <tr
                  key={m.uid}
                  data-member-row={m.displayName}
                  className={selectedMember(m.uid) ? 'is-sel' : undefined}
                >
                  <th scope="row">
                    <button
                      aria-pressed={selectedMember(m.uid)}
                      onClick={() => onSelect({ kind: 'member', uid: m.uid })}
                    >
                      {m.displayName}
                    </button>
                  </th>
                  <td className="num" data-shared={m.sharedCount}>
                    {fmt(m.sharedCount)}
                  </td>
                  <td className="overlap-column">
                    {m.overlaps[0] ? `${m.overlaps[0].displayName} (${fmt(m.overlaps[0].count)})` : '—'}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3}>No other members yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="tbl-wrap ntbl-people">
        <table className="tbl">
          <caption>People you share with other members ({fmt(view.people.length)})</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Title</th>
              <th scope="col">Company</th>
              <th scope="col">Also known by</th>
            </tr>
          </thead>
          <tbody>
            {view.people.slice(0, limit).map((p) => (
              <tr key={p.personKey} className={selectedPerson(p.personKey) ? 'is-sel' : undefined}>
                <th scope="row">
                  <button
                    aria-pressed={selectedPerson(p.personKey)}
                    onClick={() => onSelect({ kind: 'person', key: p.personKey })}
                  >
                    {p.label}
                  </button>
                </th>
                <td>{p.position || '—'}</td>
                <td>{p.company || '—'}</td>
                <td>{p.memberUids.map(memberName).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="nlist" aria-label="Shared people">
        {view.people.slice(0, limit).map((p) => (
          <li key={p.personKey} className={selectedPerson(p.personKey) ? 'is-sel' : undefined}>
            <button
              aria-pressed={selectedPerson(p.personKey)}
              onClick={() => onSelect({ kind: 'person', key: p.personKey })}
            >
              {p.label}
            </button>
            <span>
              {[p.position, p.company, `Also known by ${p.memberUids.map(memberName).join(', ')}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      {view.people.length > limit && (
        <div className="actions">
          <button className="btn" onClick={() => setLimit((n) => n + PEOPLE_TABLE_LIMIT)}>
            Show {fmt(Math.min(PEOPLE_TABLE_LIMIT, view.people.length - limit))} more
          </button>
          <span className="hint">
            {fmt(limit)} of {fmt(view.people.length)} shown
          </span>
        </div>
      )}
    </div>
  );
};
export default NetworkScreen;
