// lib/networkGraph.ts
//
// Opt-in, cross-user "common connections" graph in Firestore:
//   graph_members/{uid}         { displayName, updatedAt }  existence = opted in
//   graph_people/{personKey}    { members: uid[], updatedAt }
//
// personKey = sha256 hex of 'url:' + normalizeProfileUrl(<the row's URL>). Only
// rows with a valid linkedin.com/in/ URL take part (no name fallback). The
// shared graph holds no names, titles, companies, notes or any other person
// data: names shown in the UI always come from the viewer's OWN connections.
//
// firestore.rules let a client read a node only when its own uid is on it, and
// add or remove only its own uid (see test.graph.rules.mjs in local/rules-tests).
//
// Graph writes are serialized per uid on their own chain, separate from
// connectionsStore's write chain, so loadConnections never waits for a sync.

import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { URL_KEYS, getField } from './connectionFields.ts';
import { normalizeProfileUrl } from './linkedinExport.ts';

/** Spark free tier allows 20k writes/day; one user's sync stays well under it. */
export const MAX_GRAPH_KEYS = 5000;

/** Fallback when the user has no display name (never the email). */
export const DEFAULT_GRAPH_NAME = 'A member';

const MAX_NAME_LEN = 80;
const BATCH_LIMIT = 400;
const PEOPLE = 'graph_people';
const MEMBERS = 'graph_members';

export type GraphSyncResult = {
  added: number;
  removed: number;
  kept: number;
  /** Rows without a valid linkedin.com/in/ profile URL (not shared). */
  skippedNoUrl: number;
  /** Distinct profile keys beyond MAX_GRAPH_KEYS (not shared). */
  capped: number;
};

export type CommonMember = {
  uid: string;
  displayName: string;
  /** personKeys this member shares with the viewer. */
  personKeys: string[];
};

export type CommonConnections = {
  /** Number of graph_people nodes the viewer is recorded on. */
  myNodeCount: number;
  /** personKey -> uids of other (still opted-in) members who also have that person. */
  othersByPerson: Map<string, string[]>;
  /** Other members, most shared connections first. */
  members: CommonMember[];
};

async function sha256Hex(s: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Graph key for a connection row, or null when it has no valid profile URL. */
export async function personKeyFor(row: Record<string, unknown>): Promise<string | null> {
  const url = normalizeProfileUrl(getField(row, URL_KEYS));
  return url ? sha256Hex(`url:${url}`) : null;
}

/** 1..80 chars; falls back to DEFAULT_GRAPH_NAME. */
export function cleanGraphName(name: string | null | undefined): string {
  const t = (typeof name === 'string' ? name : '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN).trim();
  return t || DEFAULT_GRAPH_NAME;
}

/**
 * users/{uid}.displayName, else the Firebase auth displayName, else
 * DEFAULT_GRAPH_NAME. Never the email.
 */
export async function resolveGraphDisplayName(uid: string): Promise<string> {
  let profileName: unknown = null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    profileName = snap.exists() ? snap.get('displayName') : null;
  } catch {
    // Fall through to the auth name.
  }
  if (typeof profileName === 'string' && profileName.trim()) return cleanGraphName(profileName);

  const authName = auth.currentUser?.uid === uid ? auth.currentUser.displayName : null;
  return cleanGraphName(authName);
}

// -----------------------------
// Per-uid write chain (graph only)
// -----------------------------

const graphChains = new Map<string, Promise<unknown>>();

function enqueueGraph<T>(uid: string, task: () => Promise<T>): Promise<T> {
  const previous = graphChains.get(uid) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  graphChains.set(uid, run);
  void run.catch(() => undefined).then(() => {
    if (graphChains.get(uid) === run) graphChains.delete(uid);
  });
  return run;
}

function assertSignedInAs(uid: string): void {
  if (auth.currentUser?.uid !== uid) throw new Error('Not signed in as this user.');
}

async function myNodeIds(uid: string): Promise<string[]> {
  const snap = await getDocs(query(collection(db, PEOPLE), where('members', 'array-contains', uid)));
  return snap.docs.map((d) => d.id);
}

async function commitChunked(ops: ((b: ReturnType<typeof writeBatch>) => void)[]): Promise<void> {
  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
    await batch.commit();
  }
}

// -----------------------------
// Public API
// -----------------------------

export async function isGraphMember(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, MEMBERS, uid));
  return snap.exists();
}

