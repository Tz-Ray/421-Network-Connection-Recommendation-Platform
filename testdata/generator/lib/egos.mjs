// The 20 datasets: owners, the owner meta-graph, ego-network sampling, the
// deliberate name edge cases, and each dataset's Connections rows.

import { Rng } from './rng.mjs';
import { dn, normalizePersonName } from './text.mjs';
import {
  COMMUNITIES, activePosition, connectedOnFor, finalizeTags, latestOverlap, makeSlug,
  emailFor, sharesSchool, snapshot,
} from './universe.mjs';

// Orchestrator's dataset table. `opts` carries the per-file edge cases.
export const DATASETS = [
  { id: 'N01', format: 'full', k: 0, n: 1450, exportDate: '2026-09-28', opts: { draftColumn: true, spam: true, follows: 215 } },
  { id: 'N02', format: 'full', k: 1, n: 820, exportDate: '2026-08-14', opts: { nested: true, spam: true } },
  { id: 'N03', format: 'full', k: 2, n: 610, exportDate: '2026-03-02', opts: { spam: true, spamFromConnection: true } },
  { id: 'N04', format: 'full', k: 3, n: 390, exportDate: '2025-11-19', opts: { ownerUrlAbsent: true } },
  { id: 'N05', format: 'full', k: 4, n: 260, exportDate: '2026-06-30', opts: { noMessages: true } },
  { id: 'N06', format: 'full', k: 5, n: 540, exportDate: '2025-09-08', opts: {} },
  { id: 'N07', format: 'full', k: 6, n: 175, exportDate: '2026-01-22', opts: { skills: 56 } },
  { id: 'N08', format: 'full', k: 7, n: 95, exportDate: '2025-05-12', opts: { basic: true } },
  { id: 'N09', format: 'full', k: 8, n: 330, exportDate: '2026-04-17', opts: {} },
  { id: 'N10', format: 'full', k: 9, n: 1050, exportDate: '2025-07-25', opts: { spam: true } },
  { id: 'C01', format: 'classic', k: 0, n: 900, exportDate: '2026-05-05', opts: {} },
  { id: 'C02', format: 'classic', k: 1, n: 420, exportDate: '2026-09-20', opts: {} },
  { id: 'C03', format: 'classic', k: 2, n: 300, exportDate: '2025-10-06', opts: { bom: true } },
  { id: 'C04', format: 'classic', k: 3, n: 210, exportDate: '2026-07-11', opts: {} },
  { id: 'C05', format: 'classic', k: 4, n: 150, exportDate: '2025-12-15', opts: {} },
  { id: 'C06', format: 'classic', k: 5, n: 120, exportDate: '2026-02-09', opts: {} },
  { id: 'C07', format: 'classic', k: 6, n: 640, exportDate: '2025-08-27', opts: {} },
  { id: 'C08', format: 'classic-legacy', k: 7, n: 75, exportDate: '2025-06-20', opts: { legacy: true, dateStyle: 'mdy' } },
  { id: 'C09', format: 'classic-legacy', k: 8, n: 480, exportDate: '2025-05-28', opts: { legacy: true } },
  { id: 'C10', format: 'classic', k: 9, n: 250, exportDate: '2026-09-01', opts: {} },
];

// Owner meta-graph (undirected). N_k-C_k always; an N ring; cross links.
export const OWNER_LINKS = [
  ['N01', 'C01'], ['N02', 'C02'], ['N03', 'C03'], ['N04', 'C04'], ['N05', 'C05'],
  ['N06', 'C06'], ['N07', 'C07'], ['N08', 'C08'], ['N09', 'C09'], ['N10', 'C10'],
  ['N01', 'N02'], ['N02', 'N03'], ['N03', 'N04'], ['N04', 'N05'], ['N05', 'N06'],
  ['N06', 'N07'], ['N07', 'N08'], ['N08', 'N09'], ['N09', 'N10'], ['N10', 'N01'],
  ['C01', 'C07'], ['C01', 'C08'], ['C02', 'C10'], ['C02', 'N01'], ['C03', 'C05'],
  ['C03', 'C06'], ['C03', 'N03'], ['C04', 'C07'], ['C05', 'C09'], ['C06', 'N07'],
  ['C08', 'N03'], ['C09', 'N05'], ['C10', 'N06'],
].filter((l, i, a) => a.findIndex((x) => (x[0] === l[0] && x[1] === l[1]) || (x[0] === l[1] && x[1] === l[0])) === i);

