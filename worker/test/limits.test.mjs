// Rate limits held in the RateLimiter Durable Object: per-minute, per-user daily,
// the global daily cap with its demo reserve, and persistence across restarts.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { BASE_VARS, RERANK_BODY, makeTempDir, post, signInTestAccount, startWorker } from "./helpers.mjs";

let token, uid;
const dirs = [];

before(async () => {
  ({ idToken: token, uid } = await signInTestAccount());
});

after(async () => {
  for (const d of dirs) await fsp.rm(d, { recursive: true, force: true });
});

async function freshState() {
  const d = await makeTempDir();
  dirs.push(d);
  return d;
}

const rerank = (w) => post(w.url, "/gemini/rerank", RERANK_BODY, { token });

async function expectOk(w, n) {
  for (let i = 0; i < n; i++) {
    const r = await rerank(w);
    assert.equal(r.status, 200, `request ${i + 1} should pass: ${await r.clone().text()}`);
    await r.arrayBuffer();
  }
}

async function expect429(w, pattern) {
  const r = await rerank(w);
  assert.equal(r.status, 429);
  const retryAfter = Number(r.headers.get("retry-after"));
  const { error } = await r.json();
  assert.match(error, pattern);
  return retryAfter;
}

describe("rate limits", () => {
  test("per-minute sliding window -> 429 with Retry-After <= 60", async () => {
    const w = await startWorker({
      vars: { ...BASE_VARS, AI_ACCESS: "public", AI_RATE_LIMIT_PER_MIN: "2" },
      persistTo: await freshState(),
    });
    try {
      await expectOk(w, 2);
      const ra = await expect429(w, /^Rate limit reached\. Try again in \d+ seconds\.$/);
      assert.ok(ra >= 1 && ra <= 60, `Retry-After ${ra}`);
      // A refused request is not charged: still refused, same kind.
      await expect429(w, /^Rate limit reached/);
    } finally {
      await w.stop();
    }
  });

  test("per-user daily limit -> 429 until midnight Pacific", async () => {
    const w = await startWorker({
      vars: { ...BASE_VARS, AI_ACCESS: "public", AI_RATE_LIMIT_PER_DAY: "2" },
      persistTo: await freshState(),
    });
    try {
      await expectOk(w, 2);
      const ra = await expect429(w, /used your 2 AI requests for today/);
      assert.ok(ra >= 1 && ra <= 25 * 3600, `Retry-After ${ra}`);
    } finally {
      await w.stop();
    }
  });

  test("allowlisted uid in public mode is exempt from the per-user daily limit", async () => {
    const w = await startWorker({
      vars: { ...BASE_VARS, AI_ACCESS: "public", AI_RATE_LIMIT_PER_DAY: "1", AI_ALLOWED_UIDS: uid },
      persistTo: await freshState(),
    });
    try {
      await expectOk(w, 3);
    } finally {
      await w.stop();
    }
  });

  test("global daily cap: the demo reserve is only for allowlisted uids (counters survive a restart)", async () => {
    const state = await freshState();
    const limits = { AI_GLOBAL_DAILY_CAP: "4", AI_DEMO_RESERVE: "2" };
    // Not allowlisted: may use cap - reserve = 2.
    let w = await startWorker({ vars: { ...BASE_VARS, ...limits, AI_ACCESS: "public" }, persistTo: state });
    try {
      await expectOk(w, 2);
      await expect429(w, /^Today's shared AI allowance is used up/);
    } finally {
      await w.stop();
    }
    // Restart on the same state, now allowlisted: the 2 reserved requests, then the cap.
    w = await startWorker({
      vars: { ...BASE_VARS, ...limits, AI_ACCESS: "public", AI_ALLOWED_UIDS: uid },
      persistTo: state,
    });
    try {
      await expectOk(w, 2);
      await expect429(w, /^Today's shared AI allowance is used up/);
    } finally {
      await w.stop();
    }
  });

  test("per-user daily count survives a wrangler dev restart (--persist-to)", async () => {
    const state = await freshState();
    const vars = { ...BASE_VARS, AI_ACCESS: "public", AI_RATE_LIMIT_PER_DAY: "3" };
    let w = await startWorker({ vars, persistTo: state });
    try {
      await expectOk(w, 2);
    } finally {
      await w.stop();
    }
    w = await startWorker({ vars, persistTo: state });
    try {
      await expectOk(w, 1);
      await expect429(w, /used your 3 AI requests for today/);
    } finally {
      await w.stop();
    }
  });
});
