// worker/src/index.js
//
// Cloudflare Worker version of the AI proxy (server/index.js). Same routes, same
// request/response shapes, same handler order:
//
//   CORS allowlist -> OPTIONS -> GET /health (public) -> access switch "off" check
//   -> Firebase ID token -> unknown route 404 (not charged) -> GET /access (not
//   charged) -> access switch (allowlist / region) -> rate limit (charged before the
//   body is read) -> route
//
// Differences from server/index.js are listed in worker/README.md.

import * as jose from "jose";
import { geminiConfig, handleChat, handleRerank, httpError, listModels } from "./gemini.js";

export { RateLimiter } from "./limiter.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://connectionrecommender.web.app",
  "https://connectionrecommender.firebaseapp.com",
];

// 256 KB, not server/index.js's 2 MB: a real request (120 short candidates) is well
// under 100 KB, and parsing megabytes would risk the Workers Free CPU limit.
const MAX_BODY_BYTES = 256 * 1024;

// Countries Cloudflare reports when it can't tell: unknown, and Tor.
const UNKNOWN_COUNTRIES = new Set(["", "XX", "T1"]);

const ROUTES = new Set(["GET /models", "POST /gemini/rerank", "POST /gemini/chat", "GET /access"]);

const ACCESS_MODES = new Set(["off", "allowlist", "public"]);

const MSG_ACCESS_OFF = "AI features are switched off right now.";
const MSG_NOT_ALLOWLISTED = "AI features aren't available for this account right now.";
const MSG_REGION = "AI features aren't available in your region.";
const MSG_MODELS_PRIVILEGED = "Only allowlisted accounts can list models.";
const MSG_UPSTREAM = "The AI service had a problem answering. Please try again later.";

// Google's public signing keys for Firebase ID tokens. Created once per isolate;
// `jose` caches the key set and refetches only when it sees an unknown `kid`.
const FIREBASE_JWKS = jose.createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

function list(raw, { upper = false } = {}) {
  return String(raw || "")
    .split(",")
    .map((s) => (upper ? s.trim().toUpperCase() : s.trim()))
    .filter(Boolean);
}

function resolveInt(raw, fallback, min) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) return fallback;
  return n;
}

/** Missing, blank or unknown AI_ACCESS fails closed to "off". */
export function accessMode(env) {
  const v = String(env.AI_ACCESS || "").trim().toLowerCase();
  return ACCESS_MODES.has(v) ? v : "off";
}

function config(env) {
  const origins = new Set(list(env.AI_PROXY_ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, "")));
  if (origins.size === 0) for (const o of DEFAULT_ALLOWED_ORIGINS) origins.add(o);
  const projectId = String(env.FIREBASE_PROJECT_ID || "").trim();
  const gemini = geminiConfig(env);
  return {
    origins,
    projectId,
    authConfigured: projectId !== "",
    access: accessMode(env),
    allowedUids: new Set(list(env.AI_ALLOWED_UIDS)),
    blockedCountries: new Set(list(env.AI_BLOCKED_COUNTRIES, { upper: true })),
    // Test-only, and honored only with mock replies, so it can never open the
    // region check on a deployment that calls Gemini.
    allowTestCountry: gemini.mock && String(env.ALLOW_TEST_COUNTRY || "").trim() === "1",
    limits: {
      perMin: resolveInt(env.AI_RATE_LIMIT_PER_MIN, 10, 1),
      perDay: resolveInt(env.AI_RATE_LIMIT_PER_DAY, 5, 1),
      perIpDay: resolveInt(env.AI_RATE_LIMIT_PER_IP_DAY, 10, 1),
      globalCap: resolveInt(env.AI_GLOBAL_DAILY_CAP, 34, 1),
      demoReserve: resolveInt(env.AI_DEMO_RESERVE, 6, 0),
    },
    gemini,
  };
}

// --- Responses --------------------------------------------------------------

function sendJson(status, obj, headers) {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(obj, null, 2), { status, headers: h });
}