// Mutual-connection share of the smaller set, per community pair (N_k, C_k).
export const MUTUAL_FRACTION = [0.38, 0.33, 0.30, 0.36, 0.40, 0.42, 0.35, 0.28, 0.31, 0.37];
const HOME_FRACTION = 0.70;

export function peopleTargets() {
  const home = {};
  const second = {};
  COMMUNITIES.forEach((k, i) => {
    const N = DATASETS.find((d) => d.k === i && d.format === 'full').n;
    const C = DATASETS.find((d) => d.k === i && d.format !== 'full').n;
    const m = MUTUAL_FRACTION[i] * Math.min(N, C);
    const need = HOME_FRACTION * (N + C) - 0.9 * m;
    const T = Math.ceil(need + 0.06 * Math.min(N, C));
    home[k] = Math.round(T * 0.8);
    second[k] = T - home[k];
  });
  return { home, second };
}

const SPECIAL_NAMES = [
  ['Katherine "Kate"', "O'Donnell"],
  ['Seán', 'Ó Briain'],
  ['María José', 'de la Cruz Ortega'],
  ['Jean-François', 'Bélanger'],
  ['Zoë', 'van der Berg'],
  ["D'Andre", 'St. Clair'],
  ['Siobhán', 'Mac Giolla Phádraig'],
  ['Anne-Sophie', 'Dubois-Lefèvre'],
  ['Øystein', 'Kjærgaard'],
  ['Łukasz', 'Wiśniewski'],
  ['Chiamaka', 'Nwachukwu-Eze'],
  ['Robert "Bobby"', 'McAllister, Jr.'],
  ['Sarah', 'Lindqvist, CPA'],
  ['Michael', 'Okonjo, MBA'],
  ['Renée', "L'Heureux"],
  ['José Luis', 'Núñez'],
  ['美玲', '陈'],
];

