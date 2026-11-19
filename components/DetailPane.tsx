import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from './Icon';

export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const update = () => setMatches(m.matches);
    update();
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, [query]);
  return matches;
}
export function useDetailRoute(key = 'person') {
  const narrow = useMedia('(max-width:1023px)');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const returnFocus = useRef<HTMLElement | null>(null);
  const value = params.get(key);
  const wasOpen = useRef(!!value);
  useEffect(() => {
    if (wasOpen.current && !value) returnFocus.current?.focus();
    wasOpen.current = !!value;
  }, [value]);
  const clear = () => {
    const next = new URLSearchParams(params);
    next.delete(key);
    const { detailEntry, ...state } = location.state || {};
    setParams(next, { replace: true, state });
  };
  return {
    value,
    clear,
    open: (id: string, replace = false) => {
      if (!value) returnFocus.current = document.activeElement as HTMLElement;
      const next = new URLSearchParams(params);
      next.set(key, id);
      const push = narrow && !value && !replace;
      setParams(next, {
        replace: !push,
        state: push ? { ...location.state, detailEntry: key } : location.state,
      });
    },
    close: () => {
      if (narrow && location.state?.detailEntry === key) navigate(-1);
      else clear();
    },
  };
}
export function DetailPane({
  open,
  onClose,
  children,
  label = 'Person details',
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  const narrow = useMedia('(max-width:1023px)');
  const phone = useMedia('(max-width:639px)');
  const pane = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !narrow) return;
    const previous = document.activeElement as HTMLElement;
    const frame = requestAnimationFrame(() => pane.current?.focus());
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === 'Tab' && !phone) {
        const targets = Array.from(
          pane.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
          ) || [],
        ).filter((target) => target.getClientRects().length > 0);
        const first = targets[0],
          last = targets.at(-1);
        const outside = !pane.current?.contains(document.activeElement);
        if (
          e.shiftKey &&
          (outside || document.activeElement === first || document.activeElement === pane.current)
        ) {
          e.preventDefault();
          (last || pane.current)?.focus();
        } else if (
          !e.shiftKey &&
          (outside || document.activeElement === last || document.activeElement === pane.current)
        ) {
          e.preventDefault();
          (first || pane.current)?.focus();
        }
      }
    };
    const containFocus = (e: FocusEvent) => {
      if (!phone && !document.querySelector('dialog[open]') && !pane.current?.contains(e.target as Node))
        pane.current?.focus();
    };
    window.addEventListener('keydown', key);
    document.addEventListener('focusin', containFocus);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', key);
      document.removeEventListener('focusin', containFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, narrow, phone]);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={pane}
        tabIndex={-1}
        className="pane detail-pane"
        data-testid="detail-pane"
        role={narrow && !phone && open ? 'dialog' : undefined}
        aria-modal={narrow && !phone && open ? true : undefined}
        aria-label={label}
      >
        <div className="detail">
          {open && (
            <button className="btn ghost sm back-btn" onClick={onClose}>
              <Icon name="left" />
              {phone ? 'Back to list' : 'Close'}
            </button>
          )}
          {children}
        </div>
      </aside>
    </>
  );
}
