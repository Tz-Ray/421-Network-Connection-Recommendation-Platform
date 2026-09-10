// lib/proxyClient.ts
//
// Single source of truth for the AI proxy base URL and for every request the
// frontend makes to it. Nothing else in the app should read
// `VITE_AI_PROXY_URL` or hardcode a proxy host/port.
//
// The proxy requires a Firebase ID token (`Authorization: Bearer <token>`), so
// every call goes through `proxyFetch`, which attaches it.

import { auth } from '../firebase';

function resolveProxyUrl(): string {
  const configured = import.meta.env.VITE_AI_PROXY_URL;
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  if (import.meta.env.DEV) return 'http://localhost:8787';
  // A production build without the env var is rejected by the guard in
  // vite.config.ts; this empty value is the runtime belt to that suspender.
  return '';
}

export const PROXY_URL: string = resolveProxyUrl();

export const PROXY_CONFIGURED: boolean = PROXY_URL !== '';

/**
 * `fetch` against the AI proxy with the caller's Firebase ID token attached.
 * Throws before any network call when the proxy is unconfigured or nobody is
 * signed in, so callers surface a plain message instead of a network failure.
 */
export async function proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!PROXY_CONFIGURED) {
    throw new Error('AI proxy is not configured for this build.');
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sign in to use AI features.');
  }

  // No force refresh: the SDK refreshes the token on its own schedule.
  const token = await user.getIdToken();

  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);

  return fetch(`${PROXY_URL}${path}`, { ...init, headers });
}
