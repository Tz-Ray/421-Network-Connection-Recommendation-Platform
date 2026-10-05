// components/SavedSearches.tsx
//
// Save the Recommender's current criteria (and "Strict title-only") under a
// title, list the saved searches and re-run one with a click (#53). Stored in
// users/{uid}/savedSearches via lib/savedItems.ts.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useAuth } from '../lib/AuthContext';
import {
  SAVED_SEARCH_CRITERIA_MAX,
  SAVED_SEARCH_LIMIT,
  SAVED_SEARCH_TITLE_MAX,
  deleteSavedSearch,
  listSavedSearches,
  saveSearch,
} from '../lib/savedItems';
import type { SavedSearch } from '../lib/savedItems';

type Props = {
  /** The criteria currently in the Recommender's textarea. */
  criteria: string;
  strictTitleOnly: boolean;
  /** A dataset is confirmed, so a saved search can run. */
  canRun: boolean;
  /** A search or AI rerank is in flight. */
  busy: boolean;
  onRun: (criteria: string, strictTitleOnly: boolean) => void;
};

// Amber, not the red error box: the demo driver treats any red box in <main> as a step failure.
const NOTICE = 'bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-200';

export const SavedSearches: React.FC<Props> = ({ criteria, strictTitleOnly, canRun, busy, onRun }) => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [items, setItems] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState('');
  const [info, setInfo] = useState('');
  const uidRef = useRef(uid);
  uidRef.current = uid;

  useEffect(() => {
    setItems([]);
    setNotice('');
    setInfo('');
    if (!uid) return;
    let cancelled = false;
    setLoading(true);
    listSavedSearches()
      .then((list) => { if (!cancelled) setItems(list); })
      .catch((e: any) => { if (!cancelled) setNotice(`Saved searches could not be loaded: ${e?.message ?? 'unknown error'}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uid]);

  const trimmedCriteria = criteria.trim();
  const atCap = items.length >= SAVED_SEARCH_LIMIT;
  const canSave = !!uid && !saving && !!title.trim() && !!trimmedCriteria && !atCap;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const owner = uid;
    setSaving(true);
    setNotice('');
    setInfo('');
    try {
      const saved = await saveSearch({ title, criteria, strictTitleOnly });
      if (uidRef.current !== owner) return;
      setItems((prev) => [saved, ...prev]);
      setTitle('');
      setInfo(`Saved “${saved.title}”.`);
    } catch (err: any) {
      if (uidRef.current === owner) setNotice(err?.message ?? 'Could not save the search.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(item: SavedSearch) {
    if (deleting[item.id]) return;
    const owner = uid;
    setDeleting((d) => ({ ...d, [item.id]: true }));
    setNotice('');
    setInfo('');
    try {
      await deleteSavedSearch(item.id);
      if (uidRef.current === owner) setItems((prev) => prev.filter((s) => s.id !== item.id));
    } catch (err: any) {
      if (uidRef.current === owner) setNotice(err?.message ?? 'Could not delete the saved search.');
    } finally {
      setDeleting((d) => ({ ...d, [item.id]: false }));
    }
  }

  const saveHint = !trimmedCriteria
    ? 'Enter criteria above to save this search.'
    : trimmedCriteria.length > SAVED_SEARCH_CRITERIA_MAX
      ? `Criteria longer than ${SAVED_SEARCH_CRITERIA_MAX} characters cannot be saved.`
      : atCap
        ? `You have ${SAVED_SEARCH_LIMIT} saved searches (the limit). Delete one to save another.`
        : '';

  return (
    <div className="glass-panel rounded-xl p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Saved Searches</p>
        <span className="text-xs text-slate-500">
          {items.length} / {SAVED_SEARCH_LIMIT}
        </span>
      </div>

      <form onSubmit={handleSave} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={SAVED_SEARCH_TITLE_MAX}
          placeholder="Title for the current search"
          aria-label="Saved search title"
          className="flex-1 min-w-0 mac-input rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          disabled={!uid}
        />
        <button
          type="submit"
          disabled={!canSave || trimmedCriteria.length > SAVED_SEARCH_CRITERIA_MAX}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-bold transition-all active:scale-[0.98] ${
            canSave && trimmedCriteria.length <= SAVED_SEARCH_CRITERIA_MAX
              ? 'bg-primary hover:bg-primary/90 text-white'
              : 'bg-white/5 text-slate-600 border border-white/10 cursor-not-allowed'
          }`}
        >
          <Icon name="bookmark_add" className="text-sm" />
          <span>{saving ? 'Saving…' : 'Save search'}</span>
        </button>
      </form>
      {saveHint && <p className="mt-2 text-xs text-slate-500">{saveHint}</p>}
      {trimmedCriteria && !saveHint && (
        <p className="mt-2 text-xs text-slate-500 truncate">
          Saves “{trimmedCriteria}”{strictTitleOnly ? ' with Strict title-only' : ''}.
        </p>
      )}

      {notice && <div className={`mt-3 ${NOTICE}`}>{notice}</div>}
      {info && (
        <div className="mt-3 bg-primary/10 border border-primary/20 rounded-lg p-3 text-sm text-slate-200">{info}</div>
      )}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-slate-400">Loading saved searches…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400">No saved searches yet.</p>
        ) : (
          <>
            {!canRun && (
              <p className="mb-2 text-xs text-slate-500">Confirm a set of connections to run a saved search.</p>
            )}
            <ul className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
              {items.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-white text-sm truncate">{s.title}</p>
                    <p className="text-xs text-slate-400 mt-1 truncate" title={s.criteria}>
                      {s.criteria}
                    </p>
                    {s.strictTitleOnly && (
                      <span className="inline-block mt-2 text-[11px] px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-primary">
                        Strict title-only
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onRun(s.criteria, s.strictTitleOnly)}
                      disabled={!canRun || busy}
                      title={
                        !canRun
                          ? 'Confirm a set of connections first'
                          : busy
                            ? 'Wait for the current search to finish'
                            : `Run “${s.title}”`
                      }
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border transition-all active:scale-[0.98] ${
                        canRun && !busy
                          ? 'bg-primary/15 hover:bg-primary/25 border-primary/30 text-primary'
                          : 'bg-white/5 border-white/10 text-slate-600 cursor-not-allowed'
                      }`}
                    >
                      <Icon name="play_arrow" className="text-sm" />
                      <span>Run</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(s)}
                      disabled={!!deleting[s.id]}
                      title={`Delete “${s.title}”`}
                      aria-label={`Delete saved search ${s.title}`}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border transition-all active:scale-[0.98] ${
                        deleting[s.id]
                          ? 'bg-white/5 border-white/10 text-slate-600 cursor-not-allowed'
                          : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                      }`}
                    >
                      <Icon name="delete" className="text-sm" outlined />
                      <span>Delete</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};
