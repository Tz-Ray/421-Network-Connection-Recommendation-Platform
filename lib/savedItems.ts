// lib/savedItems.ts
//
// Saved searches and favorite connections for the signed-in user (#53):
//   users/{uid}/savedSearches/{autoId}   { title, criteria, strictTitleOnly, createdAt }
//   users/{uid}/favorites/{candidateId}  { name, position, company, url, savedAt }
// Both are create / delete only (firestore.rules has no update rule); the
// field limits below mirror the rules. A favorite's id is candidateIdFor(row),
// the same id ranking feedback uses.

import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  type DocumentData,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  COMPANY_KEYS,
  FIRST_NAME_KEYS,
  FULL_NAME_KEYS,
  LAST_NAME_KEYS,
  POSITION_KEYS,
  URL_KEYS,
  getField,
} from './connectionFields.ts';

/** Client-side cap on saved searches per user. */
export const SAVED_SEARCH_LIMIT = 50;
export const SAVED_SEARCH_TITLE_MAX = 80;
export const SAVED_SEARCH_CRITERIA_MAX = 500;

const FAVORITE_LIMITS = { name: 200, position: 300, company: 200, url: 500 } as const;

export type SavedSearch = {
  id: string;
  title: string;
  criteria: string;
  strictTitleOnly: boolean;
  createdAt: Date | null;
};

export type Favorite = {
  id: string; // candidateId
  name: string;
  position: string;
  company: string;
  url: string;
  savedAt: Date | null;
};

function requireUid(action: string): string {
  const user = auth.currentUser;
  if (!user) throw new Error(`Sign in to ${action}.`);
  return user.uid;
}

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
// A missing date (a write still pending on the server) sorts first.
const newestFirst = (a: Date | null, b: Date | null) =>
  a && b ? b.getTime() - a.getTime() : a ? 1 : b ? -1 : 0;

// -----------------------------
// Saved searches
// -----------------------------

function toSavedSearch(id: string, d: DocumentData): SavedSearch | null {
  if (typeof d.title !== 'string' || typeof d.criteria !== 'string') return null;
  return {
    id,
    title: d.title,
    criteria: d.criteria,
    strictTitleOnly: d.strictTitleOnly === true,
    createdAt: toDate(d.createdAt),
  };
}

/** The user's saved searches, newest first. */
export async function listSavedSearches(): Promise<SavedSearch[]> {
  const uid = requireUid('see your saved searches');
  const snap = await getDocs(collection(db, 'users', uid, 'savedSearches'));
  return snap.docs
    .map((d) => toSavedSearch(d.id, d.data()))
    .filter((s): s is SavedSearch => s !== null)
    .sort((a, b) => newestFirst(a.createdAt, b.createdAt));
}

/** Saves a search; throws a user-facing Error on bad input or when the cap is reached. */
export async function saveSearch(input: {
  title: string;
  criteria: string;
  strictTitleOnly: boolean;
}): Promise<SavedSearch> {
  const uid = requireUid('save searches');
  const title = input.title.trim();
  const criteria = input.criteria.trim();
  if (!title) throw new Error('Give the search a title.');
  if (title.length > SAVED_SEARCH_TITLE_MAX) {
    throw new Error(`Titles can be at most ${SAVED_SEARCH_TITLE_MAX} characters.`);
  }
  if (!criteria) throw new Error('Enter criteria before saving a search.');
  if (criteria.length > SAVED_SEARCH_CRITERIA_MAX) {
    throw new Error(`Criteria can be at most ${SAVED_SEARCH_CRITERIA_MAX} characters to be saved.`);
  }

  const col = collection(db, 'users', uid, 'savedSearches');
  const existing = await getDocs(col);
  if (existing.size >= SAVED_SEARCH_LIMIT) {
    throw new Error(`You can keep up to ${SAVED_SEARCH_LIMIT} saved searches. Delete one to save another.`);
  }

  const ref = doc(col);
  await setDoc(ref, { title, criteria, strictTitleOnly: input.strictTitleOnly === true, createdAt: serverTimestamp() });
  return { id: ref.id, title, criteria, strictTitleOnly: input.strictTitleOnly === true, createdAt: new Date() };
}

export async function deleteSavedSearch(id: string): Promise<void> {
  const uid = requireUid('delete saved searches');
  await deleteDoc(doc(db, 'users', uid, 'savedSearches', id));
}

// -----------------------------
// Favorites ("Saved Connections")
// -----------------------------

function toFavorite(id: string, d: DocumentData): Favorite {
  return {
    id,
    name: str(d.name),
    position: str(d.position),
    company: str(d.company),
    url: str(d.url),
    savedAt: toDate(d.savedAt),
  };
}

/** The display fields stored for a favorite, clipped to the rule limits. */
export function favoriteFieldsFor(row: Record<string, unknown>) {
  const name =
    getField(row, FULL_NAME_KEYS) || `${getField(row, FIRST_NAME_KEYS)} ${getField(row, LAST_NAME_KEYS)}`.trim();
  return {
    name: name.trim().slice(0, FAVORITE_LIMITS.name),
    position: getField(row, POSITION_KEYS).trim().slice(0, FAVORITE_LIMITS.position),
    company: getField(row, COMPANY_KEYS).trim().slice(0, FAVORITE_LIMITS.company),
    url: getField(row, URL_KEYS).trim().slice(0, FAVORITE_LIMITS.url),
  };
}

/** The user's favorite connections, newest first. */
export async function listFavorites(): Promise<Favorite[]> {
  const uid = requireUid('see your saved connections');
  const snap = await getDocs(collection(db, 'users', uid, 'favorites'));
  return snap.docs.map((d) => toFavorite(d.id, d.data())).sort((a, b) => newestFirst(a.savedAt, b.savedAt));
}

/** Adds a favorite under `candidateId` (64 hex chars, from candidateIdFor). */
export async function addFavorite(candidateId: string, row: Record<string, unknown>): Promise<Favorite> {
  const uid = requireUid('save connections');
  if (!/^[0-9a-f]{64}$/.test(candidateId)) throw new Error('Could not identify this connection.');
  const ref = doc(db, 'users', uid, 'favorites', candidateId);
  const fields = favoriteFieldsFor(row);
  try {
    await setDoc(ref, { ...fields, savedAt: serverTimestamp() });
  } catch (e) {
    // There is no update rule, so re-saving an existing favorite (e.g. saved in
    // another tab) is refused: treat an existing doc as success.
    const snap = await getDoc(ref).catch(() => null);
    if (snap?.exists()) return toFavorite(snap.id, snap.data());
    throw e;
  }
  return { id: candidateId, ...fields, savedAt: new Date() };
}

export async function removeFavorite(candidateId: string): Promise<void> {
  const uid = requireUid('remove saved connections');
  await deleteDoc(doc(db, 'users', uid, 'favorites', candidateId));
}
