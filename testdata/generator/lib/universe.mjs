// Universe: fictional people with dated careers, the 20 owners, the owner
// meta-graph, and every ego network (who is connected to whom, and when).

import { Rng } from './rng.mjs';
import { FAMOUS_NAMES } from './famous.mjs';
import { asciiSlug, dn, iso, monthStart, normalizePersonName, ymdOf } from './text.mjs';

export const COMMUNITIES = [
  'SEA_TECH', 'SF_FINTECH', 'NYC_FINANCE', 'BOS_HEALTH', 'CHI_CONSULT',
  'LDN_RETAIL', 'TOR_ACADEMIA', 'DC_POLICY', 'HOU_ENERGY', 'LA_MEDIA',
];

// Communities whose people most often also belong to community k.
const NEIGHBORS = {
  SEA_TECH: ['SF_FINTECH', 'LA_MEDIA', 'TOR_ACADEMIA'],
  SF_FINTECH: ['SEA_TECH', 'LA_MEDIA', 'NYC_FINANCE'],
  NYC_FINANCE: ['BOS_HEALTH', 'DC_POLICY', 'LDN_RETAIL', 'CHI_CONSULT', 'SF_FINTECH'],
  BOS_HEALTH: ['NYC_FINANCE', 'TOR_ACADEMIA', 'DC_POLICY'],
  CHI_CONSULT: ['NYC_FINANCE', 'HOU_ENERGY', 'DC_POLICY'],
  LDN_RETAIL: ['NYC_FINANCE', 'TOR_ACADEMIA', 'CHI_CONSULT'],
  TOR_ACADEMIA: ['BOS_HEALTH', 'NYC_FINANCE', 'LDN_RETAIL'],
  DC_POLICY: ['NYC_FINANCE', 'BOS_HEALTH', 'HOU_ENERGY'],
  HOU_ENERGY: ['CHI_CONSULT', 'DC_POLICY', 'LA_MEDIA'],
  LA_MEDIA: ['SF_FINTECH', 'NYC_FINANCE', 'SEA_TECH'],
};

export const SENIORITIES = ['intern', 'entry', 'mid', 'senior', 'lead', 'manager', 'director', 'vp', 'cxo', 'founder'];
const RANK = { intern: 0, entry: 1, mid: 2, senior: 3, lead: 4, manager: 4, director: 5, vp: 6, cxo: 7, founder: 6 };
const IC_PATH = ['entry', 'mid', 'senior', 'lead'];
const MGR_PATH = ['entry', 'mid', 'senior', 'manager', 'director', 'vp', 'cxo'];

export const BASELINE = dn('2025-04-01'); // every pre-change career is frozen here
const LATE_CHANGE_FROM = dn('2025-06-01');
const LATE_CHANGE_TO = dn('2026-09-01');
const FLOOR_CONNECTED = dn('2008-01-01');
const SIZE_W = { large: 3, mid: 2, small: 1 };

const DEGREES = {
  default: ['Bachelor of Science - BS', 'Bachelor of Arts - BA', "Bachelor's degree"],
  masters: ['Master of Science - MS', 'Master of Business Administration - MBA', 'Master of Arts - MA', "Master's degree"],
  phd: ['Doctor of Philosophy - PhD'],
  md: ['Doctor of Medicine - MD'],
  jd: ['Juris Doctor - JD'],
  mpp: ['Master of Public Policy - MPP', 'Master of Public Administration - MPA'],
};

