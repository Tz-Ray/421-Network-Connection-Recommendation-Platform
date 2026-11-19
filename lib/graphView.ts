// lib/graphView.ts
//
// Pure view model + layout for the /network page (no firebase, no React).
// Input: the viewer's OWN connection rows (each with its graph personKey) and
// the CommonConnections loaded from the shared graph. Output: nodes, edges,
// per-member counts, a member-to-member summary and a deterministic layout.
//
// Privacy: every person label comes from the viewer's own rows. A personKey
// the viewer has no row for (e.g. rows changed since the last sync) is counted
// but never named. Members are taken only from `common.members` (members who
// left or are unreadable are not in it), so a stale uid in othersByPerson is
// ignored.

import type { CommonConnections } from './networkGraph.ts';

export const DEFAULT_MAX_PEOPLE = 150;
export const NO_NAME = '(no name)';

export type GraphRowInput = {
  /** null when the row has no valid linkedin.com/in/ URL (never shared). */
  personKey: string | null;
  name: string | null | undefined;
  position?: string | null;
  company?: string | null;
};

export type GraphViewInput = {
  myRows: GraphRowInput[];
  /** null when the viewer has not opted in (or the graph is not loaded). */
  common: Pick<CommonConnections, 'members' | 'othersByPerson'> | null;
  /** Show at most this many shared people as nodes (most members first). */
  maxPeople?: number;
  youLabel?: string;
};

export type YouNode = { id: 'you'; kind: 'you'; label: string };
export type MemberNode = { id: string; kind: 'member'; uid: string; label: string; sharedCount: number; knownCount: number };
export type PersonNode = {
  id: string;
  kind: 'person';
  personKey: string;
  label: string;
  /** Every name the viewer's own rows give this key (duplicates collapse). */
  names: string[];
  position: string | null;
  company: string | null;
  /** Other members who also have this person, in member order. */
  memberUids: string[];
};
export type UnsharedNode = { id: 'unshared'; kind: 'unshared'; label: string; count: number };
export type GraphNode = YouNode | MemberNode | PersonNode | UnsharedNode;

export type GraphEdge = { source: string; target: string; kind: 'you-person' | 'member-person' | 'you-unshared' };

export type SharedPerson = { personKey: string; label: string; position: string | null; company: string | null };

export type MemberSummary = {
  uid: string;
  displayName: string;
  /** Keys shared with the viewer according to the graph. */
  sharedCount: number;
  /** Of those, how many the viewer's own rows can name. */
  knownCount: number;
  /** Named shared people, sorted by label. */
  people: SharedPerson[];
  /** Other members who also have some of these people, most first. */
  overlaps: { uid: string; displayName: string; count: number }[];
};

export type MemberPair = { a: string; b: string; aName: string; bName: string; count: number };

export type GraphTotals = {
  myRows: number;
  /** Rows without a valid profile URL (never shared). */
  noUrl: number;
  /** Distinct personKeys in the viewer's rows. */
  distinctKeys: number;
  /** Distinct own keys at least one other member also has. */
  sharedPeople: number;
  /** Distinct own keys no other member has. */
  unshared: number;
  /** Shared keys the viewer's rows do not contain (counted, never named). */
  unnamedShared: number;
  shownPeople: number;
  hiddenPeople: number;
  members: number;
};

export type GraphView = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  members: MemberSummary[];
  /** Pairs of other members and how many of the viewer's shared people both have. */
  memberPairs: MemberPair[];
  /** Every named shared person (not only the shown ones), most members first. */
  people: PersonNode[];
  totals: GraphTotals;
};

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byLabel = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || cmpStr(a, b);

function cleanName(s: string | null | undefined): string {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return t || NO_NAME;
}

export function memberNodeId(uid: string): string {
  return `m:${uid}`;
}
export function personNodeId(key: string): string {
  return `p:${key}`;
}

