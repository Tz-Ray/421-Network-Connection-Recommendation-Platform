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
