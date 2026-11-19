import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'ncrp_theme_v1';
const listeners = new Set<() => void>();
let current: Theme | undefined;
export function getTheme(): Theme {
  if (current) return current;
  try {
    const t = localStorage.getItem(KEY);
    current = t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    current = 'system';
  }
  return current;
}
export function setTheme(t: Theme) {
  current = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* Theme still works for this visit. */
  }
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
  listeners.forEach((fn) => fn());
}
export function useTheme() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, getTheme);
}
