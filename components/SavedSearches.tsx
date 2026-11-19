// components/SavedSearches.tsx
//
// Save the Recommender's current criteria (and "Strict title-only") under a
// title, list the saved searches and re-run one with a click (#53). Stored in
// users/{uid}/savedSearches via lib/savedItems.ts.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useShell } from './AppShell';
import { useAuth } from '../lib/AuthContext';
import {
  SAVED_SEARCH_CRITERIA_MAX,
  SAVED_SEARCH_LIMIT,
  SAVED_SEARCH_TITLE_MAX,
  deleteSavedSearch,
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
  showForm?: boolean;
  showList?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
};

export const SavedSearches: React.FC<Props> = ({
  criteria,
  strictTitleOnly,
  canRun,
  busy,
  onRun,
  showForm = true,
  showList = true,
  onSaved,
  onCancel,
}) => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const { saved: items, setSaved: setItems, savedLoading: loading, savedError, announce } = useShell();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (showForm) {
      setTitle(criteria.trim().slice(0, SAVED_SEARCH_TITLE_MAX));
      setNotice('');
    }
  }, [showForm]);
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const trimmedCriteria = criteria.trim();
  const atCap = items.length >= SAVED_SEARCH_LIMIT;
  const canSave = !!uid && !saving && !!title.trim() && !!trimmedCriteria && !atCap;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    const owner = uid;
    setSaving(true);
    setNotice('');
    try {
      const saved = await saveSearch({ title, criteria, strictTitleOnly });
      if (uidRef.current !== owner) return;
      setItems((prev) => [saved, ...prev]);
      setTitle('');
      announce(`Saved “${saved.title}”.`);
      onSaved?.();
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
    try {
      await deleteSavedSearch(item.id);
      if (uidRef.current === owner) {
        setItems((prev) => prev.filter((s) => s.id !== item.id));
        announce(`Deleted “${item.title}”.`, async () => {
          if (uidRef.current !== owner) return;
          const restored = await saveSearch(item);
          if (uidRef.current !== owner) return;
          setItems((prev) => [restored, ...prev]);
          announce(`Restored “${item.title}”.`);
        });
      }
    } catch (err: any) {
      if (uidRef.current === owner) setNotice(err?.message ?? 'Could not delete the saved search.');
    } finally {
      setDeleting((d) => ({ ...d, [item.id]: false }));
    }
  }

  const saveHint = !trimmedCriteria
    ? 'Enter a search above to save this search.'
    : trimmedCriteria.length > SAVED_SEARCH_CRITERIA_MAX
      ? `Criteria longer than ${SAVED_SEARCH_CRITERIA_MAX} characters cannot be saved.`
      : atCap
        ? `You have ${SAVED_SEARCH_LIMIT} saved searches (the limit). Delete one to save another.`
        : '';

  return (
    <div>
      {showForm && (
        <form
          className="save-search-form"
          onSubmit={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel?.();
            }
          }}
        >
          <div className="field">
            <label htmlFor="saved-search-title">Title for this search</label>
            <input
              autoFocus
              className="input"
              id="saved-search-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={SAVED_SEARCH_TITLE_MAX}
              disabled={!uid}
            />
          </div>
          <button
            className="btn primary"
            disabled={!canSave || trimmedCriteria.length > SAVED_SEARCH_CRITERIA_MAX}
          >
            {saving ? 'Saving…' : 'Save search'}
          </button>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          {saveHint && <p className="hint">{saveHint}</p>}
        </form>
      )}
      {(notice || savedError) && (
        <p className="note warn" role="alert">
          {notice || savedError}
        </p>
      )}
      {showList &&
        (loading ? (
          <p className="zero" role="status">
            Loading saved searches…
          </p>
        ) : !items.length ? (
          <div className="zero">
            <h3>No saved searches yet</h3>
            <p>Search for something you look for often, then use the bookmark beside Search.</p>
          </div>
        ) : (
          <ul>
            {items.map((s) => (
              <li className="saved-row" key={s.id}>
                <span className="t">
                  <b>{s.title}</b>
                  <span className="mono muted">
                    {s.criteria}
                    {s.strictTitleOnly ? ' · title matches only' : ''}
                  </span>
                </span>
                <button
                  className="btn sm"
                  onClick={() => onRun(s.criteria, s.strictTitleOnly)}
                  disabled={!canRun || busy}
                >
                  Run
                </button>
                <button
                  className="icon-btn"
                  disabled={!!deleting[s.id]}
                  onClick={() => void handleDelete(s)}
                  aria-label={`Delete saved search ${s.title}`}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
};
