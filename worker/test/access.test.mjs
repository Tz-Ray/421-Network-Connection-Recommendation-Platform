// The AI_ACCESS switch (off / allowlist / public, fail-closed) and the
// X-Test-Country header being ignored unless ALLOW_TEST_COUNTRY=1.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { BASE_VARS, RERANK_BODY, CHAT_BODY, makeTempDir, post, signInTestAccount, startWorker } from "./helpers.mjs";

let token, uid;
const dirs = [];

before(async () => {
  ({ idToken: token, uid } = await signInTestAccount());
});

after(async () => {
  for (const d of dirs) await fsp.rm(d, { recursive: true, force: true });
});

async function withWorker(vars, fn) {
  const state = await makeTempDir();
  dirs.push(state);
  const w = await startWorker({ vars: { ...BASE_VARS, ...vars }, persistTo: state });
  try {
    await fn(w);
  } finally {
    await w.stop();
  }
}

async function health(w) {
  return (await fetch(`${w.url}/health`)).json();
}

describe("AI_ACCESS", () => {
  test("off -> /gemini/* and /models answer 503 (with or without a token)", async () => {
    await withWorker({ AI_ACCESS: "off" }, async (w) => {
      assert.equal((await health(w)).access, "off");
      const msg = { error: "AI features are switched off right now." };
      for (const [p, body] of [
        ["/gemini/rerank", RERANK_BODY],
        ["/gemini/chat", CHAT_BODY],
      ]) {
        const r = await post(w.url, p, body, { token });
        assert.equal(r.status, 503, p);
        assert.deepEqual(await r.json(), msg);
      }
      const m = await fetch(`${w.url}/models`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(m.status, 503);
      assert.deepEqual(await m.json(), msg);
      const anon = await post(w.url, "/gemini/rerank", RERANK_BODY);
      assert.equal(anon.status, 503);
    });
  });

  test("missing or invalid AI_ACCESS fails closed to off", async () => {
    await withWorker({}, async (w) => {
      assert.equal((await health(w)).access, "off");
      assert.equal((await post(w.url, "/gemini/rerank", RERANK_BODY, { token })).status, 503);
    });
    await withWorker({ AI_ACCESS: "everyone" }, async (w) => {
      assert.equal((await health(w)).access, "off");
      assert.equal((await post(w.url, "/gemini/rerank", RERANK_BODY, { token })).status, 503);
    });
  });

  test("allowlist, uid not listed -> 403", async () => {
    await withWorker({ AI_ACCESS: "allowlist", AI_ALLOWED_UIDS: "someone-else,another-one" }, async (w) => {
      const h = await health(w);
      assert.equal(h.access, "allowlist");
      assert.ok(!JSON.stringify(h).includes("someone-else"));
      const r = await post(w.url, "/gemini/rerank", RERANK_BODY, { token });
      assert.equal(r.status, 403);
      assert.deepEqual(await r.json(), { error: "AI features aren't available for this account right now." });
    });
  });

  test("allowlist, uid listed -> 200 (rerank and chat)", async () => {
    await withWorker({ AI_ACCESS: "allowlist", AI_ALLOWED_UIDS: ` someone-else , ${uid} ` }, async (w) => {
      assert.equal((await post(w.url, "/gemini/rerank", RERANK_BODY, { token })).status, 200);
      assert.equal((await post(w.url, "/gemini/chat", CHAT_BODY, { token })).status, 200);
    });
  });

  test("public -> 200 for any verified user; X-Test-Country ignored without ALLOW_TEST_COUNTRY=1", async () => {
    await withWorker({ AI_ACCESS: "public" }, async (w) => {
      assert.equal((await health(w)).access, "public");
      const r = await post(w.url, "/gemini/rerank", RERANK_BODY, { token, headers: { "X-Test-Country": "DE" } });
      assert.equal(r.status, 200);
      assert.equal((await post(w.url, "/gemini/chat", CHAT_BODY, { token })).status, 200);
    });
    await withWorker({ AI_ACCESS: "public", ALLOW_TEST_COUNTRY: "0" }, async (w) => {
      const r = await post(w.url, "/gemini/rerank", RERANK_BODY, { token, headers: { "X-Test-Country": "GB" } });
      assert.equal(r.status, 200);
    });
  });
});
