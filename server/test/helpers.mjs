// server/test/helpers.mjs
//
// Shared helpers for the proxy integration tests: start a real `server/index.js`
// child process on a free port in mock mode, and mint Firebase-shaped ID tokens
// signed by a throwaway RSA key whose public half is handed to the proxy through
// AI_PROXY_TEST_JWKS (honored only when NODE_ENV=test).
//
// Nothing here talks to Gemini or signs in to Firebase.

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as jose from "jose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.resolve(__dirname, "..", "index.js");

export const PROJECT_ID = "demo-proxy-test";
export const ALLOWED_ORIGIN = "http://allowed.test";
export const DISALLOWED_ORIGIN = "http://evil.test";
const KID = "proxy-test-key";

/** A free TCP port on 127.0.0.1 that is never 8787 (the user's real-AI proxy). */
export async function freePort() {
  for (;;) {
    const port = await new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port: p } = srv.address();
        srv.close(() => resolve(p));
      });
    });
    if (port !== 8787) return port;
  }
}

/** One RS256 key pair per test run, plus its public JWKS as a JSON string. */
export async function makeSigner(kid = KID) {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await jose.exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const jwks = JSON.stringify({ keys: [jwk] });

  /**
   * Mints a token. `claims` overrides the Firebase defaults (iss/aud/sub/exp);
   * pass `sub: undefined` to omit the subject.
   */
  async function token(claims = {}) {
    const merged = {
      iss: `https://securetoken.google.com/${PROJECT_ID}`,
      aud: PROJECT_ID,
      sub: "user-default",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    return new jose.SignJWT(merged).setProtectedHeader({ alg: "RS256", kid }).sign(privateKey);
  }

  return { jwks, token, kid };
}

/**
 * Environment for the child. Every proxy variable is set explicitly (an empty
 * string counts as "set"), so dotenv never fills one in from a developer's
 * ../.env.local; in particular GEMINI_API_KEY is always blank.
 */
function baseEnv() {
  return {
    GEMINI_MOCK: "1",
    GEMINI_API_KEY: "",
    GEMINI_MODEL: "mock-model",
    GEMINI_FALLBACK_MODEL: "",
    GEMINI_THINKING_BUDGET: "0",
    FIREBASE_PROJECT_ID: PROJECT_ID,
    VITE_FIREBASE_PROJECT_ID: "",
    AI_PROXY_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    AI_RATE_LIMIT_PER_MIN: "1000",
    AI_RATE_LIMIT_PER_DAY: "1000",
    NODE_ENV: "test",
  };
}

/**
 * Starts `node server/index.js` with `env` layered over baseEnv(). A key whose
 * value is `undefined` is removed from the child's environment entirely.
 * Resolves once the startup line is printed; `stop()` kills it and waits.
 */
export async function startProxy(env = {}) {
  const port = await freePort();
  const childEnv = { ...baseEnv(), ...env, AI_PROXY_PORT: String(port) };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.once("exit", resolve));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`proxy did not start:\n${output}`)), 10_000);
    const onData = () => {
      if (output.includes(`AI proxy running on http://localhost:${port}`)) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`proxy exited early (code ${code}):\n${output}`));
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    logs: () => output,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      await exited;
    },
  };
}

/** fetch() + parsed JSON body (null when the body is not JSON). */
export async function call(base, pathname, { method = "GET", token, origin, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (origin) h.Origin = origin;
  if (body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/json";
  const res = await fetch(base + pathname, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}