function sendText(status, text, headers) {
  const h = new Headers(headers);
  h.set("Content-Type", "text/plain");
  return new Response(text, { status, headers: h });
}

/**
 * Allowlist CORS. Returns { allowed, headers }. A request with no Origin passes
 * with no CORS headers; a disallowed Origin gets only `Vary: Origin` (and its
 * preflight a 403), so the browser will not let the page read the response.
 */
function corsHeaders(origin, cfg) {
  const headers = new Headers();
  if (!origin) return { allowed: true, headers };
  const normalized = String(origin).trim().replace(/\/+$/, "");
  headers.set("Vary", "Origin");
  if (!cfg.origins.has(normalized)) return { allowed: false, headers };
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "600");
  return { allowed: true, headers };
}

// --- Body -------------------------------------------------------------------

async function readJson(request) {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw httpError(413, `Request body too large (max ${MAX_BODY_BYTES} bytes).`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  const raw = new TextDecoder().decode(bytes);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Malformed JSON body.");
  }
}

// --- Auth -------------------------------------------------------------------

/**
 * Verifies `Authorization: Bearer <Firebase ID token>` and returns the caller.
 * Throws httpError(401) with a generic message; the JWT error is only logged.
 */
async function verifyIdToken(request, cfg) {
  if (!cfg.authConfigured) throw httpError(503, "Proxy auth is not configured.");

  const header = String(request.headers.get("Authorization") || "").trim();
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw httpError(401, "Sign in to use the AI proxy.");

  let payload;
  try {
    ({ payload } = await jose.jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${cfg.projectId}`,
      audience: cfg.projectId,
      algorithms: ["RS256"],
    }));
  } catch (e) {
    console.warn(`Rejected ID token: ${String(e?.message || e).slice(0, 200)}`);
    throw httpError(401, "Sign in again to use the AI proxy.");
  }

  // email_verified is deliberately NOT required (email/password accounts are unverified by default).
  const uid = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!uid) throw httpError(401, "Sign in again to use the AI proxy.");
  return { uid };
}

function requestCountry(request, cfg) {
  if (cfg.allowTestCountry) {
    const test = String(request.headers.get("X-Test-Country") || "").trim().toUpperCase();
    if (test) return test;
  }
  return String(request.cf?.country || "").trim().toUpperCase();
}

/**
 * Public mode only: blocked countries are refused, and so is an unknown country
 * (or Tor), except under mock replies, where local `wrangler dev` may not know it.
 */
function regionBlocked(request, cfg) {
  if (cfg.access !== "public") return false;
  const country = requestCountry(request, cfg);
  if (UNKNOWN_COUNTRIES.has(country)) return !cfg.gemini.mock;
  return cfg.blockedCountries.has(country);
}

/** Why this caller can't use AI right now, or "" when they can. */
function refusal(request, cfg, privileged) {
  if (cfg.access === "allowlist" && !privileged) return { status: 403, error: MSG_NOT_ALLOWLISTED };
  if (regionBlocked(request, cfg)) return { status: 403, error: MSG_REGION };
  return null;
}

/** Short SHA-256 of the caller's address; "" when Cloudflare didn't give one (local dev). */
async function ipKeyFor(request) {
  const ip = String(request.headers.get("CF-Connecting-IP") || "").trim();
  if (!ip) return "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ncrp-ai:${ip}`));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Rate limit -------------------------------------------------------------

function limiterStub(env) {
  return env.LIMITER.get(env.LIMITER.idFromName("global"));
}

function limitError(result, status = 429) {
  const err = httpError(status, result.error);
  err.retryAfter = result.retryAfter;
  return err;
}

async function rateLimit(env, cfg, request, uid, privileged) {
  const ipKey = await ipKeyFor(request);
  const result = await limiterStub(env).charge({ uid, ipKey, privileged, limits: cfg.limits });
  if (!result.ok) throw limitError(result);
}

/**
 * Hook gemini.js calls before every upstream attempt. The request's first call was
 * counted by rateLimit(); each further one (retries, the fallback model, the strict
 * second pass) is counted here, so the shared cap tracks real Gemini calls.
 */
function callCharger(env, cfg, privileged) {
  let first = true;
  return async () => {
    if (first) {
      first = false;
      return;
    }
    const result = await limiterStub(env).chargeCall({ privileged, limits: cfg.limits });
    if (!result.ok) throw limitError(result, 503);
  };
}

// --- Handler ----------------------------------------------------------------

export default {
  async fetch(request, env) {
    const cfg = config(env);
    const url = new URL(request.url);
    const { allowed, headers } = corsHeaders(request.headers.get("Origin"), cfg);
    let privileged = false;

    if (request.method === "OPTIONS") {
      if (!allowed) return sendJson(403, { error: "Origin not allowed." }, headers);
      return new Response(null, { status: 204, headers });
    }

    try {
      // Public: the only route that works without a token. Never lists the uids.
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(
          200,
          {
            ok: true,
            model: cfg.gemini.model,
            keyLoaded: !!cfg.gemini.apiKey,
            fallbackModel: cfg.gemini.fallbackModel || null,
            mock: cfg.gemini.mock,
            authConfigured: cfg.authConfigured,
            access: cfg.access,
            hint: 'Set GEMINI_MODEL like "gemini-2.5-flash" (no "models/")',
          },
          headers
        );
      }

      // Switched off: refuse before spending CPU on token verification.
      if (cfg.access === "off") throw httpError(503, MSG_ACCESS_OFF);

      const { uid } = await verifyIdToken(request, cfg);
      privileged = cfg.allowedUids.has(uid);

      // Unknown routes are refused before anything is counted.
      const route = `${request.method} ${url.pathname}`;
      if (!ROUTES.has(route)) return sendText(404, "Not found", headers);

      const refused = refusal(request, cfg, privileged);

      // Worker-only, never charged: lets the website tell this user up front whether
      // AI works for them (allowlist, region), instead of failing on the first click.
      if (route === "GET /access") {
        return sendJson(200, refused ? { allowed: false, error: refused.error } : { allowed: true }, headers);
      }

      if (refused) throw httpError(refused.status, refused.error);

      if (route === "GET /models") {
        // Lists the key's models: allowlisted accounts only, and not charged (no generateContent call).
        if (!privileged) throw httpError(403, MSG_MODELS_PRIVILEGED);
        const models = await listModels(cfg.gemini);
        return sendJson(
          200,
          {
            currentModel: cfg.gemini.model,
            note: "Use envValue as GEMINI_MODEL=<envValue>",
            generateContentModels: models,
          },
          headers
        );
      }

      // Charge BEFORE reading the body, so a flood of malformed requests counts too.
      await rateLimit(env, cfg, request, uid, privileged);
      const gemini = { ...cfg.gemini, chargeCall: callCharger(env, cfg, privileged) };

      const body = await readJson(request);
      if (route === "POST /gemini/rerank") return sendJson(200, await handleRerank(gemini, body), headers);
      return sendJson(200, await handleChat(gemini, body), headers);
    } catch (e) {
      const status = Number.isFinite(e?.status) ? e.status : 500;
      if (Number.isFinite(e?.retryAfter)) headers.set("Retry-After", String(e.retryAfter));
      let message = String(e?.message || e);
      // Upstream and internal details (Google's error text, configuration hints)
      // are logged, and shown only to allowlisted accounts.
      if ((status === 500 || status === 502) && !privileged) {
        console.error(`${status}: ${message.slice(0, 500)}`);
        message = MSG_UPSTREAM;
      } else if (e?.publicMessage && !privileged) {
        console.error(`${status}: ${message.slice(0, 500)}`);
        message = e.publicMessage;
      }
      return sendJson(status, { error: message }, headers);
    }
  },
};
