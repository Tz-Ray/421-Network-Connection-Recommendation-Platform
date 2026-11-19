// components/FavoritesList.tsx
//
// "Saved Connections" panel (#53): the connections the user starred on the
// Recommender's result cards (users/{uid}/favorites, lib/savedItems.ts). The
// list state lives in RecommenderScreen, which also owns the star toggles.
import React from 'react';
import { Icon } from './Icon';
import type { Favorite } from '../lib/savedItems';

type Props = {
  favorites: Favorite[];
  selectedId?: string;
  loading: boolean;
  /** Load / toggle failure, shown as a notice. */
  notice: string;
  /** candidateId -> a remove is in flight. */
  busy: Record<string, boolean>;
  onRemove: (fav: Favorite) => void;
  onOpen: (fav: Favorite) => void;
};

/** An http(s) link for a stored URL cell, or null (never a javascript:/data: URL). */
export function profileHref(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.)?([a-z]{2}\.)?linkedin\.com\//i.test(t)) return `https://${t}`;
  return null;
}

export const FavoritesList: React.FC<Props> = ({
  favorites,
  selectedId,
  loading,
  notice,
  busy,
  onRemove,
  onOpen,
}) => (
  <div>
    {notice && (
      <p className="note warn" role="alert">
        {notice}
      </p>
    )}
    {loading ? (
      <p className="zero" role="status">
        Loading saved people…
      </p>
    ) : !favorites.length ? (
      <div className="zero">
        <h3>No saved people yet</h3>
        <p>Use the star on any result to keep someone here, across searches and sessions.</p>
      </div>
    ) : (
      <ul>
        {favorites.map((f) => (
          <li key={f.id} className={`saved-row ${selectedId === f.id ? 'is-sel' : ''}`}>
            <span className="t">
              <b>{f.name || '(no name)'}</b>
              <span className="tc">{[f.position, f.company].filter(Boolean).join(' · ')}</span>
            </span>
            <button
              className="btn sm"
              aria-label={`Open ${f.name || 'unnamed person'}`}
              aria-current={selectedId === f.id ? 'true' : undefined}
              onClick={() => onOpen(f)}
            >
              Open
            </button>
            <button
              className="icon-btn star"
              data-testid="star"
              aria-pressed="true"
              aria-label={`Remove ${f.name} from saved people`}
              disabled={!!busy[f.id]}
              onClick={() => onRemove(f)}
            >
              <Icon name="star" />
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
);