export function buildDatasets(W, pools, people, usedNames, usedSlugs, seed) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const rng = new Rng(seed, 'owners');
  const ds = DATASETS.map((d) => ({ ...d, community: COMMUNITIES[d.k], exportDay: dn(d.exportDate) }));
  const dsById = new Map(ds.map((d) => [d.id, d]));

  // ---- owners ----
  const ownerIds = new Set();
  for (const d of ds) {
    const cands = people.filter((p) =>
      p.home === d.community && !ownerIds.has(p.id) && p.yrs >= 6 && p.yrs <= 24 &&
      p.positions.length >= 2 && !p.flags.hideCurrent && !p.flags.blankTitle && !p.flags.blankCompany && !p.flags.messy &&
      activePosition(p, d.exportDay) && !activePosition(p, d.exportDay).generic &&
      W.byId.get(activePosition(p, d.exportDay).companyId).communities.includes(d.community) &&
      !/[,"]/.test(p.fullName));
    const o = rng.pick(cands);
    ownerIds.add(o.id);
    d.owner = o;
    o.ownerOf = d.id;
    if (!o.second) o.second = rng.pick(neighborsOf(d.community));
    // owners list more skills than an average member
    const want = d.opts.skills || rng.int(15, 40);
    const extra = [];
    const ownInd = W.fnById.get(o.functionId).industryIds;
    const related = W.world.functions.filter((f) => f.id !== o.functionId && f.industryIds.some((i) => ownInd.includes(i))).map((f) => f.id);
    const fns = [o.functionId, ...related, ...W.world.functions.map((f) => f.id).filter((f) => f !== o.functionId && !related.includes(f))];
    for (const f of fns) for (const s of pools.skills[f]) if (!extra.some((x) => x.toLowerCase() === s.toLowerCase())) extra.push(s);
    const merged = [...o.skills];
    const ownPool = extra.filter((s) => pools.skills[o.functionId].includes(s));
    for (const s of [...rng.shuffle(ownPool), ...rng.shuffle(extra.slice(ownPool.length, 60))]) {
      if (merged.length >= want) break;
      if (!merged.some((x) => x.toLowerCase() === s.toLowerCase())) merged.push(s);
    }
    o.skills = merged;
  }

  // ---- owner links (same Connected On in both files) ----
  const linkRng = new Rng(seed, 'owner-links');
  const links = OWNER_LINKS.map(([a, b]) => {
    const da = dsById.get(a);
    const db = dsById.get(b);
    const upTo = Math.min(da.exportDay, db.exportDay);
    return { a, b, connectedOn: connectedOnFor(linkRng, da.owner, db.owner, upTo - 20) };
  });

  // ---- ego sampling ----
  const nonOwners = people.filter((p) => !ownerIds.has(p.id));
  const members = (k) => nonOwners.filter((p) => p.home === k || p.second === k);
  const egoRng = new Rng(seed, 'egos');
  const sets = new Map(); // datasetId -> Set(personId)
  for (let k = 0; k < COMMUNITIES.length; k++) {
    const pair = ds.filter((d) => d.k === k).sort((x, y) => y.n - x.n); // larger first
    const [L, S] = pair;
    for (const d of pair) {
      const partner = d === L ? null : L;
      const O = d.owner;
      const forced = links.filter((l) => l.a === d.id || l.b === d.id).map((l) => dsById.get(l.a === d.id ? l.b : l.a).owner);
      const chosen = new Set(forced.map((p) => p.id));
      const avoid = new Set();
      let quotaHome;
      let quotaSecond;
      const r = d.n - forced.length;
      const hFrac = partner ? egoRng.uniform(0.68, 0.74) : egoRng.uniform(0.66, 0.70); // the larger set must leave home-pool room
      const sFrac = egoRng.uniform(0.12, 0.18);
      quotaHome = Math.round(r * hFrac);
      quotaSecond = Math.round(r * sFrac);
      const homeSet = new Set(members(d.community).map((p) => p.id));
      const secondPool = nonOwners.filter((p) => p.home === O.second || p.second === O.second || sharesSchool(O, p));
      const secondSet = new Set(secondPool.map((p) => p.id));
      if (partner) {
        const lSet = sets.get(partner.id);
        for (const id of lSet) avoid.add(id);
        const m = Math.round(MUTUAL_FRACTION[k] * d.n);
        const lPeople = [...lSet].map((id) => byId.get(id)).filter((p) => !ownerIds.has(p.id));
        const mutual = egoRng.sampleWeighted(lPeople, m, (p) => p.sociability * (homeSet.has(p.id) ? 6 : 1));
        for (const p of mutual) {
          chosen.add(p.id);
          if (homeSet.has(p.id)) quotaHome -= 1;
          else if (secondSet.has(p.id)) quotaSecond -= 1;
        }
      }
      const free = (p) => !chosen.has(p.id) && !avoid.has(p.id) && p.id !== O.id;
      const colleague = new Map();
      const homePool = members(d.community).filter(free);
      for (const p of homePool) colleague.set(p.id, latestOverlap(O, p, d.exportDay));
      const home = egoRng.sampleWeighted(homePool, Math.max(0, quotaHome), (p) =>
        p.sociability * (colleague.get(p.id) ? 5 : 1) * (sharesSchool(O, p) ? 2 : 1) * (p.functionId === O.functionId ? 1.4 : 1) * (p.home === d.community ? 1.3 : 1));
      for (const p of home) chosen.add(p.id);
      const outside = (p) => free(p) && !homeSet.has(p.id); // tiers 2-3 never drain the home pool
      const second = egoRng.sampleWeighted(secondPool.filter(outside), Math.max(0, quotaSecond), (p) =>
        p.sociability * (sharesSchool(O, p) ? 2 : 1) * (latestOverlap(O, p, d.exportDay) ? 3 : 1));
      for (const p of second) chosen.add(p.id);
      const weakNeed = d.n - chosen.size;
      let weak = egoRng.sampleWeighted(nonOwners.filter(outside), weakNeed, (p) => p.sociability);
      if (weak.length < weakNeed) weak = [...weak, ...egoRng.sampleWeighted(nonOwners.filter((p) => free(p) && !weak.includes(p)), weakNeed - weak.length, (p) => p.sociability)];
      for (const p of weak) chosen.add(p.id);
      if (chosen.size !== d.n) throw new Error(`${d.id}: sampled ${chosen.size} != ${d.n}`);
      sets.set(d.id, chosen);
    }
  }

  // ---- deliberate name edge cases ----
  const appearances = new Map();
  for (const d of ds) for (const id of sets.get(d.id)) {
    if (!appearances.has(id)) appearances.set(id, []);
    appearances.get(id).push(d.id);
  }
  const nameRng = new Rng(seed, 'name-edge-cases');
  const renamed = new Set();
  const only = (dsId) => [...sets.get(dsId)].filter((id) => !ownerIds.has(id) && !renamed.has(id) && appearances.get(id).length === 1 && !byId.get(id).flags.messy).sort();
  const rename = (p, first, last) => {
    usedNames.add(normalizePersonName(`${first} ${last}`));
    p.first = first;
    p.last = last;
    const s = makeSlug(nameRng, first, last, usedSlugs, true);
    p.slug = s.slug;
    p.slugDisplay = s.display;
    p.vanity = false;
    if (p.email) p.email = emailFor(nameRng, first, last);
    finalizeTags(W, p);
    renamed.add(p.id);
  };
  const edge = { duplicateNamesWithin: {}, sameNameAcrossDatasets: [], specialNames: [] };
  for (const d of ds) {
    const want = d.n >= 300 ? 3 : 2;
    const pool = nameRng.shuffle(only(d.id));
    edge.duplicateNamesWithin[d.id] = [];
    for (let i = 0; i < want && pool.length >= 2; i++) {
      const a = byId.get(pool.shift());
      const b = byId.get(pool.shift());
      rename(b, a.first, a.last);
      renamed.add(a.id);
      edge.duplicateNamesWithin[d.id].push({ name: a.fullName, personIds: [a.id, b.id] });
    }
  }
  const crossPairs = [['N03', 'C05'], ['N01', 'N10'], ['C02', 'N06'], ['N09', 'C07'], ['C04', 'N02'], ['N08', 'C10'], ['N04', 'C09']];
  for (const [d1, d2] of crossPairs) {
    const a = byId.get(nameRng.pick(only(d1)));
    renamed.add(a.id);
    const b = byId.get(nameRng.pick(only(d2)));
    rename(b, a.first, a.last);
    edge.sameNameAcrossDatasets.push({ name: a.fullName, a: { datasetId: d1, personId: a.id }, b: { datasetId: d2, personId: b.id } });
  }
  const specialTargets = ['N01', 'N02', 'N03', 'N04', 'N06', 'N07', 'N08', 'N09', 'N10', 'C01', 'C03', 'C08', 'C09', 'N05', 'C07', 'N01', 'C04'];
  SPECIAL_NAMES.forEach(([first, last], i) => {
    const dsId = specialTargets[i % specialTargets.length];
    const p = byId.get(nameRng.pick(only(dsId)));
    rename(p, first, last);
    if (/[^\x00-\x7f]/.test(first) && !/[a-z]/i.test(first)) {
      // non-Latin names get LinkedIn's percent-encoded unicode slug
      const raw = `${first}-${last}-${nameRng.hex(6)}`;
      p.slug = raw.toLowerCase();
      p.slugDisplay = encodeURIComponent(raw);
      usedSlugs.add(p.slug);
      finalizeTags(W, p);
      p.urlLower = p.url;
    }
    // legacy-header files (C08, C09) have no URL column: only the name aspect is exercised there
    const legacy = !!(ds.find((d) => d.id === dsId)?.opts?.legacy);
    edge.specialNames.push({ datasetId: dsId, personId: p.id, name: p.fullName, url: p.url, urlInFile: !legacy });
  });

  // ---- rows (job snapshot at each export date) ----
  const rowRng = new Rng(seed, 'connected-on');
  for (const d of ds) {
    const O = d.owner;
    const rows = [];
    for (const id of [...sets.get(d.id)].sort()) {
      const p = byId.get(id);
      const link = links.find((l) => (l.a === d.id || l.b === d.id) && dsById.get(l.a === d.id ? l.b : l.a).owner.id === id);
      const connectedOn = link ? link.connectedOn : connectedOnFor(rowRng, O, p, d.exportDay);
      rows.push({ person: p, connectedOn, ...snapshot(p, d.exportDay) });
    }
    rows.sort((x, y) => (y.connectedOn - x.connectedOn) || (x.person.id < y.person.id ? -1 : 1));
    d.rows = rows;
  }
  return { datasets: ds, links, ownerIds, sets, edge };
}

const NEIGH = {
  SEA_TECH: 'SF_FINTECH', SF_FINTECH: 'SEA_TECH', NYC_FINANCE: 'BOS_HEALTH', BOS_HEALTH: 'NYC_FINANCE',
  CHI_CONSULT: 'NYC_FINANCE', LDN_RETAIL: 'NYC_FINANCE', TOR_ACADEMIA: 'BOS_HEALTH', DC_POLICY: 'NYC_FINANCE',
  HOU_ENERGY: 'CHI_CONSULT', LA_MEDIA: 'SF_FINTECH',
};
function neighborsOf(k) {
  return [NEIGH[k]];
}
