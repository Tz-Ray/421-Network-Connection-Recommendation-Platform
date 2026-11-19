import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/AuthContext';
import {
  loadConnections,
  loadNetworkContext,
  docToRow,
  type NetworkContext,
  type ConnectionDoc,
} from '../lib/connectionsStore';
import { relationshipSignals } from '../lib/relationship';
import { dateLabel, docIdParts, initials, personIds, plainRelationship } from '../lib/presentation';
import { ImportSteps } from '../components/ImportSteps';
import '../styles/dashboard.css';

const TOP_COMPANIES = 10;
const RECENT_COUNT = 5;

function displayName(d: ConnectionDoc): string {
  const name = d.fullName || `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim();
  return name || '(no name)';
}

/** Days between an ISO 'YYYY-MM-DD' date and `now` (ms), or null if unparsable. */
function daysSince(iso: string, now: number): number | null {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.floor((now - ts) / 86_400_000);
}

const DashboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [networkContext, setNetworkContext] = useState<NetworkContext | null>(null);
  const [docs, setDocs] = useState<ConnectionDoc[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
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
        const [rows, context] = await Promise.all([
          loadConnections(uid),
          loadNetworkContext(uid).catch(() => null),
        ]);
        setDocs(rows);
        setNetworkContext(context);
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
    const withTitle = total - missingTitles;
    const pctWithTitle = total ? (Math.floor((withTitle / total) * 1000) / 10).toLocaleString() : '0';

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

    // Message data is only present on docs enriched from a LinkedIn export
    // zip; older CSV/JSON imports leave messageCount null on every doc.
    const hasMessageData = docs.some((d) => d.messageCount != null);
    const now = Date.now();
    const messagedLast12Months = docs.filter((d) => {
      if (!d.lastMessagedAt) return false;
      const days = daysSince(d.lastMessagedAt, now);
      return days != null && days >= 0 && days <= 365;
    }).length;

    return {
      total,
      missingTitles,
      withTitle,
      pctWithTitle,
      companyCount: counts.size,
      topCompanies,
      recent,
      hasMessageData,
      messagedLast12Months,
    };
  }, [docs]);

  const catchups = useMemo(
    () =>
      docs
        .filter((d) => d.lastMessagedAt && (daysSince(d.lastMessagedAt, Date.now()) ?? 0) > 180)
        .map((doc) => ({ doc, rel: relationshipSignals(docToRow(doc), networkContext, new Date()) }))
        .sort((a, b) => b.rel.bonus - a.rel.bonus)
        .slice(0, 5),
    [docs, networkContext],
  );
  const ids = useMemo(() => new Map(personIds(docs, docIdParts).map((id, i) => [docs[i], id])), [docs]);
  const open = (d: ConnectionDoc) => navigate(`/connections?person=${encodeURIComponent(ids.get(d)!)}`);
  return (
    <section id="v-dashboard" className="view on">
      <div className="page">
        <div className="page-h">
          <div>
            <h2>
              {summary.total
                ? 'Your network'
                : `Welcome${user?.displayName?.trim() ? ', ' + user.displayName.trim().split(/\s+/)[0] : ''}`}
            </h2>
            <p>
              {summary.total
                ? 'People you know, from your saved LinkedIn export.'
                : 'Start with the people you already know.'}
            </p>
          </div>
          {summary.total > 0 && (
            <div className="act">
              <button
                className="btn primary"
                onClick={() => navigate('/recommender', { state: { focusSearch: true } })}
              >
                <Icon name="search" />
                Find someone
              </button>
              <button
                className="btn"
                onClick={() => navigate('/recommender', { state: { importConnections: true } })}
              >
                <Icon name="upload" />
                Import
              </button>
            </div>
          )}
        </div>
        {loading ? (
          <p role="status">Loading your network…</p>
        ) : loadError ? (
          <p className="note bad" role="alert">
            {loadError}
          </p>
        ) : !summary.total ? (
          <div className="panel">
            <div className="zero">
              <h3>Start by adding your LinkedIn export</h3>
              <p>
                Once your connections are in, this page shows how many you have, where they work and who you
                added recently.
              </p>
              <ImportSteps home />
              <div className="acts">
                <button
                  className="btn primary"
                  onClick={() => navigate('/recommender', { state: { importConnections: true } })}
                >
                  <Icon name="upload" />
                  Import your LinkedIn export
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className={`kpis ${summary.hasMessageData ? '' : 'three'}`}>
              <StatCard
                title="Connections saved"
                value={summary.total.toLocaleString()}
                subtext={`${summary.recent.filter((d) => d.connectedOn || d.connectedOnRaw).length} recent connections below`}
              />
              <StatCard
                title="With a job title"
                value={`${summary.pctWithTitle}%`}
                subtext={`${summary.withTitle.toLocaleString()} with titles · ${summary.missingTitles.toLocaleString()} missing`}
              />
              <StatCard
                title="Companies"
                value={summary.companyCount.toLocaleString()}
                subtext={
                  summary.topCompanies[0]
                    ? `Top: ${summary.topCompanies[0].name}, ${summary.topCompanies[0].count} people`
                    : 'No company names in this export'
                }
              />
              {summary.hasMessageData && (
                <StatCard
                  title="Messaged in the last 12 months"
                  value={summary.messagedLast12Months.toLocaleString()}
                  subtext={`${Math.round((summary.messagedLast12Months / summary.total) * 100)}% of your network · from this export`}
                />
              )}
            </div>
            <div className="dash-grid">
              <section className="panel" aria-labelledby="companies-title">
                <div className="panel-h">
                  <h3 id="companies-title">Top 10 companies</h3>
                  <span className="r muted">People</span>
                </div>
                <div className="panel-b">
                  <ol className="bars">
                    {summary.topCompanies.map((c) => (
                      <li key={c.name}>
                        <span className="lab" title={c.name}>
                          {c.name}
                        </span>
                        <span className="trk" aria-hidden="true">
                          <span
                            className="bar"
                            style={{
                              width: `${(c.count / Math.max(1, summary.topCompanies[0].count)) * 100}%`,
                              display: 'block',
                            }}
                          />
                        </span>
                        <span className="val">{c.count}</span>
                      </li>
                    ))}
                  </ol>
                  {!summary.topCompanies.length && <p className="muted">No company names in this export.</p>}
                </div>
              </section>
              <section className="panel" aria-labelledby="recent-title">
                <div className="panel-h">
                  <h3 id="recent-title">Recently connected</h3>
                  <button className="linkbtn r" onClick={() => navigate('/connections')}>
                    All connections
                  </button>
                </div>
                <ul className="list-s">
                  {summary.recent.map((d, i) => (
                    <li key={i}>
                      <button
                        className="recent-person"
                        onClick={() => open(d)}
                        aria-label={`Open ${displayName(d)}`}
                      >
                        <span className="avatar" aria-hidden="true">
                          {initials(displayName(d))}
                        </span>
                        <span className="t">
                          <b className="person-link">{displayName(d)}</b>
                          <span>
                            {[d.position, d.company].filter(Boolean).join(' · ') || 'No title or company'}
                          </span>
                        </span>
                        <span className="mono muted">{dateLabel(d.connectedOn || d.connectedOnRaw)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              {summary.hasMessageData && (
                <section className="panel wide" aria-labelledby="catchup-title">
                  <div className="panel-h">
                    <h3 id="catchup-title">Worth a catch-up</h3>
                    <span className="r muted">No message in over 180 days</span>
                  </div>
                  {catchups.length ? (
                    <ul className="catchup">
                      {catchups.map(({ doc: d, rel }, i) => (
                        <li key={i}>
                          <b>{displayName(d)}</b>
                          <span className="tc">{[d.position, d.company].filter(Boolean).join(' · ')}</span>
                          {rel.chips[0] && <span className="chip">{rel.chips[0]}</span>}
                          <span className="catchup-reason">
                            {plainRelationship(rel.reasons[0] || '', rel.chips[0]) ||
                              plainRelationship(rel.reasons[0] || '')}
                          </span>
                          <button
                            className="btn sm"
                            onClick={() => open(d)}
                            aria-label={`Open ${displayName(d)}`}
                          >
                            Open
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="panel-b muted">No older conversations to catch up on.</p>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
const StatCard = ({ title, value, subtext }: { title: string; value: string; subtext: string }) => (
  <div className="panel kpi">
    <div className="k">{title}</div>
    <div className="v">{value}</div>
    <div className="s">{subtext}</div>
  </div>
);
export default DashboardScreen;
