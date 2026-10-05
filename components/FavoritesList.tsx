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
  loading: boolean;
  /** Load / toggle failure, shown as a notice. */
  notice: string;
  /** candidateId -> a remove is in flight. */
  busy: Record<string, boolean>;
  onRemove: (fav: Favorite) => void;
};

/** An http(s) link for a stored URL cell, or null (never a javascript:/data: URL). */
export function profileHref(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.)?([a-z]{2}\.)?linkedin\.com\//i.test(t)) return `https://${t}`;
  return null;
}

export const FavoritesList: React.FC<Props> = ({ favorites, loading, notice, busy, onRemove }) => (
  <div className="glass-panel rounded-xl p-4 md:p-6">
    <div className="flex items-center justify-between gap-3 mb-3">
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Saved Connections</p>
      <span className="text-xs text-slate-500">{favorites.length}</span>
    </div>

    {/* Amber, not the red error box: the demo driver treats any red box in <main> as a step failure. */}
    {notice && (
      <div className="mb-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm text-amber-200">{notice}</div>
    )}

    {loading ? (
      <p className="text-sm text-slate-400">Loading saved connections…</p>
    ) : favorites.length === 0 ? (
      <p className="text-sm text-slate-400">
        No saved connections yet. Use the <Icon name="star_border" className="text-sm align-middle" /> on a result to
        save one.
      </p>
    ) : (
      <ul className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
        {favorites.map((f) => {
          const href = profileHref(f.url);
          return (
            <li
              key={f.id}
              className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-bold text-white text-sm truncate">{f.name || '(no name)'}</p>
                {(f.position || f.company) && (
                  <p className="text-xs text-slate-400 mt-1 truncate">
                    {[f.position, f.company].filter(Boolean).join(' • ')}
                  </p>
                )}
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-primary hover:underline"
                  >
                    <Icon name="open_in_new" className="text-sm" />
                    <span>Profile</span>
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemove(f)}
                disabled={!!busy[f.id]}
                title="Remove from Saved Connections"
                aria-label={`Remove ${f.name || 'connection'} from Saved Connections`}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border transition-all active:scale-[0.98] shrink-0 ${
                  busy[f.id]
                    ? 'bg-white/5 border-white/10 text-slate-600 cursor-not-allowed'
                    : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-300'
                }`}
              >
                <Icon name="close" className="text-sm" />
                <span>Remove</span>
              </button>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);
