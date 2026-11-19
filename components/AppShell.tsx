import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, NavLink, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { collection, doc, getCountFromServer, getDoc } from 'firebase/firestore';
import { auth, db, describeAuthError } from '../firebase';
import { useAuth } from '../lib/AuthContext';
import { listSavedSearches, type SavedSearch } from '../lib/savedItems';
import { setConversationOwner } from '../lib/assistantSession';
import { signOutOfAccount } from '../lib/session';
import { setTheme, useTheme } from '../lib/theme';
import { initials } from '../lib/presentation';
import { Icon } from './Icon';
import { CommandBar } from './CommandBar';

export const NAV_ITEMS = [
  { path: '/dashboard', label: 'Home', icon: 'home', test: 'home' },
  { path: '/recommender', label: 'Search', icon: 'search', test: 'search' },
  { path: '/connections', label: 'Connections', icon: 'users', test: 'connections' },
  { path: '/network', label: 'Network', icon: 'network', test: 'network' },
  { path: '/ai', label: 'Assistant', icon: 'chat', test: 'assistant' },
];
type Outcome = { text: string; undo?: () => void | Promise<void> };
type ShellState = {
  count: number | null;
  refreshCount: () => void;
  saved: SavedSearch[];
  setSaved: React.Dispatch<React.SetStateAction<SavedSearch[]>>;
  savedLoading: boolean;
  savedError: string;
  outcome: Outcome;
  announce: (text: string, undo?: Outcome['undo']) => void;
  logout: () => Promise<void>;
  profile: { displayName: string; photoURL: string; jobTitle: string };
};
const Context = createContext<ShellState | null>(null);
export const useShell = () => useContext(Context)!;
const counts = new Map<string, Promise<number | null>>();
function readCount(uid: string, refresh = false) {
  if (refresh || !counts.has(uid))
    counts.set(
      uid,
      getCountFromServer(collection(db, 'users', uid, 'connections'))
        .then((s) => s.data().count)
        .catch(() => null),
    );
  return counts.get(uid)!;
}

