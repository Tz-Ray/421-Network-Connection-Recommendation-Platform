// lib/proxyClient.ts
//
// Single source of truth for the AI proxy base URL and for every request the
// frontend makes to it. Nothing else in the app should read
// `VITE_AI_PROXY_URL` or hardcode a proxy host/port.
//
// The proxy requires a Firebase ID token (`Authorization: Bearer <token>`), so
// every call goes through `proxyFetch`, which attaches it.

import { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { useAuth } from './AuthContext';

/**
 * `VITE_AI_PROXY_URL=off` builds the app with AI features deliberately switched
 * off (used for a Hosting deploy while no public proxy exists). The AI buttons,
 * the /ai page and the chat widget then explain that instead of failing.
 */
export const AI_DISABLED: boolean =
  (import.meta.env.VITE_AI_PROXY_URL ?? '').trim().toLowerCase() === 'off';

export const AI_DISABLED_MESSAGE =
  "AI features (AI Rerank and the AI assistant) aren't available on the hosted version of this app.";

function resolveProxyUrl(): string {
  if (AI_DISABLED) return '';
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

/** Rerank-card note for the build-time AI-off build (`VITE_AI_PROXY_URL=off`). */
export const AI_RERANK_DISABLED_NOTE = "AI Rerank isn't available on the hosted version of this app.";

/**
 * Shown next to the AI features whenever the proxy reports `access: "allowlist"`
 * or `"public"` (the hosted Worker, which runs on the Gemini free tier).
 */
export const AI_FREE_TIER_NOTICE =
  "AI features use Google's free Gemini tier, so Google may use what is sent to improve its products: your question, the names, titles and companies of the connections considered, a short summary of how you know each one, and a short summary of your own profile. Message text and notes are never sent.";

const AI_SWITCHED_OFF_MESSAGE = 'AI features (AI Rerank and the AI assistant) are switched off right now.';
const AI_UNREACHABLE_MESSAGE =
  "AI features (AI Rerank and the AI assistant) are unavailable: the AI proxy can't be reached right now. Reload the page to try again.";

export type AiAccess = 'off' | 'allowlist' | 'public' | 'unknown';

export interface AiAvailability {
  /** True when AI controls must be disabled (build-time off, proxy off/unreachable/region, or still checking). */
  disabled: boolean;
  /** What the proxy's /health reported; 'unknown' when it has no `access` field or could not be read. */
  access: AiAccess;
  /** True until the /health check has finished. */
  checking: boolean;
  /** Why AI is disabled ('' when it is not, or while checking). */
  message: string;
  /** The one-line note under the AI Rerank button when disabled. */
  rerankNote: string;
}

const AI_HEALTH_TIMEOUT_MS = 5000;
const AI_CHECKING: AiAvailability = { disabled: true, access: 'unknown', checking: true, message: '', rerankNote: '' };
const BUILD_OFF: AiAvailability = {
  disabled: true,
  access: 'off',
  checking: false,
  message: AI_DISABLED_MESSAGE,
  rerankNote: AI_RERANK_DISABLED_NOTE,
};
const NOT_CONFIGURED: AiAvailability = {
  disabled: true,
  access: 'unknown',
  checking: false,
  message: 'AI features need an AI proxy, and this build has none configured.',
  rerankNote: 'AI Rerank needs an AI proxy, and this build has none configured.',
};

function off(access: AiAccess, message: string): AiAvailability {
  return { disabled: true, access, checking: false, message, rerankNote: message };
}

function on(access: AiAccess): AiAvailability {
  return { disabled: false, access, checking: false, message: '', rerankNote: '' };
}

// One answer per signed-in user per page load (the /access answer depends on the uid).
let availabilityResult: { uid: string; value: AiAvailability } | null = null;
let availabilityPromise: { uid: string; promise: Promise<AiAvailability> } | null = null;

/** Returns null when the proxy could not be read (not cached, so a later mount retries). */
async function fetchAvailability(): Promise<AiAvailability | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROXY_URL}/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const access = data && typeof data === 'object' ? (data as { access?: unknown }).access : undefined;
    // The local Node proxy (server/index.js) has no `access` field: AI stays on, as before.
    if (access === undefined) return on('unknown');
    if (access !== 'allowlist' && access !== 'public') {
      // 'off', or a value this build does not know: fail closed.
      return off(access === 'off' ? 'off' : 'unknown', AI_SWITCHED_OFF_MESSAGE);
    }
    // The Worker's uncharged GET /access says whether this account, from here, may
    // use AI (allowlist membership, region), so nobody gets a button that only fails.
    // Nobody signed in yet (auth still loading): stay disabled; the hook asks again
    // once the user is known.
    if (!auth.currentUser) return off(access, '');
    const acc = await proxyFetch('/access', { signal: controller.signal });
    if (acc.status === 404) return on(access); // a proxy without /access
    if (!acc.ok) return null;
    const verdict = (await acc.json()) as { allowed?: unknown; error?: unknown };
    if (verdict.allowed === true) return on(access);
    const why = typeof verdict.error === 'string' && verdict.error.trim() ? verdict.error.trim() : AI_SWITCHED_OFF_MESSAGE;
    return off(access, why);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const currentUid = () => auth.currentUser?.uid ?? '';

/**
 * Runtime AI availability from the proxy's public `/health` (plus `/access` on the
 * Worker). A successful answer is kept for the rest of the page load for the same
 * user; a failed one is not, so the next screen that mounts asks again. A build
 * made with `VITE_AI_PROXY_URL=off` (or without a proxy URL) never asks.
 */
export function checkAiAvailability(): Promise<AiAvailability> {
  if (AI_DISABLED) return Promise.resolve(BUILD_OFF);
  if (!PROXY_CONFIGURED) return Promise.resolve(NOT_CONFIGURED);
  const uid = currentUid();
  if (availabilityResult?.uid === uid) return Promise.resolve(availabilityResult.value);
  if (availabilityPromise?.uid !== uid) {
    const pending = { uid, promise: Promise.resolve(AI_CHECKING) };
    pending.promise = fetchAvailability().then((r) => {
      if (availabilityPromise === pending) availabilityPromise = null;
      if (!r) return off('unknown', AI_UNREACHABLE_MESSAGE);
      availabilityResult = { uid, value: r };
      return r;
    });
    availabilityPromise = pending;
  }
  return availabilityPromise.promise;
}

/**
 * React hook over `checkAiAvailability()`; AI controls stay disabled while it is
 * checking. Re-checks when the signed-in user changes (the answer is per user).
 */
export function useAiAvailability(): AiAvailability {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const [state, setState] = useState<AiAvailability>(() => {
    if (AI_DISABLED) return BUILD_OFF;
    if (!PROXY_CONFIGURED) return NOT_CONFIGURED;
    return availabilityResult?.uid === currentUid() ? availabilityResult.value : AI_CHECKING;
  });
  useEffect(() => {
    let active = true;
    void checkAiAvailability().then((r) => {
      if (active) setState(r);
    });
    return () => {
      active = false;
    };
  }, [uid]);
  return state;
}

/** True when the free-tier disclosure must be shown next to the AI features. */
export function showsFreeTierNotice(ai: AiAvailability): boolean {
  return !ai.disabled && (ai.access === 'allowlist' || ai.access === 'public');
}

/**
 * Turns a failed proxy response into the proxy's own `{ error }` message (the
 * Worker's limit, region and access messages are written for users), falling
 * back to the raw text or the status.
 */
export async function proxyErrorMessage(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    if (j && typeof j.error === 'string' && j.error.trim()) return j.error.trim();
  } catch {
    // not JSON
  }
  return text.trim() || `AI request failed (HTTP ${resp.status}).`;
}

/**
 * `fetch` against the AI proxy with the caller's Firebase ID token attached.
 * Throws before any network call when the proxy is unconfigured or nobody is
 * signed in, so callers surface a plain message instead of a network failure.
 */
export async function proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!PROXY_CONFIGURED) {
    throw new Error(AI_DISABLED ? AI_DISABLED_MESSAGE : 'AI proxy is not configured for this build.');
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