async function syncNow(uid: string, rows: Record<string, unknown>[]): Promise<GraphSyncResult> {
  assertSignedInAs(uid);

  // Desired keys, de-duplicated, in row order.
  const keys = await Promise.all(rows.map((r) => personKeyFor(r)));
  let skippedNoUrl = 0;
  const distinct: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (!k) {
      skippedNoUrl++;
      continue;
    }
    if (!seen.has(k)) {
      seen.add(k);
      distinct.push(k);
    }
  }
  const desired = new Set(distinct.slice(0, MAX_GRAPH_KEYS));
  const capped = Math.max(0, distinct.length - MAX_GRAPH_KEYS);

  const current = new Set(await myNodeIds(uid));
  assertSignedInAs(uid);

  const toAdd = [...desired].filter((k) => !current.has(k));
  const toRemove = [...current].filter((k) => !desired.has(k));
  const kept = desired.size - toAdd.length;

  await commitChunked([
    ...toAdd.map((k) => (b: ReturnType<typeof writeBatch>) =>
      b.set(doc(db, PEOPLE, k), { members: arrayUnion(uid), updatedAt: serverTimestamp() }, { merge: true })
    ),
    ...toRemove.map((k) => (b: ReturnType<typeof writeBatch>) =>
      b.update(doc(db, PEOPLE, k), { members: arrayRemove(uid), updatedAt: serverTimestamp() })
    ),
  ]);

  return { added: toAdd.length, removed: toRemove.length, kept, skippedNoUrl, capped };
}

/**
 * Makes the user's graph memberships match `rows` (first MAX_GRAPH_KEYS
 * distinct profile keys, in row order). Unchanged keys cost no writes.
 * Caller must already be a graph member (the rules reject creates otherwise).
 */
export function syncNetworkGraph(uid: string, rows: Record<string, unknown>[]): Promise<GraphSyncResult> {
  return enqueueGraph(uid, () => syncNow(uid, rows));
}

/**
 * Called after saveConnections: syncs only if the user opted in. Resolves to
 * null when they have not. The membership check runs on the graph chain too,
 * so it sees the result of an in-flight join/leave.
 */
export function syncNetworkGraphIfMember(
  uid: string,
  rows: Record<string, unknown>[]
): Promise<GraphSyncResult | null> {
  return enqueueGraph(uid, async () => {
    if (auth.currentUser?.uid !== uid) return null;
    if (!(await isGraphMember(uid))) return null;
    return syncNow(uid, rows);
  });
}

/** Writes the opt-in doc, then syncs `rows`. */
export function joinGraph(
  uid: string,
  displayName: string,
  rows: Record<string, unknown>[]
): Promise<GraphSyncResult> {
  return enqueueGraph(uid, async () => {
    assertSignedInAs(uid);
    await setDoc(doc(db, MEMBERS, uid), {
      displayName: cleanGraphName(displayName),
      updatedAt: serverTimestamp(),
    });
    return syncNow(uid, rows);
  });
}

/** Removes the uid from every node it is on, then deletes the opt-in doc. Returns nodes left. */
export function leaveGraph(uid: string): Promise<number> {
  return enqueueGraph(uid, async () => {
    assertSignedInAs(uid);
    const ids = await myNodeIds(uid);
    await commitChunked(
      ids.map((k) => (b: ReturnType<typeof writeBatch>) =>
        b.update(doc(db, PEOPLE, k), { members: arrayRemove(uid), updatedAt: serverTimestamp() })
      )
    );
    await deleteDoc(doc(db, MEMBERS, uid));
    return ids.length;
  });
}

/**
 * The viewer's nodes and, per node, the other members on it; per other member
 * the shared keys and their display name. Members whose graph_members doc is
 * gone (they left) or unreadable are skipped everywhere.
 */
export async function loadCommonConnections(uid: string): Promise<CommonConnections> {
  const snap = await getDocs(query(collection(db, PEOPLE), where('members', 'array-contains', uid)));

  const keysByMember = new Map<string, string[]>();
  for (const d of snap.docs) {
    const members = d.get('members');
    if (!Array.isArray(members)) continue;
    for (const m of new Set(members)) {
      if (typeof m !== 'string' || m === uid) continue;
      const list = keysByMember.get(m);
      if (list) list.push(d.id);
      else keysByMember.set(m, [d.id]);
    }
  }

  const otherUids = [...keysByMember.keys()];
  const names = new Map<string, string>();
  const CONCURRENCY = 25;
  for (let i = 0; i < otherUids.length; i += CONCURRENCY) {
    await Promise.all(
      otherUids.slice(i, i + CONCURRENCY).map(async (other) => {
        try {
          const m = await getDoc(doc(db, MEMBERS, other));
          if (m.exists()) names.set(other, cleanGraphName(m.get('displayName')));
        } catch {
          // Unreadable: treat like a member who left.
        }
      })
    );
  }

  const members: CommonMember[] = [];
  const othersByPerson = new Map<string, string[]>();
  for (const [other, personKeys] of keysByMember) {
    const displayName = names.get(other);
    if (displayName === undefined) continue;
    members.push({ uid: other, displayName, personKeys });
    for (const k of personKeys) {
      const list = othersByPerson.get(k);
      if (list) list.push(other);
      else othersByPerson.set(k, [other]);
    }
  }
  members.sort(
    (a, b) => b.personKeys.length - a.personKeys.length || a.displayName.localeCompare(b.displayName)
  );

  return { myNodeCount: snap.size, othersByPerson, members };
}