export function StatusFooter({ search = false }: { search?: boolean }) {
  const { outcome, announce } = useShell();
  const [undoing, setUndoing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!outcome.text || hovered || undoing) return;
    // Focus is checked when the time is up (a focused Undo button that disappears never fires blur).
    let timer = 0;
    const expire = () => {
      if (box.current?.contains(document.activeElement)) timer = window.setTimeout(expire, 1000);
      else announce('');
    };
    timer = window.setTimeout(expire, outcome.undo ? 12000 : 6000);
    return () => clearTimeout(timer);
  }, [outcome, hovered, undoing, announce]);
  const undo = async () => {
    if (!outcome.undo || undoing) return;
    setUndoing(true);
    try {
      await outcome.undo();
    } catch (e: any) {
      announce(e?.message || 'Could not undo. Please try again.');
    } finally {
      setUndoing(false);
      // The Undo button goes away with its message; keep keyboard focus in the page.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body)
          document.getElementById('main-content')?.focus({ preventScroll: true });
      });
    }
  };
  return (
    <div
      // The live region stays in the page while empty, so screen readers announce the next message.
      className={search ? 'pane-foot' : `shell-status${outcome.text ? '' : ' is-empty'}`}
      data-testid="status-footer"
      ref={box}
      onPointerEnter={(e) => setHovered(e.pointerType === 'mouse')}
      onPointerLeave={() => setHovered(false)}
    >
      <div className={search ? 'statusline' : 'status'} role="status" aria-live="polite">
        {outcome.text ? (
          <>
            <span className="status-text" title={outcome.text}>
              {outcome.text}
            </span>
            {outcome.undo && (
              <button className="btn sm" disabled={undoing} onClick={() => void undo()}>
                <Icon name="undo" />
                {undoing ? 'Undoing…' : 'Undo'}
              </button>
            )}
            <button
              className="icon-btn"
              aria-label="Dismiss message"
              onClick={() => {
                announce('');
                // The button disappears with the message; keep keyboard focus in the page.
                document.getElementById('main-content')?.focus({ preventScroll: true });
              }}
            >
              <Icon name="x" />
            </button>
          </>
        ) : null}
      </div>
      {search && (
        <p className="muted keys-legend">
          <kbd>J</kbd> <kbd>K</kbd> move · <kbd>S</kbd> save · <kbd>R</kbd> relevant · <kbd>X</kbd> not
          relevant · <kbd>/</kbd> search
        </p>
      )}
    </div>
  );
}

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const uid = user!.uid;
  useEffect(() => {
    setConversationOwner(uid);
  }, [uid]);
  const location = useLocation();
  const navigate = useNavigate();
  const [count, setCount] = useState<number | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ text: '' });
  const [profile, setProfile] = useState({
    displayName: user?.displayName?.trim() || user?.email || 'Your account',
    photoURL: user?.photoURL || '',
    jobTitle: '',
  });
  const [commandOpen, setCommandOpen] = useState(false);
  const theme = useTheme();
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigationType = useNavigationType();
  const scrollPositions = useRef(new Map<string, number>());
  const [brokenPhoto, setBrokenPhoto] = useState('');
  const announce = useCallback((text: string, undo?: Outcome['undo']) => setOutcome({ text, undo }), []);
  const refreshCount = useCallback(() => {
    void readCount(uid, true).then((n) => {
      if (auth.currentUser?.uid === uid) setCount(n);
    });
  }, [uid]);
  useEffect(() => {
    let active = true;
    void readCount(uid).then((n) => {
      if (active) setCount(n);
    });
    void listSavedSearches()
      .then((items) => {
        if (active) setSaved(items);
      })
      .catch((e: any) => {
        if (active) setSavedError(e?.message || 'Saved searches could not be loaded.');
      })
      .finally(() => {
        if (active) setSavedLoading(false);
      });
    const loadProfile = () => {
      void getDoc(doc(db, 'users', uid))
        .then((s) => {
          if (!active) return;
          const data = s.data();
          setProfile({
            displayName:
              data?.displayName?.trim() || user?.displayName?.trim() || user?.email || 'Your account',
            photoURL: data?.photoURL || user?.photoURL || '',
            jobTitle: typeof data?.jobTitle === 'string' ? data.jobTitle : '',
          });
        })
        .catch(() => {});
    };
    loadProfile();
    window.addEventListener('ncrp-profile-updated', loadProfile);
    return () => {
      active = false;
      window.removeEventListener('ncrp-profile-updated', loadProfile);
    };
  }, [uid]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      media.removeEventListener('change', change);
      window.removeEventListener('keydown', key);
    };
  }, []);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const top = navigationType === 'POP' ? scrollPositions.current.get(location.pathname) || 0 : 0;
    const restore = () => {
      el.scrollTop = top;
    };
    restore();
    const observer = new MutationObserver(restore);
    if (top) observer.observe(el, { childList: true, subtree: true });
    const stop = () => observer.disconnect();
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('pointerdown', stop);
    el.addEventListener('keydown', stop);
    setOutcome({ text: '' });
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', stop);
      el.removeEventListener('pointerdown', stop);
      el.removeEventListener('keydown', stop);
    };
  }, [location.pathname]);
  const logout = async () => {
    try {
      await signOutOfAccount();
      navigate('/login');
    } catch (e) {
      announce(describeAuthError(e, 'Could not sign out. Please try again.'));
    }
  };
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const title = NAV_ITEMS.find((n) => n.path === location.pathname)?.label || 'Profile';
  const avatar =
    profile.photoURL && brokenPhoto !== profile.photoURL ? (
      <img
        className="avatar"
        src={profile.photoURL}
        alt=""
        onError={() => setBrokenPhoto(profile.photoURL)}
      />
    ) : (
      <span className="avatar" aria-hidden="true">
        {initials(profile.displayName)}
      </span>
    );
  const nav = (mobile: boolean) =>
    NAV_ITEMS.map((n) => (
      <NavLink
        key={n.path}
        to={n.path}
        title={n.label}
        aria-label={n.label}
        data-testid={`${mobile ? 'tab' : 'nav'}-${n.test}`}
      >
        <Icon name={n.icon} />
        <span className={mobile ? '' : 'lbl-t'}>{n.label}</span>
        {!mobile && n.path === '/connections' && count != null && (
          <span className="count">{count.toLocaleString()}</span>
        )}
      </NavLink>
    ));
  return (
    <Context.Provider
      value={{
        count,
        refreshCount,
        saved,
        setSaved,
        savedLoading,
        savedError,
        outcome,
        announce,
        logout,
        profile,
      }}
    >
      <div className="app">
        <a
          className="skip-link"
          href="#main-content"
          onClick={(e) => {
            e.preventDefault();
            contentRef.current?.focus();
          }}
        >
          Skip to content
        </a>
        <aside className="side">
          <div className="brand">
            <span className="logo" aria-hidden="true">
              <Icon name="network" />
            </span>
            <span className="bt">
              <b title="Connection Recommender">Connection Recommender</b>
              <small>{profile.displayName.split(/\s+/)[0]}'s network</small>
            </span>
          </div>
          <nav className="nav" aria-label="Main">
            {nav(false)}
          </nav>
          <p className="side-h">Saved searches</p>
          <div className="nav side-saved">
            {!saved.length && <span className="hint">{savedLoading ? 'Loading…' : 'None yet'}</span>}
            {saved.map((s) => (
              <button
                key={s.id}
                className="side-btn"
                title={`${s.title}: ${s.criteria}`}
                onClick={() =>
                  navigate('/recommender', {
                    state: { runSearch: { criteria: s.criteria, strictTitleOnly: s.strictTitleOnly } },
                  })
                }
              >
                <Icon name="bookmark" />
                <span className="lbl-t">{s.title}</span>
              </button>
            ))}
          </div>
          <div className="side-foot nav">
            <NavLink
              to="/profile"
              className="side-user"
              data-testid="nav-profile"
              title={`${profile.displayName} · Profile`}
            >
              {avatar}
              <span className="who">
                <span>{profile.displayName}</span>
                <small>Profile</small>
              </span>
            </NavLink>
            <button
              id="side-theme"
              className="icon-btn"
              data-testid="theme-toggle"
              aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
              title={`Switch to ${dark ? 'light' : 'dark'} mode`}
              onClick={() => setTheme(dark ? 'light' : 'dark')}
            >
              <Icon name={dark ? 'sun' : 'moon'} />
            </button>
            <button
              className="icon-btn side-signout"
              data-testid="sign-out"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <Icon name="out" />
            </button>
          </div>
        </aside>
        <main className="main">
          <div className={`topstrip${location.pathname === '/profile' ? ' on-profile' : ''}`}>
            <h1>{title}</h1>
            <span className="crumb">{title === 'Search' ? 'People who could help' : ''}</span>
            <button
              className="jump"
              data-testid="jump-button"
              aria-label="Open the command bar: jump to a screen or search"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setCommandOpen(true)}
            >
              <Icon name="search" />
              <span>Jump to…</span>
              <kbd className="kbd-mod">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd>
            </button>
            <Link className="btn ghost sm top-profile" to="/profile">
              {avatar}Profile
            </Link>
          </div>
          <div
            className="views"
            ref={contentRef}
            id="main-content"
            tabIndex={-1}
            onScroll={(e) => scrollPositions.current.set(location.pathname, e.currentTarget.scrollTop)}
          >
            {children}
          </div>
          {location.pathname !== '/recommender' && <StatusFooter />}
        </main>
        <nav className="tabbar" aria-label="Main (mobile)">
          {nav(true)}
        </nav>
      </div>
      <CommandBar open={commandOpen} onClose={() => setCommandOpen(false)} />
    </Context.Provider>
  );
};