export function buildWorld(world) {
  const companies = world.companies;
  const byId = new Map(companies.map((c) => [c.id, c]));
  const fnById = new Map(world.functions.map((f) => [f.id, f]));
  const commById = new Map(world.communities.map((c) => [c.id, c]));
  const schoolById = new Map(world.schools.map((s) => [s.id, s]));
  const industryById = new Map(world.industries.map((i) => [i.id, i]));
  const realByComm = new Map(COMMUNITIES.map((k) => [k, companies.filter((c) => !c.generic && c.communities.includes(k))]));
  const generic = companies.filter((c) => c.generic);
  return { world, companies, byId, fnById, commById, schoolById, industryById, realByComm, generic };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function seniorityForYears(rng, yrs) {
  if (yrs < 0) return 'intern';
  if (yrs >= 5 && rng.chance(0.035)) return 'founder';
  const table =
    yrs <= 1 ? { entry: 1 } :
    yrs <= 4 ? { entry: 0.3, mid: 0.7 } :
    yrs <= 8 ? { mid: 0.25, senior: 0.75 } :
    yrs <= 12 ? { senior: 0.15, lead: 0.45, manager: 0.4 } :
    yrs <= 18 ? { lead: 0.2, manager: 0.35, director: 0.45 } :
    yrs <= 25 ? { manager: 0.15, director: 0.45, vp: 0.4 } :
    { director: 0.35, vp: 0.4, cxo: 0.25 };
  return rng.weightedKey(table);
}

function seniorityPath(final, n) {
  // n seniorities, non-decreasing, ending at `final`.
  if (final === 'intern') return Array(n).fill('intern');
  const path = final === 'founder' ? ['entry', 'mid', 'senior', 'founder'] : IC_PATH.includes(final) ? IC_PATH : MGR_PATH;
  const endIdx = path.indexOf(final);
  const out = [];
  for (let i = 0; i < n; i++) out.push(path[Math.round((endIdx * (i + 1)) / n)]);
  out[n - 1] = final;
  return out;
}

// `avoid` (optional Set of titles) steers the pick away from titles the person already held earlier in their
// career, so a title never resurfaces after a different one (A -> B -> A reads as a demotion). It filters the
// pool without changing how many random draws are made; when every title is excluded the full pool is used.
export function titleFor(W, rng, fnId, sen, comm, avoid) {
  const fn = W.fnById.get(fnId);
  const keep = (list) => {
    if (!avoid || !avoid.size) return list;
    const f = list.filter((t) => !avoid.has(t));
    return f.length ? f : list;
  };
  if (comm === 'LDN_RETAIL' && fn.ukTitles && fn.ukTitles[sen] && rng.chance(0.6)) return rng.pick(keep(fn.ukTitles[sen]));
  const list = fn.titles[sen] && fn.titles[sen].length ? fn.titles[sen] : fn.titles.mid;
  return rng.pick(keep(list));
}

// Titles held before the immediately preceding position (keeping the previous title on a lateral move is fine).
const earlierTitles = (positions) => new Set(positions.slice(0, -1).map((p) => p.title));

function companyWeight(W, c, fnId) {
  const fn = W.fnById.get(fnId);
  const fw = (c.functionWeights && c.functionWeights[fnId]) || 0;
  const ind = fn.industryIds.includes(c.industryId) ? 0.05 : 0;
  return (fw + ind + 0.004) * SIZE_W[c.size || 'mid'];
}

// Functions that only exist inside their own industries (a physician works at a hospital, a professor at a
// university). For these, a company outside the function's industryIds (and without an explicit
// functionWeights entry) is never picked; cross-industry functions (engineering, finance, legal, HR, ...)
// keep the small baseline weight so e.g. a software engineer can work at a bank.
const INDUSTRY_BOUND = new Set([
  'healthcare_clinical', 'academia', 'biotech_research', 'investment_banking', 'venture_capital', 'consulting',
  'policy_government', 'nonprofit', 'energy_engineering', 'media_production', 'journalism',
  'retail_merchandising', 'hospitality',
]);

export function companyFitsFunction(W, c, fnId) {
  if (c.generic) return true;
  if (!INDUSTRY_BOUND.has(fnId)) return true;
  const fn = W.fnById.get(fnId);
  return fn.industryIds.includes(c.industryId) || ((c.functionWeights && c.functionWeights[fnId]) || 0) > 0;
}

export function pickCompany(W, rng, comm, fnId, avoidId, home) {
  const eligible = (cm) => W.realByComm.get(cm).filter((c) => c.id !== avoidId && companyFitsFunction(W, c, fnId));
  let list = eligible(comm);
  // the secondary community may have no employer for an industry-bound function: stay home instead
  if (!list.length && home && home !== comm) list = eligible(home);
  if (!list.length) list = [...W.realByComm.values()].flat().filter((c, i, a) => a.indexOf(c) === i && c.id !== avoidId && companyFitsFunction(W, c, fnId));
  return rng.weighted(list, (c) => companyWeight(W, c, fnId));
}

function displayCompany(rng, c, forceVariant = false) {
  if (c.variants && c.variants.length && (forceVariant || rng.chance(0.08))) return rng.pick(c.variants);
  return c.name;
}

const MESSY = [
  (t) => t.toUpperCase(),
  (t, x) => `${t} | ${x}`,
  (t) => `${t} - Remote`,
  (t) => t.replace(' ', '  '),
  (t) => `${t} 🚀`,
  (t) => `${t} (Contract)`,
  (t, x) => `${t}, ${x}`,
  (t) => `  ${t}`,
  (t, x) => `${t}, "${x}"`,
];

function drawName(pools, rng, origin, used) {
  const pool = pools.names[origin];
  for (let tries = 0; tries < 60; tries++) {
    let first = rng.pick(pool.first);
    let last = rng.pick(pool.last);
    if (rng.chance(0.08)) {
      // mixed-heritage names are common
      const other = pools.names[rng.pick(Object.keys(pools.names))];
      if (rng.chance(0.5)) first = rng.pick(other.first); else last = rng.pick(other.last);
    }
    const key = normalizePersonName(`${first} ${last}`);
    if (!used.has(key) && !FAMOUS_NAMES.has(key)) {
      used.add(key);
      return { first, last };
    }
  }
  throw new Error(`name pool exhausted for ${origin}`);
}

export function makeSlug(rng, first, last, usedSlugs, forceDefault = false) {
  const f = asciiSlug(first).split('-')[0] || 'member';
  const l = asciiSlug(last).replace(/-/g, '') || 'member';
  const fl = `${asciiSlug(first)}-${asciiSlug(last)}`.replace(/-+/g, '-');
  if (!forceDefault && rng.chance(0.15)) {
    const opts = [
      { s: `${f}${l}`, cased: `${cap(f)}${cap(l)}` },
      { s: fl, cased: null },
      { s: `${f[0]}${l}`, cased: null },
      { s: `${f}${l}${rng.int(10, 99)}`, cased: null },
      { s: `${fl}-${rng.pick(['mba', 'cpa', 'phd', 'pe', 'cfa', 'pmp'])}`, cased: null },
      { s: `${l}${f}`, cased: null },
    ];
    const o = rng.pick(opts);
    if (!usedSlugs.has(o.s)) {
      usedSlugs.add(o.s);
      const mixed = o.cased && rng.chance(0.45);
      return { slug: o.s, display: mixed ? o.cased : o.s, vanity: true };
    }
  }
  for (;;) {
    const s = `${fl}-${rng.hex(rng.int(6, 8))}`;
    if (!usedSlugs.has(s)) {
      usedSlugs.add(s);
      return { slug: s, display: s, vanity: false };
    }
  }
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function buildCareer(W, rng, person) {
  const { home, second, functionId: fnId, yrs } = person;
  const positions = [];
  if (yrs < 0) {
    // student with a current internship
    const c = pickCompany(W, rng, home, fnId);
    const start = monthStart(BASELINE - rng.int(0, 100));
    positions.push({ companyId: c.id, companyName: displayCompany(rng, c), title: titleFor(W, rng, fnId, 'intern', home), start, end: null, seniority: 'intern', community: home });
    person.careerStart = start;
    return positions;
  }
  const careerStart = monthStart(BASELINE - Math.round(yrs * 365.25) - rng.int(0, 300));
  person.careerStart = careerStart;
  const n = yrs < 2 ? 1 : yrs < 5 ? rng.int(1, 2) : yrs < 10 ? rng.int(1, 3) : rng.int(2, 4);
  const sens = seniorityPath(person.finalSeniority, n);
  // cut points
  const span = BASELINE - careerStart;
  const cuts = [];
  for (let i = 1; i < n; i++) cuts.push(rng.uniform(0.15, 0.9));
  cuts.sort((a, b) => a - b);
  const starts = [careerStart, ...cuts.map((c) => monthStart(careerStart + Math.round(c * span)))];
  for (let i = 1; i < starts.length; i++) if (starts[i] <= starts[i - 1] + 120) starts[i] = monthStart(starts[i - 1] + 200);
  let prevCompany = null;
  for (let i = 0; i < n; i++) {
    const comm = second && rng.chance(0.3) ? second : home;
    const stay = prevCompany && i > 0 && rng.chance(0.25) && W.byId.get(prevCompany.id).communities.includes(comm);
    let c = stay ? W.byId.get(prevCompany.id) : pickCompany(W, rng, comm, fnId, prevCompany && prevCompany.id, home);
    if (sens[i] === 'founder') {
      // founders run their own (stealth or small) company, not a large employer
      const small = W.realByComm.get(comm).filter((x) => x.size === 'small' && companyFitsFunction(W, x, fnId));
      const r = rng.next();
      c = r < 0.5 || !small.length ? W.byId.get('stealth_startup') : r < 0.65 ? W.byId.get('self_employed') : rng.pick(small);
    }
    const start = Math.min(starts[i], BASELINE);
    positions.push({
      companyId: c.id,
      companyName: stay && sens[i] !== 'founder' ? prevCompany.name : displayCompany(rng, c),
      title: titleFor(W, rng, fnId, sens[i], comm, earlierTitles(positions)),
      start,
      end: null,
      seniority: sens[i],
      community: comm,
      ...(c.generic ? { generic: true } : {}),
    });
    prevCompany = { id: c.id, name: positions[i].companyName };
  }
  for (let i = 0; i < positions.length - 1; i++) {
    const gap = rng.chance(0.2) ? rng.int(30, 180) : 0;
    positions[i].end = Math.max(positions[i].start + 60, monthStart(positions[i + 1].start - gap));
    if (positions[i].end > positions[i + 1].start) positions[i].end = positions[i + 1].start;
  }
  // a few people end on a generic employer
  if (rng.chance(0.035) && yrs >= 3) {
    const gw = { freelance: 0.3, self_employed: 0.25, independent_consultant: 0.2, stealth_startup: 0.15, open_to_work: 0.05, retired: yrs > 28 ? 0.15 : 0 };
    const gid = rng.weightedKey(gw);
    const g = W.byId.get(gid);
    const last = positions[positions.length - 1];
    const start = monthStart(Math.max(last.start + 240, BASELINE - rng.int(60, 700)));
    if (start < BASELINE) {
      last.end = start;
      const title =
        gid === 'stealth_startup' ? rng.pick(['Founder', 'Co-Founder', 'Founder & CEO', 'Stealth']) :
        gid === 'independent_consultant' ? 'Independent Consultant' :
        gid === 'open_to_work' ? rng.pick(['Seeking new opportunities', 'Open to Work', 'Career break']) :
        gid === 'retired' ? 'Retired' :
        titleFor(W, rng, fnId, RANK[last.seniority] >= 4 ? 'senior' : last.seniority, home);
      positions.push({ companyId: g.id, companyName: displayCompany(rng, g), title, start, end: null, seniority: last.seniority, community: home, generic: true });
    }
  }
  return positions;
}

function addLateChange(W, rng, person) {
  const cur = person.positions[person.positions.length - 1];
  if (cur.generic) return;
  const start = monthStart(rng.int(LATE_CHANGE_FROM, LATE_CHANGE_TO));
  if (start <= cur.start + 180) return;
  const promo = rng.chance(0.4);
  const path = MGR_PATH.includes(cur.seniority) ? MGR_PATH : IC_PATH;
  const idx = path.indexOf(cur.seniority);
  const nextSen = promo && idx >= 0 && idx < path.length - 1 ? path[idx + 1] : cur.seniority === 'intern' ? 'entry' : cur.seniority;
  let c;
  let name;
  if (promo) {
    c = W.byId.get(cur.companyId);
    name = cur.companyName;
  } else {
    const comm = person.second && rng.chance(0.3) ? person.second : person.home;
    c = pickCompany(W, rng, comm, person.functionId, cur.companyId, person.home);
    name = displayCompany(rng, c);
  }
  // never repeat a title held before the current one; a promotion also never keeps the current title
  const avoid = earlierTitles(person.positions);
  if (promo) avoid.add(cur.title);
  let title = titleFor(W, rng, person.functionId, nextSen, person.home, avoid);
  if (title === cur.title && !promo) title = titleFor(W, rng, person.functionId, nextSen, person.home, avoid);
  cur.end = start;
  person.positions.push({ companyId: c.id, companyName: name, title, start, end: null, seniority: nextSen, community: person.home, late: true });
}

function buildEducation(W, rng, person) {
  const comm = W.commById.get(person.home);
  const gradYear = person.yrs < 0 ? 2026 : Math.min(2025, ymdOf(person.careerStart)[0]);
  const edu = [];
  const r0 = rng.next();
  const firstSchool = r0 < 0.7 ? rng.pick(comm.schoolIds) : r0 < 0.88 && person.second ? rng.pick(W.commById.get(person.second).schoolIds) : rng.pick(W.world.schools).id;
  edu.push({ schoolId: firstSchool, degree: rng.pick(DEGREES.default), startYear: gradYear - 4, endYear: gradYear });
  const fn = person.functionId;
  const advanced =
    fn === 'healthcare_clinical' ? { p: 0.6, list: DEGREES.md } :
    fn === 'academia' || fn === 'biotech_research' ? { p: 0.55, list: DEGREES.phd } :
    fn === 'legal' ? { p: 0.8, list: DEGREES.jd } :
    fn === 'policy_government' ? { p: 0.35, list: DEGREES.mpp } :
    { p: person.yrs >= 4 ? 0.22 : 0, list: DEGREES.masters };
  if (person.yrs >= 2 && rng.chance(advanced.p)) {
    const pool = person.second && rng.chance(0.4) ? W.commById.get(person.second).schoolIds : comm.schoolIds;
    let sid = rng.pick(pool);
    if (sid === firstSchool) sid = rng.pick(W.world.schools).id;
    const len = advanced.list === DEGREES.phd ? 5 : advanced.list === DEGREES.md ? 4 : 2;
    const startYear = Math.min(2024 - len, gradYear + rng.int(1, 5));
    edu.push({ schoolId: sid, degree: rng.pick(advanced.list), startYear, endYear: startYear + len });
  }
  return edu;
}

export function generatePeople(W, pools, seed, targets) {
  const rng = new Rng(seed, 'people');
  const usedNames = new Set();
  const usedSlugs = new Set();
  const people = [];
  let n = 0;
  for (const k of COMMUNITIES) {
    const comm = W.commById.get(k);
    const originW = pools.communityOriginWeights[k];
    for (let i = 0; i < targets.home[k]; i++) {
      n += 1;
      const id = `P${String(n).padStart(5, '0')}`;
      const origin = rng.weightedKey(originW);
      const { first, last } = drawName(pools, rng, origin, usedNames);
      const functionId = rng.weightedKey(comm.functionWeights);
      const yrs = rng.chance(0.03) ? -1 : Math.min(38, Math.floor(rng.lognormal(Math.log(8.5), 0.62)));
      people.push({
        id, first, last, origin, home: k, second: null, functionId, yrs,
        finalSeniority: seniorityForYears(rng, yrs),
        location: rng.pick(comm.locations),
        sociability: rng.lognormal(0, 0.75) * (rng.chance(0.012) ? 4 : 1),
        email: null,
        flags: { hideCurrent: rng.chance(0.022), blankTitle: rng.chance(0.01), blankCompany: rng.chance(0.008), messy: rng.chance(0.04) },
      });
    }
  }
  // second communities fill each community's deficit from its neighbors
  const rng2 = new Rng(seed, 'second-community');
  for (const k of COMMUNITIES) {
    const need = targets.second[k];
    const cands = people.filter((p) => p.second === null && NEIGHBORS[k].includes(p.home));
    const chosen = rng2.sampleWeighted(cands, need, (p) => 1 + (NEIGHBORS[k].indexOf(p.home) === 0 ? 1 : 0));
    for (const p of chosen) p.second = k;
  }
  // careers, schools, skills, slugs, email
  const rng3 = new Rng(seed, 'careers');
  for (const p of people) {
    p.positions = buildCareer(W, rng3, p);
    if (p.yrs >= 0 && rng3.chance(0.15)) addLateChange(W, rng3, p);
    p.education = buildEducation(W, rng3, p);
    const skillPool = pools.skills[p.functionId];
    p.skills = rng3.shuffle(skillPool).slice(0, rng3.int(5, Math.min(15, skillPool.length)));
    if (p.flags.messy) {
      const f = rng3.pick(MESSY);
      const x = rng3.pick(p.skills);
      for (const pos of p.positions) pos.title = f(pos.title, x);
    }
    const s = makeSlug(rng3, p.first, p.last, usedSlugs);
    p.slug = s.slug;
    p.slugDisplay = s.display;
    p.vanity = s.vanity;
    if (rng3.chance(0.12)) p.email = emailFor(rng3, p.first, p.last);
    finalizeTags(W, p);
  }
  return { people, usedNames, usedSlugs };
}

export function emailFor(rng, first, last) {
  const f = asciiSlug(first).replace(/-/g, '') || 'member';
  const l = asciiSlug(last).replace(/-/g, '') || 'member';
  const dom = rng.pick(['example.com', 'example.net', 'example.org']);
  const style = rng.int(0, 3);
  const local = style === 0 ? `${f}.${l}` : style === 1 ? `${f[0]}${l}` : style === 2 ? `${f}${l}${rng.int(1, 99)}` : `${f}_${l}`;
  return `${local}@${dom}`;
}

export function finalizeTags(W, p) {
  p.fullName = `${p.first} ${p.last}`;
  p.url = `https://www.linkedin.com/in/${p.slugDisplay}`;
  p.urlLower = `https://www.linkedin.com/in/${p.slug}`;
  const cur = p.positions[p.positions.length - 1];
  p.seniorityId = cur.seniority;
  const c = W.byId.get(cur.companyId);
  p.industryId = c.industryId || W.fnById.get(p.functionId).industryIds[0];
  p.careerStart = Math.min(...p.positions.map((x) => x.start));
}

/** The job shown on a profile at `day` (null when none). */
export function activePosition(p, day) {
  let best = null;
  for (const pos of p.positions) {
    if (pos.start <= day && (pos.end == null || pos.end > day)) {
      if (!best || pos.start > best.start) best = pos;
    }
  }
  return best;
}

/** Company / Position exactly as a Connections.csv exported on `day` shows them. */
export function snapshot(p, day) {
  const pos = activePosition(p, day);
  if (!pos || p.flags.hideCurrent) return { company: '', position: '' };
  return {
    company: p.flags.blankCompany ? '' : pos.companyName,
    position: p.flags.blankTitle ? '' : pos.title,
  };
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/** Latest shared-employer overlap window before `upTo` (null if none). */
export function latestOverlap(a, b, upTo) {
  let best = null;
  for (const x of a.positions) {
    if (x.generic) continue;
    for (const y of b.positions) {
      if (y.companyId !== x.companyId) continue;
      const s = Math.max(x.start, y.start);
      const e = Math.min(x.end ?? upTo, y.end ?? upTo, upTo);
      if (e - s >= 30 && (!best || s > best.start)) best = { start: s, end: e, companyId: x.companyId };
    }
  }
  return best;
}

export function sharesSchool(a, b) {
  return a.education.some((x) => b.education.some((y) => y.schoolId === x.schoolId));
}

export function connectedOnFor(rng, a, b, upTo) {
  let lo = Math.max(FLOOR_CONNECTED, a.careerStart - 730, b.careerStart - 730);
  const hi = upTo - 1;
  if (lo > hi - 30) lo = hi - 30;
  const ov = latestOverlap(a, b, upTo);
  if (ov && rng.chance(0.8)) {
    const d = ov.start + Math.floor(rng.expo(75));
    return Math.max(lo, Math.min(d, ov.end, hi));
  }
  const recentLo = Math.max(lo, hi - 6 * 365);
  if (rng.chance(0.72)) return recentLo + Math.floor(Math.pow(rng.next(), 0.8) * (hi - recentLo + 1));
  return lo + Math.floor(rng.next() * (hi - lo + 1));
}

export { iso };