export function buildGraphView(input: GraphViewInput): GraphView {
  const maxPeople = Math.max(0, Math.floor(input.maxPeople ?? DEFAULT_MAX_PEOPLE));

  // Own rows by key (first row wins for title/company; all names kept).
  type Own = { names: Set<string>; position: string | null; company: string | null };
  const own = new Map<string, Own>();
  let noUrl = 0;
  for (const r of input.myRows) {
    if (!r.personKey) {
      noUrl++;
      continue;
    }
    const name = cleanName(r.name);
    const o = own.get(r.personKey);
    if (o) {
      o.names.add(name);
      o.position ??= r.position?.trim() || null;
      o.company ??= r.company?.trim() || null;
    } else {
      own.set(r.personKey, {
        names: new Set([name]),
        position: r.position?.trim() || null,
        company: r.company?.trim() || null,
      });
    }
  }

  const members = [...(input.common?.members ?? [])]
    .map((m) => ({ uid: m.uid, displayName: m.displayName, keys: [...new Set(m.personKeys)] }))
    .sort(
      (a, b) =>
        b.keys.length - a.keys.length || byLabel(a.displayName, b.displayName) || cmpStr(a.uid, b.uid)
    );
  const memberIndex = new Map(members.map((m, i) => [m.uid, i]));
  const nameOf = new Map(members.map((m) => [m.uid, m.displayName]));

  // personKey -> member uids (only current members, member order).
  const byPerson = new Map<string, string[]>();
  for (const m of members) {
    for (const k of m.keys) {
      const list = byPerson.get(k);
      if (list) list.push(m.uid);
      else byPerson.set(k, [m.uid]);
    }
  }
  for (const [k, uids] of input.common?.othersByPerson ?? []) {
    for (const u of uids) {
      if (!memberIndex.has(u)) continue; // left / unreadable: ignore
      const list = byPerson.get(k);
      if (!list) byPerson.set(k, [u]);
      else if (!list.includes(u)) list.push(u);
    }
  }
  for (const list of byPerson.values()) list.sort((a, b) => memberIndex.get(a)! - memberIndex.get(b)!);

  // Named shared people, most members first.
  const people: PersonNode[] = [];
  let unnamedShared = 0;
  for (const [k, uids] of byPerson) {
    const o = own.get(k);
    if (!o) {
      unnamedShared++;
      continue;
    }
    const names = [...o.names].sort(byLabel);
    people.push({
      id: personNodeId(k),
      kind: 'person',
      personKey: k,
      label: names[0],
      names,
      position: o.position,
      company: o.company,
      memberUids: uids,
    });
  }
  people.sort(
    (a, b) => b.memberUids.length - a.memberUids.length || byLabel(a.label, b.label) || cmpStr(a.personKey, b.personKey)
  );
  const shown = people.slice(0, maxPeople);

  let unshared = 0;
  for (const k of own.keys()) if (!byPerson.has(k)) unshared++;

  // Per-member summaries.
  const peopleByMember = new Map<string, PersonNode[]>();
  for (const p of people) {
    for (const u of p.memberUids) {
      const list = peopleByMember.get(u);
      if (list) list.push(p);
      else peopleByMember.set(u, [p]);
    }
  }

  // Member-to-member: how many of the viewer's shared people both members have.
  const pairCounts = new Map<string, number>();
  for (const uids of byPerson.values()) {
    for (let i = 0; i < uids.length; i++) {
      for (let j = i + 1; j < uids.length; j++) {
        const key = `${uids[i]}\u0000${uids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const memberPairs: MemberPair[] = [...pairCounts].map(([key, count]) => {
    const [a, b] = key.split('\u0000');
    return { a, b, aName: nameOf.get(a)!, bName: nameOf.get(b)!, count };
  });
  memberPairs.sort(
    (x, y) =>
      y.count - x.count ||
      memberIndex.get(x.a)! - memberIndex.get(y.a)! ||
      memberIndex.get(x.b)! - memberIndex.get(y.b)!
  );

  const summaries: MemberSummary[] = members.map((m) => {
    const mine = peopleByMember.get(m.uid) ?? [];
    const overlaps = memberPairs
      .filter((p) => p.a === m.uid || p.b === m.uid)
      .map((p) => (p.a === m.uid ? { uid: p.b, displayName: p.bName, count: p.count } : { uid: p.a, displayName: p.aName, count: p.count }));
    return {
      uid: m.uid,
      displayName: m.displayName,
      sharedCount: m.keys.length,
      knownCount: mine.length,
      people: mine
        .map((p) => ({ personKey: p.personKey, label: p.label, position: p.position, company: p.company }))
        .sort((a, b) => byLabel(a.label, b.label) || cmpStr(a.personKey, b.personKey)),
      overlaps,
    };
  });

  const nodes: GraphNode[] = [{ id: 'you', kind: 'you', label: input.youLabel?.trim() || 'You' }];
  for (const s of summaries) {
    nodes.push({ id: memberNodeId(s.uid), kind: 'member', uid: s.uid, label: s.displayName, sharedCount: s.sharedCount, knownCount: s.knownCount });
  }
  nodes.push(...shown);
  if (unshared > 0) {
    nodes.push({ id: 'unshared', kind: 'unshared', label: `${unshared.toLocaleString('en-US')} not shared with anyone`, count: unshared });
  }

  const edges: GraphEdge[] = [];
  for (const p of shown) {
    edges.push({ source: 'you', target: p.id, kind: 'you-person' });
    for (const u of p.memberUids) edges.push({ source: memberNodeId(u), target: p.id, kind: 'member-person' });
  }
  if (unshared > 0) edges.push({ source: 'you', target: 'unshared', kind: 'you-unshared' });

  return {
    nodes,
    edges,
    members: summaries,
    memberPairs,
    people,
    totals: {
      myRows: input.myRows.length,
      noUrl,
      distinctKeys: own.size,
      sharedPeople: people.length,
      unshared,
      unnamedShared,
      shownPeople: shown.length,
      hiddenPeople: people.length - shown.length,
      members: summaries.length,
    },
  };
}

// -----------------------------
// Layout (deterministic force-directed, fixed tick count)
// -----------------------------

export type Point = { x: number; y: number };
export type GraphLayout = {
  positions: Map<string, Point>;
  /** Radius per node id, for rendering and hit-testing. */
  radius: Map<string, number>;
  /** Member ring radii (ellipse). */
  ring: { rx: number; ry: number };
};

export type LayoutOptions = { ticks?: number; rx?: number; ry?: number };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * "You" pinned at the centre, members pinned on an ellipse (most shared at the
 * top), the not-shared aggregate pinned below the ring, shared people placed
 * by a fixed number of force ticks: springs to "you" and to each member who has the
 * person, pairwise repulsion between free nodes, and a cooling step. Same input,
 * same output. O(free² · ticks); 150 people x 250 ticks is a few ms.
 */
export function layoutGraph(view: GraphView, opts: LayoutOptions = {}): GraphLayout {
  const ticks = Math.max(0, Math.floor(opts.ticks ?? 250));
  const rx = opts.rx ?? 400;
  const ry = opts.ry ?? 270;
  const positions = new Map<string, Point>();
  const radius = new Map<string, number>();

  const memberNodes = view.nodes.filter((n): n is MemberNode => n.kind === 'member');
  const maxShared = Math.max(1, ...memberNodes.map((m) => m.sharedCount));
  positions.set('you', { x: 0, y: 0 });
  radius.set('you', 22);
  // Spread the biggest members around the ring instead of side by side: the
  // i-th member (most shared first) takes slot (i * stride) mod M, with a
  // stride near 0.38 M that is coprime with M (so every slot is used once).
  const M = memberNodes.length;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let stride = Math.max(1, Math.round(M * 0.382));
  while (M > 1 && gcd(stride, M) !== 1) stride++;
  memberNodes.forEach((m, i) => {
    const slot = M > 0 ? (i * stride) % M : 0;
    const angle = -Math.PI / 2 + (2 * Math.PI * slot) / Math.max(1, M);
    positions.set(m.id, { x: rx * Math.cos(angle), y: ry * Math.sin(angle) });
    radius.set(m.id, 10 + 10 * Math.sqrt(m.sharedCount / maxShared));
  });

  type Free = { id: string; x: number; y: number; r: number; anchors: string[] };
  const free: Free[] = [];
  for (const n of view.nodes) {
    if (n.kind === 'person') {
      const rand = mulberry32(seedOf(n.personKey));
      // Start at the centroid of "you" and the person's members, jittered.
      let sx = 0;
      let sy = 0;
      for (const u of n.memberUids) {
        const p = positions.get(memberNodeId(u))!;
        sx += p.x;
        sy += p.y;
      }
      const k = n.memberUids.length + 1;
      const r = 4 + Math.min(6, 1.5 * (n.memberUids.length - 1));
      free.push({
        id: n.id,
        x: (sx / k) * 0.9 + (rand() - 0.5) * 60,
        y: (sy / k) * 0.9 + (rand() - 0.5) * 60,
        r,
        anchors: ['you', ...n.memberUids.map(memberNodeId)],
      });
      radius.set(n.id, r);
    } else if (n.kind === 'unshared') {
      // Pinned below the ring, out of the shared-people cloud.
      positions.set(n.id, { x: 0, y: ry + 85 });
      radius.set(n.id, 18);
    }
  }

  const fixed = [...positions.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, r: radius.get(id)! }));
  const n = free.length;
  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / Math.max(1, ticks);
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = free[i];
      // Springs toward anchors: a person shared with members sits between
      // "you" and those members, pulled a little harder toward the members.
      for (const id of a.anchors) {
        const p = positions.get(id)!;
        const w = id === 'you' ? (a.anchors.length === 1 ? 0.06 : 0.03) : 0.05;
        const rest = id === 'you' ? (a.anchors.length === 1 ? ry * 0.3 : 0) : 0;
        const dx = p.x - a.x;
        const dy = p.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const pull = w * (d - rest);
        fx[i] += (dx / d) * pull;
        fy[i] += (dy / d) * pull;
      }
      // Repulsion from fixed nodes (keeps people off member/you discs).
      for (const f of fixed) {
        const dx = a.x - f.x;
        const dy = a.y - f.y;
        const d2 = dx * dx + dy * dy || 1;
        const min = a.r + f.r + 8;
        if (d2 < min * min * 4) {
          const d = Math.sqrt(d2);
          const push = 900 / d2 + (d < min ? (min - d) * 0.5 : 0);
          fx[i] += (dx / d) * push;
          fy[i] += (dy / d) * push;
        }
      }
    }
    // Pairwise repulsion between free nodes.
    for (let i = 0; i < n; i++) {
      const a = free[i];
      for (let j = i + 1; j < n; j++) {
        const b = free[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) {
          dx = ((i * 7919 + j) % 13) - 6 || 1;
          dy = ((j * 104729 + i) % 11) - 5 || 1;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        const min = a.r + b.r + 4;
        let push = 260 / d2;
        if (d < min) push += (min - d) * 0.5;
        const ux = (dx / d) * push;
        const uy = (dy / d) * push;
        fx[i] += ux;
        fy[i] += uy;
        fx[j] -= ux;
        fy[j] -= uy;
      }
    }
    const step = 0.2 + 0.8 * alpha;
    for (let i = 0; i < n; i++) {
      const cap = 30 * step;
      free[i].x += Math.max(-cap, Math.min(cap, fx[i] * step));
      free[i].y += Math.max(-cap, Math.min(cap, fy[i] * step));
    }
  }
  for (const f of free) positions.set(f.id, { x: f.x, y: f.y });

  return { positions, radius, ring: { rx, ry } };
}


// -----------------------------
// Workbench layout (the /network Graph tab)
// -----------------------------
//
// A fixed 780 x 560 drawing that the page scales to fit its box. You in the
// centre, members (squares) on an inner ring, at most GRAPH_PEOPLE_MAX shared
// people in two columns along an outer ellipse with their labels pointing
// outward. Labels keep a fixed on-screen size, so their size in drawing units
// is `labelScale` (drawing units per screen pixel) times the pixel size; the
// layout makes room for them and degrades in a fixed order when the box is
// small: shorter person labels, then members' first names, then initials
// inside their own squares, then fewer people.

/** The Graph tab draws at most this many shared people; the List tab has all of them. */
export const GRAPH_PEOPLE_MAX = 28;
/** Fixed logical drawing size; the <svg> scales it to fit its box. */
export const WORKBENCH_WIDTH = 780;
export const WORKBENCH_HEIGHT = 560;
/** On-screen label sizes in CSS pixels, kept at any box size or zoom. */
export const PERSON_LABEL_PX = 12;
export const MEMBER_LABEL_PX = 13;
/** Node sizes in drawing units. */
export const YOU_RADIUS = 28;
export const MEMBER_HALF = 19;
export const PERSON_RADIUS = 7;

/** Label box height in em (Geist's text box is 1.29em). */
const LABEL_EM = 1.3;
/** Nothing is drawn closer than this to the drawing's edge. */
const EDGE_PAD = 4;
/** Outer ellipse half-width cap (the draft uses 250). */
const PEOPLE_RX_MAX = 260;
/** Row spacing cap (the draft spaces its rows about 37 units apart). */
const PITCH_MAX = 38;
/** The top and bottom rows sit at this fraction of the outer ellipse's height (draft: 222 / 246). */
const RY_FACTOR = 0.9;
/** Member ring height / width (draft: 112 / 150). */
const RING_RATIO = 0.75;

/** What the Graph tab is focused on; null = nothing or You. */
export type GraphFocus = { kind: 'member'; uid: string } | { kind: 'person'; key: string } | null;

/**
 * The shared people the Graph tab draws (at most `max`), best first:
 * - nothing or You: the people shared with the most members, ties by name, then key (= view.people order);
 * - a member: the people that member shares with you, same order;
 * - a person: the set `previous` (the person keys shown when it was clicked), with the person in it
 *   (added in place of the lowest-ranked one when it was not shown). Without `previous`: the default set.
 */
export function pickGraphPeople(
  view: GraphView,
  focus: GraphFocus,
  previous: readonly string[] | null = null,
  max: number = GRAPH_PEOPLE_MAX,
): PersonNode[] {
  const cap = Math.max(0, Math.floor(max));
  const top = view.people.slice(0, cap);
  if (focus?.kind === 'member') {
    if (!view.members.some((m) => m.uid === focus.uid)) return top;
    return view.people.filter((p) => p.memberUids.includes(focus.uid)).slice(0, cap);
  }
  if (focus?.kind !== 'person') return top;
  const rank = new Map(view.people.map((p, i) => [p.personKey, i]));
  const wanted = new Set(previous ?? top.map((p) => p.personKey));
  let base = view.people.filter((p) => wanted.has(p.personKey)).slice(0, cap);
  const person = view.people.find((p) => p.personKey === focus.key);
  if (!person || cap === 0 || base.includes(person)) return base;
  if (base.length >= cap) base = base.slice(0, cap - 1);
  return [...base, person].sort((a, b) => rank.get(a.personKey)! - rank.get(b.personKey)!);
}

/**
 * A deliberately generous width estimate (in the font size's units) for the
 * app's sans font, also safe for wider fallbacks such as DejaVu Sans.
 */
export function estimateTextWidth(text: string, fontSize: number, bold = false): number {
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === ' ') em += 0.32;
    else if (".,:;'!|ijlI".includes(ch)) em += 0.32;
    else if ('frtJ()[]-'.includes(ch)) em += 0.44;
    else if ('mwMW@%…'.includes(ch)) em += 1;
    else if (ch >= 'A' && ch <= 'Z') em += 0.78;
    else if (ch >= '0' && ch <= '9') em += 0.64;
    else if (code >= 0x2e80) em += 1.05;
    else em += 0.64;
  }
  return em * fontSize * (bold ? 1.08 : 1);
}

const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|phd|md|mba|cpa|esq)\.?$/i;
function nameParts(name: string): string[] {
  const base = name.split(',')[0].trim() || name.trim();
  const parts = base.split(/\s+/).filter(Boolean);
  while (parts.length > 2 && NAME_SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return parts;
}

/** "First L." for a person label (the full name stays in the node's title). */
export function shortPersonLabel(name: string): string {
  if (name === NO_NAME) return name;
  const parts = nameParts(name);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0]}.`;
}

function firstName(name: string): string {
  return nameParts(name)[0] ?? name;
}

/** The text cut to fit `maxWidth` ("Christo… T." keeps the initial), or '' when even one letter does not fit. */
function fitText(text: string, maxWidth: number, fontSize: number, bold: boolean): string {
  if (estimateTextWidth(text, fontSize, bold) <= maxWidth) return text;
  const m = /^(\S+) (\S\.)$/u.exec(text);
  if (m) {
    const first = Array.from(m[1]);
    for (let j = first.length - 1; j >= 1; j--) {
      const t = `${first.slice(0, j).join('')}… ${m[2]}`;
      if (estimateTextWidth(t, fontSize, bold) <= maxWidth) return t;
    }
  }
  const chars = Array.from(text);
  for (let j = chars.length - 1; j >= 1; j--) {
    const t = `${chars.slice(0, j).join('')}…`;
    if (estimateTextWidth(t, fontSize, bold) <= maxWidth) return t;
  }
  return '';
}

/** A label's conservative bounds in drawing units (x, y = top-left); `anchor` is the SVG text-anchor. */
export type WorkbenchLabel = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  anchor: 'start' | 'middle' | 'end';
  /** Compact fallback, rendered inside this member's square. */
  inside?: boolean;
};
export type WorkbenchLayout = {
  width: number;
  height: number;
  /** Centre and radius (a member's half side) per drawn node id: you, every member, the drawn people. */
  positions: Record<string, { x: number; y: number; r: number }>;
  /** Every drawn node's label; compact member labels live inside their own square. */
  labels: Record<string, WorkbenchLabel>;
  /** Person node ids drawn (at most GRAPH_PEOPLE_MAX), in the order they were given. */
  people: string[];
  /** The labelScale used. */
  labelScale: number;
};
export type WorkbenchOptions = {
  /** People to draw, best first (pickGraphPeople); default: pickGraphPeople(view, null). */
  people?: readonly PersonNode[];
  /** Drawing units per screen pixel at 100% zoom (1 / the drawing's rendered scale). Default 1. */
  labelScale?: number;
  /** A person node id that stays drawn when the box cannot fit every given person. */
  keep?: string;
};

type Box = { x: number; y: number; width: number; height: number };
const distanceToBox = (b: Box, x: number, y: number) => Math.hypot(
  Math.max(b.x - x, 0, x - b.x - b.width), Math.max(b.y - y, 0, y - b.y - b.height),
);
const boxAround = (x: number, y: number, r: number): Box => ({ x: x - r, y: y - r, width: 2 * r, height: 2 * r });
const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const within = (b: Box, w: number, h: number) =>
  b.x >= EDGE_PAD && b.y >= EDGE_PAD && b.x + b.width <= w - EDGE_PAD && b.y + b.height <= h - EDGE_PAD;

/** Whether the segment (x1, y1)-(x2, y2) crosses the box grown by `pad` (Liang-Barsky clipping). */
function crosses(b: Box, x1: number, y1: number, x2: number, y2: number, pad: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, x1 - (b.x - pad)],
    [dx, b.x + b.width + pad - x1],
    [-dy, y1 - (b.y - pad)],
    [dy, b.y + b.height + pad - y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      t0 = Math.max(t0, t);
    } else {
      if (t < t0) return false;
      t1 = Math.min(t1, t);
    }
  }
  return true;
}

