// worker/test/helpers.mjs
//
// Test harness: starts `wrangler dev` in LOCAL mode (no Cloudflare account, no
// network calls to Cloudflare) with a scenario's variables, and signs in to the
// Firebase test account for real ID tokens.
//
// Each scenario runs from a temporary directory holding a copy of wrangler.toml
// (with an absolute `main`) and a scenario-specific .dev.vars, so a developer's
// own worker/.dev.vars never leaks into a test. The uid and token are only ever
// held in memory and in that temporary .dev.vars, which is deleted afterwards.

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_DIR = path.resolve(here, "..");
export const REPO_DIR = path.resolve(WORKER_DIR, "..");
const WRANGLER_BIN = path.join(WORKER_DIR, "node_modules", "wrangler", "bin", "wrangler.js");

// Local-only switches: never fetch cf.json from Cloudflare, never send telemetry.
const LOCAL_ENV = { CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false" };

// workerd needs glibc >= 2.35. On an older Linux, set MINIFLARE_WORKERD_PATH to a
// wrapper that runs it under a newer glibc; a wrapper at ../local/workerd-glibc/workerd.sh
// (gitignored, machine-specific) is picked up automatically.
const LOCAL_WORKERD_WRAPPER = path.join(REPO_DIR, "local", "workerd-glibc", "workerd.sh");
if (!process.env.MINIFLARE_WORKERD_PATH && fs.existsSync(LOCAL_WORKERD_WRAPPER)) {
  LOCAL_ENV.MINIFLARE_WORKERD_PATH = LOCAL_WORKERD_WRAPPER;
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function makeTempDir(prefix = "ncrp-worker-test-") {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function waitForHealth(url, child, timeoutMs, logRef) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early (${child.exitCode}):\n${logRef.text}`);
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wrangler dev did not become ready in ${timeoutMs} ms:\n${logRef.text}`);
}

function toDevVars(vars) {
  return (
    Object.entries(vars)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${JSON.stringify(String(v))}`)
      .join("\n") + "\n"
  );
}

/**
 * Starts `wrangler dev --local` with `vars` (written to a temporary .dev.vars, which
 * overrides wrangler.toml [vars]). `persistTo` keeps Durable Object state between
 * restarts; `port` pins the port (default: a free one). Returns { url, stop }.
 */
export async function startWorker({ vars = {}, persistTo, port: fixedPort }) {
  const dir = await makeTempDir("ncrp-worker-cfg-");
  const toml = (await fsp.readFile(path.join(WORKER_DIR, "wrangler.toml"), "utf8")).replace(
    /^main\s*=.*$/m,
    `main = ${JSON.stringify(path.join(WORKER_DIR, "src", "index.js"))}`
  );
  await fsp.writeFile(path.join(dir, "wrangler.toml"), toml);
  await fsp.writeFile(path.join(dir, ".dev.vars"), toDevVars(vars), { mode: 0o600 });

  const port = fixedPort || (await freePort());
  const inspectorPort = await freePort();
  const args = [
    WRANGLER_BIN,
    "dev",
    "--local",
    "--config",
    path.join(dir, "wrangler.toml"),
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--inspector-port",
    String(inspectorPort),
    "--persist-to",
    persistTo,
    "--show-interactive-dev-session=false",
    "--log-level",
    "warn",
  ];
  const child = spawn(process.execPath, args, {
    cwd: dir,
    env: { ...process.env, ...LOCAL_ENV },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logRef = { text: "" };
  const onData = (d) => {
    logRef.text += d.toString();
    if (logRef.text.length > 20000) logRef.text = logRef.text.slice(-20000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once("exit", r));
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 8000);
      await exited;
      clearTimeout(timer);
    }
    // Make sure the port is really free before a restart reuses the state dir.
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${url}/health`, { signal: AbortSignal.timeout(300) });
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await fsp.rm(dir, { recursive: true, force: true });
  };

  try {
    await waitForHealth(url, child, 90_000, logRef);
  } catch (e) {
    await stop();
    throw e;
  }
  return { url, stop, log: () => logRef.text };
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** The web API key from the shell, else the repo's .env.local, else .env (never copied anywhere). */
function firebaseApiKey() {
  if (process.env.VITE_FIREBASE_API_KEY) return process.env.VITE_FIREBASE_API_KEY;
  for (const f of [".env.local", ".env"]) {
    const v = readEnvFile(path.join(REPO_DIR, f)).VITE_FIREBASE_API_KEY;
    if (v) return v;
  }
  throw new Error("VITE_FIREBASE_API_KEY not found in the shell, .env.local or .env");
}

/** A test setting from the shell, else the repo's .env.local, else .env (credentials are never in the repo). */
function testSetting(name) {
  if (process.env[name]) return process.env[name];
  for (const f of [".env.local", ".env"]) {
    const v = readEnvFile(path.join(REPO_DIR, f))[name];
    if (v) return v;
  }
  throw new Error(`${name} not found in the shell, .env.local or .env (the test account's sign-in)`);
}

/** Signs in to the shared test account; returns { idToken, uid }. */
export async function signInTestAccount() {
  const email = testSetting("NCRP_TEST_EMAIL");
  const password = testSetting("NCRP_TEST_PASSWORD");
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseApiKey())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const j = await r.json();
  if (!r.ok || !j.idToken) throw new Error(`Test sign-in failed: HTTP ${r.status} ${j?.error?.message || ""}`);
  return { idToken: j.idToken, uid: j.localId };
}

