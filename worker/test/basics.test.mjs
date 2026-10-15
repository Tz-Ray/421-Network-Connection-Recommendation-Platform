// Contract basics against a local `wrangler dev`: /health, auth, CORS, body
// limits, region block, and mock-reply parity with server/index.js.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import {
  BASE_VARS,
  CHAT_BODY,
  RERANK_BODY,
  makeTempDir,
  post,
  signInTestAccount,
  startNodeProxy,
  startWorker,
} from "./helpers.mjs";

describe("public mode with ALLOW_TEST_COUNTRY=1", () => {
  let w, node, token, uid, state;

  before(async () => {
    ({ idToken: token, uid } = await signInTestAccount());
    state = await makeTempDir();
    w = await startWorker({
      vars: { ...BASE_VARS, AI_ACCESS: "public", ALLOW_TEST_COUNTRY: "1", AI_ALLOWED_UIDS: `someone-else,${uid}` },
      persistTo: state,
    });
    node = await startNodeProxy();
  });

  after(async () => {
    await w?.stop();
    await node?.stop();
    if (state) await fsp.rm(state, { recursive: true, force: true });
  });

  test("/health has the documented shape, reports access, and never lists uids", async () => {
    const r = await fetch(`${w.url}/health`);
    assert.equal(r.status, 200);
    const text = await r.text();
    const j = JSON.parse(text);
    assert.deepEqual(Object.keys(j).sort(), [
      "access",
      "authConfigured",
      "fallbackModel",
      "hint",
      "keyLoaded",
      "mock",
      "model",
      "ok",
    ]);
    assert.equal(j.ok, true);
    assert.equal(j.access, "public");
    assert.equal(j.model, "gemini-2.5-flash");
    assert.equal(j.fallbackModel, "gemini-3.5-flash-lite");
    assert.equal(j.mock, true);
    assert.equal(j.keyLoaded, false);
    assert.equal(j.authConfigured, true);
    assert.ok(!text.includes(uid), "health must not contain the uid");
    assert.ok(!text.includes("someone-else"), "health must not contain the allowlist");
  });

  test("no token -> 401", async () => {
    const r = await post(w.url, "/gemini/rerank", RERANK_BODY);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "Sign in to use the AI proxy." });
  });

  test("bad token -> 401", async () => {
    const r = await post(w.url, "/gemini/rerank", RERANK_BODY, { token: "abc.def.ghi" });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "Sign in again to use the AI proxy." });
  });

  test("CORS: disallowed preflight -> 403, allowed preflight -> 204, disallowed real request has no ACAO", async () => {
    const bad = await fetch(`${w.url}/gemini/rerank`, { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
    assert.equal(bad.status, 403);
    assert.deepEqual(await bad.json(), { error: "Origin not allowed." });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);

    const good = await fetch(`${w.url}/gemini/rerank`, {
      method: "OPTIONS",
      headers: { Origin: "https://connectionrecommender.web.app" },
    });
    assert.equal(good.status, 204);
    assert.equal(good.headers.get("access-control-allow-origin"), "https://connectionrecommender.web.app");
    assert.equal(good.headers.get("access-control-allow-headers"), "Content-Type, Authorization");

    const real = await fetch(`${w.url}/health`, { headers: { Origin: "https://evil.example" } });
    assert.equal(real.status, 200);
    assert.equal(real.headers.get("access-control-allow-origin"), null);
    assert.equal(real.headers.get("vary"), "Origin");
  });

  test("body > 256 KB -> 413 (the Worker's cap; server/index.js allows 2 MB)", async () => {
    const big = JSON.stringify({ criteria: "x".repeat(256 * 1024 + 10), candidates: [{ id: "c0", name: "A" }] });
    const r = await post(w.url, "/gemini/rerank", big, { token });
    assert.equal(r.status, 413);
    assert.match((await r.json()).error, /too large/);
  });

  test("malformed JSON -> 400", async () => {
    const r = await post(w.url, "/gemini/rerank", "{not json", { token });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: "Malformed JSON body." });
  });

  test("unknown path with a token -> plain-text 404", async () => {
    const r = await fetch(`${w.url}/nope`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 404);
    assert.equal(await r.text(), "Not found");
  });

  test("region block: X-Test-Country DE -> 403, US -> 200", async () => {
    const de = await post(w.url, "/gemini/rerank", RERANK_BODY, { token, headers: { "X-Test-Country": "DE" } });
    assert.equal(de.status, 403);
    assert.deepEqual(await de.json(), { error: "AI features aren't available in your region." });
    const us = await post(w.url, "/gemini/rerank", RERANK_BODY, { token, headers: { "X-Test-Country": "US" } });
    assert.equal(us.status, 200);
  });

  test("mock rerank and chat replies are identical to server/index.js (GEMINI_MOCK=1)", async () => {
    const cases = [
      ["/gemini/rerank", RERANK_BODY],
      ["/gemini/chat", CHAT_BODY],
      ["/gemini/rerank", { criteria: "", candidates: RERANK_BODY.candidates }],
      ["/gemini/chat", { query: "q", candidates: [] }],
      ["/gemini/rerank", { criteria: "x", candidates: [null, 5, { name: "no id" }] }],
    ];
    for (const [p, body] of cases) {
      const wr = await post(w.url, p, body, { token });
      const nr = await post(node.url, p, body, { token });
      assert.equal(wr.status, nr.status, `${p} status`);
      assert.deepEqual(await wr.json(), await nr.json(), `${p} body`);
    }
    const r = await post(w.url, "/gemini/rerank", RERANK_BODY, { token });
    assert.deepEqual(await r.json(), {
      recommendations: [
        { id: "c0", reason: "mock" },
        { id: "c1", reason: "mock" },
      ],
    });
    const c = await post(w.url, "/gemini/chat", CHAT_BODY, { token });
    assert.deepEqual(await c.json(), {
      answer: "Mock answer.",
      recommendations: [
        { id: "c0", reason: "mock" },
        { id: "c1", reason: "mock" },
      ],
    });
  });
});