function makeLabel(
  text: string,
  fontSize: number,
  bold: boolean,
  ax: number,
  ay: number,
  anchor: WorkbenchLabel['anchor'],
): WorkbenchLabel {
  const width = estimateTextWidth(text, fontSize, bold);
  const height = fontSize * LABEL_EM;
  const x = anchor === 'start' ? ax : anchor === 'end' ? ax - width : ax - width / 2;
  return { x, y: ay - height / 2, width, height, text, fontSize, anchor };
}

/** n points at equal arc length on an ellipse, clockwise from the top. */
function ellipsePoints(n: number, rx: number, ry: number): { x: number; y: number; angle: number }[] {
  if (n <= 0) return [];
  const steps = 720;
  const cum = [0];
  let prev = { x: 0, y: -ry };
  for (let s = 1; s <= steps; s++) {
    const t = -Math.PI / 2 + (2 * Math.PI * s) / steps;
    const p = { x: rx * Math.cos(t), y: ry * Math.sin(t) };
    cum.push(cum[s - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  const total = cum[steps];
  const out: { x: number; y: number; angle: number }[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / n;
    while (s < steps && cum[s + 1] < target) s++;
    const span = cum[s + 1] - cum[s] || 1;
    const t = -Math.PI / 2 + (2 * Math.PI * (s + (target - cum[s]) / span)) / steps;
    out.push({ x: rx * Math.cos(t), y: ry * Math.sin(t), angle: t });
  }
  return out;
}

const ringCache = new Map<number, { half: number; ringMin: number }>();
/**
 * Member squares: the draft's size up to 8 members, a little smaller for more
 * (so the ring leaves room for names), on the smallest ring where they clear
 * each other and You (only very many members shrink them further).
 */
function memberRing(n: number): { half: number; ringMin: number } {
  const cached = ringCache.get(n);
  if (cached) return cached;
  const W = WORKBENCH_WIDTH;
  const H = WORKBENCH_HEIGHT;
  let half = n <= 8 ? MEMBER_HALF : Math.max(13, Math.round(MEMBER_HALF - (n - 8) * 0.75));
  let ringMin = 0;
  for (; half >= 6; half--) {
    for (let rx = 40; rx + half <= W / 2 - EDGE_PAD && rx * RING_RATIO + half <= H / 2 - EDGE_PAD; rx += 2) {
      const pts = ellipsePoints(n, rx, rx * RING_RATIO);
      const clear = pts.every(
        (p, i) =>
          Math.max(Math.abs(p.x), Math.abs(p.y)) >= YOU_RADIUS + half + 6 &&
          pts.every((q, j) => j <= i || Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) >= 2 * half + 6),
      );
      if (clear) {
        ringMin = rx;
        break;
      }
    }
    if (ringMin || n === 0) break;
  }
  const result = { half: Math.max(half, 6), ringMin: ringMin || 40 };
  ringCache.set(n, result);
  return result;
}

/** Laid out in `labelScale`-sized label units; see the section comment. Same input, same output. */
export function layoutWorkbench(view: GraphView, options: WorkbenchOptions = {}): WorkbenchLayout {
  const W = WORKBENCH_WIDTH;
  const H = WORKBENCH_HEIGHT;
  const cx = W / 2;
  const cy = H / 2;
  const raw = options.labelScale;
  const k = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(4, Math.max(0.25, raw)) : 1;
  const gap = 2 * k; // at least 2 screen pixels between labels
  const fsP = PERSON_LABEL_PX * k;
  const fsM = MEMBER_LABEL_PX * k;
  const hP = fsP * LABEL_EM;
  const hM = fsM * LABEL_EM;
  const off = PERSON_RADIUS + 3 * k; // dot to label
  const members = view.nodes.filter((n): n is MemberNode => n.kind === 'member');
  const n = members.length;

  const seen = new Set<string>();
  const given = (options.people ?? pickGraphPeople(view, null))
    .filter((p) => p.kind === 'person' && !seen.has(p.id) && seen.add(p.id))
    .slice(0, GRAPH_PEOPLE_MAX);

  const { half, ringMin } = memberRing(n);

  // People rows.
  const pitchMin = hP + gap;
  const usable = H - 2 * EDGE_PAD - hP;
  const rowsMax = usable >= 0 ? Math.floor(usable / pitchMin + 1e-9) + 1 : 0;
  const ry = Math.min(13 * Math.max(PITCH_MAX, pitchMin), usable) / 2 / RY_FACTOR || 1;

  const attempt = (chosen: PersonNode[], force: boolean): WorkbenchLayout | null => {
    const pts = ellipsePoints(n, 1, RING_RATIO);
    const dir = new Map(members.map((m, i) => [m.uid, Math.atan2(pts[i].y / RING_RATIO, pts[i].x)]));
    const ordered = chosen
      .map((p) => {
        let sx = 0;
        let sy = 0;
        for (const u of p.memberUids) {
          const a = dir.get(u);
          if (a !== undefined) {
            sx += Math.cos(a);
            sy += Math.sin(a);
          }
        }
        const a = Math.hypot(sx, sy) < 0.2 ? -Math.PI / 2 : Math.atan2(sy, sx);
        return { p, angle: (a + Math.PI / 2 + 4 * Math.PI) % (2 * Math.PI) };
      })
      .sort((a, b) => a.angle - b.angle || byLabel(a.p.label, b.p.label) || cmpStr(a.p.id, b.p.id));
    const nR = Math.ceil(ordered.length / 2);
    const nL = ordered.length - nR;
    const pitch = nR > 1 ? Math.min(Math.max(PITCH_MAX, pitchMin), usable / (nR - 1)) : 0;
    const rows = ordered.map(({ p }, i) => {
      const right = i < nR;
      const y = right ? cy - ((nR - 1) * pitch) / 2 + i * pitch : cy + ((nL - 1) * pitch) / 2 - (i - nR) * pitch;
      const f = Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
      return { p, right, y, f, text: shortPersonLabel(p.label) };
    });

    // Outer ellipse width: as wide as the labels allow (capped), never inside the member ring.
    const floor = ringMin + half + PERSON_RADIUS + 10;
    let rx = PEOPLE_RX_MAX;
    for (const r of rows) {
      if (r.f > 0) rx = Math.min(rx, (W / 2 - EDGE_PAD - off - estimateTextWidth(r.text, fsP)) / r.f);
    }
    rx = Math.max(rx, floor);

    const positions: WorkbenchLayout['positions'] = { you: { x: cx, y: cy, r: YOU_RADIUS } };
    const labels: WorkbenchLayout['labels'] = {};
    const obstacles: Box[] = [boxAround(cx, cy, YOU_RADIUS)];
    for (const r of rows) {
      const x = cx + (r.right ? 1 : -1) * rx * r.f;
      const ax = x + (r.right ? off : -off);
      const room = r.right ? W - EDGE_PAD - ax : ax - EDGE_PAD;
      const text = fitText(r.text, room, fsP, false);
      if (!text && !force) return null;
      positions[r.p.id] = { x, y: r.y, r: PERSON_RADIUS };
      obstacles.push(boxAround(x, r.y, PERSON_RADIUS));
      if (text) {
        const label = makeLabel(text, fsP, false, ax, r.y, r.right ? 'start' : 'end');
        labels[r.p.id] = label;
        obstacles.push(label);
      }
    }

    // Member ring: try sizes from the draft's proportion outward, then inward;
    // keep the first where every full name fits, else the one where most first names fit.
    const ringMax = Math.min(rx - half - PERSON_RADIUS - 10, (H / 2 - EDGE_PAD - half) / RING_RATIO);
    const base = Math.min(Math.max(ringMin, 0.6 * rx), Math.max(ringMin, ringMax));
    const sizes: number[] = [base];
    for (let s = base + 12; s <= ringMax; s += 12) sizes.push(s);
    for (let s = base - 12; s >= ringMin; s -= 12) sizes.push(s);
    if (!sizes.includes(ringMin)) sizes.push(ringMin);

    type Ring = { squares: { m: MemberNode; x: number; y: number; angle: number }[]; labels: Record<string, WorkbenchLabel>; score: number };
    let best: Ring | null = null;
    for (const size of sizes) {
      const squares = ellipsePoints(n, size, size * RING_RATIO).map((p, i) => ({
        m: members[i],
        x: cx + p.x,
        y: cy + p.y,
        angle: p.angle,
      }));
      const boxes = squares.map((s) => boxAround(s.x, s.y, half));
      const valid = boxes.every(
        (b, i) =>
          within(b, W, H) &&
          obstacles.every((o) => !overlaps(b, o, 4)) &&
          boxes.every((c, j) => j <= i || !overlaps(b, c, 4)),
      );
      if (!valid && !force) continue;
      const place = (mode: 'full' | 'first') => {
        const placed: Record<string, WorkbenchLabel> = {};
        const taken: Box[] = [...obstacles, ...boxes];
        for (const s of squares) {
          const text = mode === 'full' ? s.m.label : firstName(s.m.label);
          // Outward first: above/below for the top and bottom of the ring, beside for its sides,
          // then the corners, then the inner side (never across a You-member line).
          const below = Math.sin(s.angle) > 0.3;
          const right = Math.cos(s.angle) >= 0;
          const side = right ? 'start' : 'end';
          const dy = (below ? 1 : -1) * (half + 3 * k + hM / 2);
          const dx = (right ? 1 : -1) * (half + 3 * k);
          const sx = (right ? -1 : 1) * half;
          const vertical: [number, number, WorkbenchLabel['anchor']] = [s.x, s.y + dy, 'middle'];
          const beside: [number, number, WorkbenchLabel['anchor']] = [s.x + dx, s.y, side];
          const candidates: [number, number, WorkbenchLabel['anchor']][] = [
            ...(Math.abs(Math.cos(s.angle)) < 0.9 ? [vertical, beside] : [beside, vertical]),
            [s.x + sx, s.y + dy, side],
            [s.x - sx, s.y + dy, side],
            [s.x, s.y - dy, 'middle'],
          ];
          for (const [ax, ay, anchor] of candidates) {
            const label = makeLabel(text, fsM, true, ax, ay, anchor);
            if (
              within(label, W, H) &&
              taken.every((t) => !overlaps(label, t, gap)) &&
              // The text must be closest to its own square, even when a corner placement fits.
              squares.every((q) => q === s ||
                distanceToBox(label, s.x, s.y) <= distanceToBox(label, q.x, q.y)) &&
              squares.every((q) => !crosses(label, cx, cy, q.x, q.y, gap / 2))
            ) {
              placed[s.m.id] = label;
              taken.push(label);
              break;
            }
          }
        }
        return placed;
      };
      const full = place('full');
      if (Object.keys(full).length === n) {
        best = { squares, labels: full, score: Infinity };
        break;
      }
      const first = place('first');
      const score = Object.keys(first).length;
      if (!best || score > best.score) best = { squares, labels: first, score };
    }
    if (!best) return null;
    for (const s of best.squares) positions[s.m.id] = { x: s.x, y: s.y, r: half };
    Object.assign(labels, best.labels);
    for (const s of best.squares) {
      if (labels[s.m.id]) continue;
      const text = nameParts(s.m.label).slice(0, 2).map((p) => Array.from(p)[0]).join('').toUpperCase() || '?';
      const font = Math.min(fsM, (2 * half - 6) / Math.max(estimateTextWidth(text, 1, true), LABEL_EM));
      labels[s.m.id] = { ...makeLabel(text, font, true, s.x, s.y, 'middle'), inside: true };
    }
    return { width: W, height: H, positions, labels, people: chosen.map((p) => p.id), labelScale: k };
  };

  for (let count = Math.min(given.length, 2 * rowsMax); ; count--) {
    let chosen = given.slice(0, count);
    const keep = given.find((p) => p.id === options.keep);
    if (keep && count > 0 && !chosen.includes(keep)) chosen = [...given.slice(0, count - 1), keep];
    const layout = attempt(chosen, count <= 0);
    if (layout) return layout;
  }
}