/** Base vars every scenario starts from (mock Gemini, no key). */
export const BASE_VARS = {
  GEMINI_MOCK: "1",
  AI_RATE_LIMIT_PER_MIN: "100",
  AI_RATE_LIMIT_PER_DAY: "100",
  AI_GLOBAL_DAILY_CAP: "1000",
  AI_DEMO_RESERVE: "0",
};

export const CANDIDATES = [
  { id: "c0", name: "Jane Doe", position: "VP Sales", company: "Stripe", relationship: "10+ messages\nlast | Aug 2026" },
  { id: "c1", name: "John Roe", position: "Account Executive", company: "Plaid" },
  { id: "c2", name: "Ann Poe", position: "Engineer", company: "Acme" },
];

export const RERANK_BODY = { criteria: "VP of Sales at a fintech company", candidates: CANDIDATES, context: "Headline: x" };
export const CHAT_BODY = {
  query: "Who could introduce me to fintech sales?",
  messages: [{ role: "user", text: "hi" }],
  candidates: CANDIDATES,
};

export function post(url, pathName, body, { token, headers = {} } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  return fetch(`${url}${pathName}`, {
    method: "POST",
    headers: h,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Starts server/index.js (the Node proxy) in mock mode on a free port, for parity checks. */
export async function startNodeProxy() {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(REPO_DIR, "server", "index.js")], {
    cwd: path.join(REPO_DIR, "server"),
    // An empty GEMINI_API_KEY stops dotenv from loading a real key; mock mode makes no call anyway.
    env: {
      ...process.env,
      AI_PROXY_PORT: String(port),
      GEMINI_MOCK: "1",
      GEMINI_API_KEY: "",
      GEMINI_MODEL: "gemini-2.5-flash",
      GEMINI_FALLBACK_MODEL: "gemini-3.5-flash-lite",
      FIREBASE_PROJECT_ID: "connectionrecommender",
      AI_RATE_LIMIT_PER_MIN: "100",
      AI_RATE_LIMIT_PER_DAY: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logRef = { text: "" };
  child.stdout.on("data", (d) => (logRef.text += d));
  child.stderr.on("data", (d) => (logRef.text += d));
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await exited;
    }
  };
  try {
    await waitForHealth(url, child, 20_000, logRef);
  } catch (e) {
    await stop();
    throw e;
  }
  return { url, stop };
}
