import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { SESSION_KEY, docToCompact, loadConnections, type CompactConnection } from '../lib/connectionsStore';
import { useAiAvailability } from '../lib/proxyClient';
import { setTheme, useTheme, type Theme } from '../lib/theme';
import { NAV_ITEMS, useShell } from './AppShell';
import { Icon } from './Icon';
import { compactIdParts, personIds } from '../lib/presentation';

let peopleCache: { uid: string; promise: Promise<CompactConnection[]> } | null = null;
window.addEventListener('ncrp-sign-out', () => {
  peopleCache = null;
});
window.addEventListener('ncrp-dataset-changed', () => {
  peopleCache = null;
});
function peopleFor(uid: string) {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const rows = JSON.parse(raw);
      if (Array.isArray(rows)) return Promise.resolve(rows as CompactConnection[]);
    }
  } catch {
    /* Fall back to the account. */
  }
  if (peopleCache?.uid !== uid)
    peopleCache = {
      uid,
      promise: loadConnections(uid)
        .then((ds) => ds.map(docToCompact))
        .catch(() => []),
    };
  return peopleCache.promise;
}
type Command = { group: string; label: string; icon: string; hint?: string; run: () => void };
export function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const shell = useShell();
  const navigate = useNavigate();
  const location = useLocation();
  const ai = useAiAvailability();
  const theme = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [people, setPeople] = useState<CompactConnection[]>([]);
  const peopleIds = useMemo(
    () => new Map(personIds(people, compactIdParts).map((id, i) => [people[i], id])),
    [people],
  );
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      return;
    }
    returnFocus.current = document.activeElement as HTMLElement;
    setQuery('');
    setActive(0);
    dialog.current?.showModal();
    input.current?.focus();
    const uid = auth.currentUser?.uid;
    let active = true;
    if (uid)
      void peopleFor(uid).then((rows) => {
        if (active && auth.currentUser?.uid === uid) setPeople(rows);
      });
    return () => {
      active = false;
      dialog.current?.close();
      returnFocus.current?.focus();
    };
  }, [open]);
  const q = query.trim();
  const matches = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const commands: Command[] = [];
  [...NAV_ITEMS, { path: '/profile', label: 'Profile', icon: 'user' }]
    .filter((n) => matches(n.label))
    .forEach((n) =>
      commands.push({ group: 'Go to', label: n.label, icon: n.icon, run: () => navigate(n.path) }),
    );
  if (q)
    people
      .filter((p) => matches(p.name || ''))
      .slice(0, 6)
      .forEach((p) =>
        commands.push({
          group: 'People',
          label: p.name,
          hint: [p.position, p.company].filter(Boolean).join(' · '),
          icon: 'user',
          run: () => navigate(`/connections?person=${encodeURIComponent(peopleIds.get(p)!)}`),
        }),
      );
  shell.saved
    .filter((s) => matches(`${s.title} ${s.criteria}`))
    .forEach((s) =>
      commands.push({
        group: 'Saved searches',
        label: s.title,
        hint: s.criteria,
        icon: 'bookmark',
        run: () =>
          navigate('/recommender', {
            state: { runSearch: { criteria: s.criteria, strictTitleOnly: s.strictTitleOnly } },
          }),
      }),
    );
  const actions: Command[] = [
    {
      group: 'Actions',
      label: 'Import connections',
      icon: 'upload',
      run: () => navigate('/recommender', { state: { importConnections: true } }),
    },
  ];
  if (location.pathname === '/recommender') {
    const on = document.getElementById('semantic-switch')?.getAttribute('aria-checked') === 'true';
    actions.push({
      group: 'Actions',
      label: `Turn meaning-based search ${on ? 'off' : 'on'}`,
      icon: 'search',
      run: () => document.getElementById('semantic-switch')?.click(),
    });
  }
  (['light', 'dark', 'system'] as Theme[]).forEach((t) =>
    actions.push({
      group: 'Actions',
      label: `Theme: ${t}`,
      icon: t === 'dark' ? 'moon' : t === 'system' ? 'monitor' : 'sun',
      hint: theme === t ? 'Current ✓' : undefined,
      run: () => setTheme(t),
    }),
  );
  actions.push({
    group: 'Actions',
    label: 'Sign out',
    icon: 'out',
    run: () => {
      void shell.logout();
    },
  });
  commands.push(...actions.filter((a) => matches(a.label)));
  if (q)
    commands.push({
      group: 'Search for',
      label: `Search for “${q}”`,
      icon: 'search',
      run: () => navigate('/recommender', { state: { runSearch: { criteria: q, strictTitleOnly: false } } }),
    });
  if (q && !ai.disabled)
    commands.push({
      group: 'Search for',
      label: `Ask the assistant “${q}”`,
      icon: 'chat',
      run: () => navigate('/ai', { state: { ask: q } }),
    });
  const selected = Math.min(active, Math.max(0, commands.length - 1));
  useEffect(() => {
    document.getElementById(`command-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, query]);
  function run(i: number) {
    const c = commands[i];
    onClose();
    c?.run();
  }
  return (
    <dialog
      ref={dialog}
      className="cmdk"
      role="dialog"
      aria-modal="true"
      aria-label="Command bar"
      data-testid="command-bar"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          const targets = dialog.current?.querySelectorAll<HTMLElement>('input,button');
          if (!targets?.length) return;
          const first = targets[0],
            last = targets[targets.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div className="cmdk-in">
        <Icon name="search" />
        <input
          ref={input}
          data-testid="command-input"
          role="combobox"
          aria-expanded={open}
          aria-controls="command-list"
          aria-autocomplete="list"
          aria-activedescendant={commands.length ? `command-${selected}` : undefined}
          aria-label="Search people, or jump to a screen"
          placeholder="Search or jump to…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(
                (selected + (e.key === 'ArrowDown' ? 1 : -1) + commands.length) %
                  Math.max(1, commands.length),
              );
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(selected);
            }
          }}
        />
        <button className="btn sm" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="cmdk-list" role="listbox" id="command-list" aria-label="Commands">
        {Array.from(new Set(commands.map((c) => c.group))).map((group, groupIndex) => (
          <div role="group" aria-labelledby={`command-group-${groupIndex}`} key={group}>
            <div className="cmdk-g" id={`command-group-${groupIndex}`}>
              {group}
            </div>
            {commands.map((c, i) =>
              c.group !== group ? null : (
                <div
                  key={i}
                  id={`command-${i}`}
                  role="option"
                  aria-selected={selected === i}
                  aria-labelledby={`command-label-${i}`}
                  aria-describedby={c.hint ? `command-hint-${i}` : undefined}
                  className="cmdk-o"
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(i)}
                >
                  <Icon name={c.icon} />
                  <span id={`command-label-${i}`}>{c.label}</span>
                  {c.hint && (
                    <span className="h" id={`command-hint-${i}`}>
                      {c.hint}
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="cmdk-foot keys-legend">
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>Enter</kbd> run
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </dialog>
  );
}
