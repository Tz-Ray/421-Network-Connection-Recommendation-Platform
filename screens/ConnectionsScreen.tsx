import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  isGraphMember,
  loadCommonConnections,
  personKeyFor,
  type CommonConnections,
} from '../lib/networkGraph';

import { DetailPane, useDetailRoute } from '../components/DetailPane';
import { PersonHeading, PersonFacts } from '../components/PersonFacts';
import { useShell } from '../components/AppShell';
import { dateLabel, docIdParts, personIds, relationshipFacts } from '../lib/presentation';
import { addFavorite, removeFavorite, listFavorites } from '../lib/savedItems';
import { candidateKeysFor } from '../lib/telemetry';
import '../styles/connections.css';

const DEFAULT_PAGE_SIZE = 50;

type SortMode = 'default' | 'warmest' | 'common' | 'name' | 'last' | 'messages';

type GraphStatus = 'loading' | 'out' | 'in' | 'error';

function displayName(d: ConnectionDoc): string {
  const name = d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
  return name || '';
}

const ConnectionsScreen: React.FC = () => {
  const navigate = useNavigate();
  const detailRoute = useDetailRoute();
  const shell = useShell();
  const [selectedId, setSelectedId] = useState('');
  const tableRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoriteKey, setFavoriteKey] = useState('');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const favoriteFlight = useRef(false);
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

  // Common-connections graph (opt-in; managed on /network). Read here only for
  // the status line, the `In common` column and the `Most in common` sort.
  const [graphStatus, setGraphStatus] = useState<GraphStatus>('loading');
  const [common, setCommon] = useState<CommonConnections | null>(null);
  const [keyByRow, setKeyByRow] = useState<Map<ConnectionDoc, string | null>>(() => new Map());
  const graphRequestId = useRef(0);
  const graphLoadStarted = useRef(false);

  async function loadGraph(uid: string) {
    const myRequest = ++graphRequestId.current;
    const stillMine = () => myRequest === graphRequestId.current && auth.currentUser?.uid === uid;

    setGraphStatus('loading');
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
    } catch (e: unknown) {
      if (!stillMine()) return;
      console.warn('Common connections unavailable:', e);
      setCommon(null);
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

  function inCommonCount(r: ConnectionDoc): number {
    if (graphStatus !== 'in' || !common) return 0;
    const key = keyByRow.get(r);
    return key ? (common.othersByPerson.get(key)?.length ?? 0) : 0;
  }

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
    if (sortMode === 'name')
      return [...filtered].sort((a, b) => displayName(a).localeCompare(displayName(b)));
    if (sortMode === 'last')
      return [...filtered].sort((a, b) => (b.lastMessagedAt || '').localeCompare(a.lastMessagedAt || ''));
    if (sortMode === 'messages')
      return [...filtered].sort((a, b) => (b.messageCount ?? -1) - (a.messageCount ?? -1));
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

  const ids = useMemo(() => new Map(personIds(rows, docIdParts).map((id, i) => [rows[i], id])), [rows]);
  const rowId = (r: ConnectionDoc) => ids.get(r)!;
  const selected =
    detailRoute.value != null
      ? rows.find((r) => rowId(r) === detailRoute.value)
      : page.find((r) => rowId(r) === selectedId) || page[0];
  const controls = useRef({ filter, sortMode, pageSize });
  const lastRoute = useRef<{ value: string | null; rows: ConnectionDoc[] } | null>(null);
  useEffect(() => {
    if (loading) return;
    const changed =
      controls.current.filter !== filter ||
      controls.current.sortMode !== sortMode ||
      controls.current.pageSize !== pageSize;
    controls.current = { filter, sortMode, pageSize };
    if (changed) {
      setPageIndex(0);
      const first = sorted[0];
      setSelectedId(first ? rowId(first) : '');
      if (detailRoute.value != null) {
        if (first) detailRoute.open(rowId(first), true);
        else detailRoute.clear();
      }
      return;
    }
    if (lastRoute.current?.value === detailRoute.value && lastRoute.current?.rows === rows) return;
    lastRoute.current = { value: detailRoute.value, rows };
    if (detailRoute.value == null) return;
    const at = sorted.findIndex((r) => rowId(r) === detailRoute.value);
    if (at >= 0) {
      setPageIndex(Math.floor(at / pageSize));
      setSelectedId(detailRoute.value);
    }
  }, [loading, rows, sorted, detailRoute.value, filter, sortMode, pageSize]);
  useEffect(() => {
    if (tableRef.current) tableRef.current.scrollTop = 0;
  }, [safePageIndex, filter, sortMode, pageSize]);
  useEffect(() => {
    if (!detailRoute.value) return;
    const frame = requestAnimationFrame(() => {
      const row = tableRef.current?.querySelector<HTMLElement>('tr.is-sel');
      const box = tableRef.current;
      if (row && box) box.scrollTop = Math.max(0, row.offsetTop - box.offsetTop - 34);
    });
    return () => cancelAnimationFrame(frame);
  }, [detailRoute.value, safePageIndex, loading]);
  const goPage = (index: number) => {
    setPageIndex(index);
    const first = sorted[index * pageSize];
    setSelectedId(first ? rowId(first) : '');
    if (first && detailRoute.value != null) detailRoute.open(rowId(first), true);
  };
  const rel = useMemo(
    () => (selected ? relationshipSignals(docToRow(selected), networkContext, new Date()) : null),
    [selected, networkContext],
  );
  useEffect(() => {
    let active = true;
    void listFavorites()
      .then((fs) => {
        if (active) setFavoriteIds(new Set(fs.map((f) => f.id)));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.uid]);
  useEffect(() => {
    let active = true;
    setFavoriteKey('');
    if (selected)
      void candidateKeysFor(docToRow(selected))
        .then((k) => {
          if (active) setFavoriteKey(k.id);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [selected]);
  async function setSavedPerson(id: string, row: Record<string, unknown>, save: boolean, undo = false) {
    if (!user || !id || favoriteFlight.current) return;
    const uid = user.uid;
    favoriteFlight.current = true;
    setFavoriteBusy(true);
    try {
      if (save) await addFavorite(id, row);
      else await removeFavorite(id);
      if (auth.currentUser?.uid !== uid) return;
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (save) next.add(id);
        else next.delete(id);
        return next;
      });
      shell.announce(
        save ? 'Saved to saved people.' : 'Removed from saved people.',
        undo ? undefined : () => setSavedPerson(id, row, !save, true),
      );
    } catch (e: any) {
      shell.announce(e?.message || 'Could not update saved people.');
    } finally {
      favoriteFlight.current = false;
      setFavoriteBusy(false);
    }
  }
  const select = (row: ConnectionDoc) => {
    setSelectedId(rowId(row));
    detailRoute.open(rowId(row));
  };
  const selectedKey = selected ? keyByRow.get(selected) : null;
  const memberNames =
    selectedKey && common
      ? (common.othersByPerson.get(selectedKey) || [])
          .map((uid) => common.members.find((m) => m.uid === uid)?.displayName)
          .filter(Boolean)
      : [];
  const sorts: [SortMode, string][] = [
    ['default', 'Default order'],
    ['warmest', 'Warmest first'],
    ['common', 'Most in common'],
    ['name', 'Name A–Z'],
    ['last', 'Last contact'],
    ['messages', 'Most messages'],
  ];
  const sort = (mode: SortMode) => {
    setSortMode(mode);
    setPageIndex(0);
  };
  const sortHeader = (mode: SortMode, label: string, numeric = false) => (
    <th
      scope="col"
      className={numeric ? 'num' : ''}
      aria-sort={sortMode === mode ? (mode === 'name' ? 'ascending' : 'descending') : undefined}
    >
      <button onClick={() => sort(mode)} disabled={mode === 'common' && graphStatus !== 'in'}>
        {label}
        {sortMode === mode && <Icon name={mode === 'name' ? 'up' : 'down'} />}
      </button>
    </th>
  );
  return (
    <section
      id="v-connections"
      className={`view split split-table on ${detailRoute.value ? 'detail-open' : ''}`}
      aria-label="Connections"
    >
      <div className="pane list-pane">
        <div className="pane-head">
          <div className="connections-header page-h">
            <div>
              <h2>{loading ? 'Connections' : `${rows.length.toLocaleString()} connections`}</h2>
            </div>
            <div className="act" hidden={!rows.length}>
              <button
                className="btn sm"
                disabled={!rows.length}
                onClick={() => navigate('/recommender', { state: { loadFromAccount: true } })}
              >
                Use in Search
              </button>
              <button
                className="btn sm"
                onClick={() => navigate('/recommender', { state: { importConnections: true } })}
              >
                <Icon name="upload" />
                Import
              </button>
              <button
                className="icon-btn"
                title="Refresh"
                aria-label="Refresh"
                disabled={loading}
                onClick={() => {
                  void loadAll();
                  if (user) void loadGraph(user.uid);
                }}
              >
                <Icon name="reset" />
              </button>
            </div>
          </div>
          <div className="toolbar" hidden={!rows.length}>
            <label className="sr-only" htmlFor="conn-filter">
              Filter connections
            </label>
            <input
              className="input"
              id="conn-filter"
              data-testid="connections-filter"
              placeholder="Filter by name, title, company or email"
              ref={filterRef}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPageIndex(0);
              }}
            />
            <label className="sr-only" htmlFor="conn-sort">
              Sort connections
            </label>
            <select
              className="input conn-sort"
              id="conn-sort"
              data-testid="connections-sort"
              value={sortMode}
              disabled={loading}
              onChange={(e) => sort(e.target.value as SortMode)}
            >
              {sorts.map(([value, label]) => (
                <option key={value} value={value} disabled={value === 'common' && graphStatus !== 'in'}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="metabar" hidden={!rows.length}>
            <span>
              {filtered.length.toLocaleString()} shown · {rows.length.toLocaleString()} saved
            </span>
            <span>
              {sortMode === 'warmest'
                ? 'Warmest first: messages, shared employers and relationship facts.'
                : sortMode === 'common'
                  ? 'Most in common: sharing members who also know them.'
                  : ''}
            </span>
          </div>
          <div hidden={!rows.length} className="connection-sharing" data-testid="common-status">
            {graphStatus === 'loading'
              ? 'Checking sharing status…'
              : graphStatus === 'error'
                ? 'Common connections are unavailable right now. Try Refresh.'
                : graphStatus === 'out'
                  ? 'Common connections: not sharing.'
                  : `Sharing ${common?.myNodeCount.toLocaleString() || 0} connections; ${common?.members.length || 0} members share people with you.`}
            <Link to="/network">{graphStatus === 'in' ? 'Open Network' : 'Manage sharing'}</Link>
          </div>
        </div>
        {error && (
          <p className="note bad" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <p className="zero" role="status">
            Loading connections…
          </p>
        ) : !rows.length ? (
          <div className="zero">
            <h3>No connections yet</h3>
            <p>Import your LinkedIn export to see your connections here.</p>
            <button
              className="btn primary"
              onClick={() => navigate('/recommender', { state: { importConnections: true } })}
            >
              Import your LinkedIn export
            </button>
          </div>
        ) : !page.length ? (
          <div className="zero">
            <h3>No one matches “{filter}”</h3>
            <p>The filter checks names, titles, companies and emails.</p>
            <button
              className="btn"
              onClick={() => {
                setFilter('');
                filterRef.current?.focus();
              }}
            >
              Clear filter
            </button>
          </div>
        ) : (
          <>
            <div
              ref={tableRef}
              className="tbl-wrap"
              tabIndex={0}
              aria-label="Connections table, scrolls sideways"
            >
              <table className="tbl fixed" data-testid="connections-table">
                <caption className="sr-only">Your saved connections</caption>
                <colgroup>
                  <col style={{ width: 144 }} />
                  <col />
                  <col style={{ width: 160 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 88 }} />
                </colgroup>
                <thead>
                  <tr>
                    {sortHeader('name', 'Name')}
                    <th scope="col">Title</th>
                    <th scope="col">Company</th>
                    {sortHeader('messages', 'Messages', true)}
                    {sortHeader('last', 'Last contact')}
                    {sortHeader('common', 'In common', true)}
                  </tr>
                </thead>
                <tbody>
                  {page.map((r, i) => (
                    <tr
                      key={rowId(r) + i}
                      className={r === selected ? 'is-sel' : ''}
                      onClick={() => select(r)}
                    >
                      <td>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            select(r);
                          }}
                          title={displayName(r) || '(no name)'}
                          aria-current={r === selected ? 'true' : undefined}
                        >
                          {displayName(r) || '(no name)'}
                        </button>
                      </td>
                      <td className="t-wrap" title={r.position || ''}>
                        <span>{r.position || <span className="muted">—</span>}</span>
                      </td>
                      <td title={r.company || ''}>{r.company || <span className="muted">—</span>}</td>
                      <td className="num">{r.messageCount ?? <span className="muted">—</span>}</td>
                      <td className={!r.lastMessagedAt ? 'muted' : undefined}>
                        {dateLabel(r.lastMessagedAt, true)}
                      </td>
                      <td className="num">
                        {graphStatus === 'in' ? inCommonCount(r) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="conn-cards rows" aria-label="Connections">
              {page.map((r, i) => (
                <li key={rowId(r) + i} className={`row ${r === selected ? 'is-sel' : ''}`}>
                  <button className="row-main" onClick={() => select(r)}>
                    <span className="row-b">
                      <span className="nm">{displayName(r) || '(no name)'}</span>
                      <span className="tc">
                        {[r.position || 'No title', r.company].filter(Boolean).join(' · ')}
                      </span>
                      <span className="why muted">
                        {r.messageCount == null
                          ? 'No message data'
                          : `${r.messageCount} ${r.messageCount === 1 ? 'message' : 'messages'}`}
                        {r.lastMessagedAt ? ` · last ${dateLabel(r.lastMessagedAt, true)}` : ''}
                        {graphStatus === 'in' ? ` · ${inCommonCount(r)} in common` : ''}
                      </span>
                    </span>
                    <Icon name="chev" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!!rows.length && (
          <div className="pagination">
            <label htmlFor="page-size" className="hint">
              Rows per page
            </label>
            <select
              className="input"
              id="page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPageIndex(0);
              }}
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="hint">
              {safePageIndex + 1} of {totalPages}
            </span>
            <button
              className="btn sm"
              disabled={loading || safePageIndex === 0}
              onClick={() => goPage(Math.max(0, safePageIndex - 1))}
            >
              Previous
            </button>
            <button
              className="btn sm"
              disabled={loading || safePageIndex >= totalPages - 1}
              onClick={() => goPage(Math.min(totalPages - 1, safePageIndex + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
      {(!!rows.length || detailRoute.value != null) && (
        <DetailPane open={!!detailRoute.value} onClose={detailRoute.close} label="Connection details">
          {selected ? (
            <>
              <PersonHeading person={selected} />
              <div className="d-actions">
                <button
                  className="btn"
                  data-testid="star"
                  aria-pressed={favoriteIds.has(favoriteKey)}
                  disabled={!favoriteKey || favoriteBusy}
                  onClick={() =>
                    void setSavedPerson(favoriteKey, docToRow(selected), !favoriteIds.has(favoriteKey))
                  }
                >
                  <Icon name="star" />
                  {favoriteIds.has(favoriteKey) ? 'Saved' : 'Save'}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    navigate('/recommender', {
                      state: {
                        runSearch: {
                          criteria: selected.position || selected.company || displayName(selected),
                          strictTitleOnly: false,
                        },
                      },
                    })
                  }
                >
                  <Icon name="search" />
                  Find people like this
                </button>
              </div>
              {rel?.reasons.length > 0 && (
                <section className="d-sec">
                  <h3>Relationship</h3>
                  <ul className="sig">
                    {rel.reasons
                      .flatMap((reason) => relationshipFacts(reason))
                      .map((reason) => (
                        <li key={reason}>
                          <Icon name="check" />
                          <span>{reason}</span>
                        </li>
                      ))}
                  </ul>
                </section>
              )}
              <PersonFacts person={selected} />
              {graphStatus === 'in' && (
                <section className="d-sec">
                  <h3>Members who also know {displayName(selected).split(' ')[0]}</h3>
                  <p>{memberNames.length ? memberNames.join(', ') : 'No other sharing members found.'}</p>
                  {selectedKey && memberNames.length > 0 && (
                    <Link
                      className="btn sm network-link"
                      to={`/network?node=${encodeURIComponent('p:' + selectedKey)}`}
                    >
                      Show in Network
                    </Link>
                  )}
                </section>
              )}
            </>
          ) : (
            <div className="empty-pane">
              <p>
                {detailRoute.value != null
                  ? 'This person is not in your saved connections.'
                  : 'Pick a person to see details.'}
              </p>
            </div>
          )}
        </DetailPane>
      )}
    </section>
  );
};
export default ConnectionsScreen;
