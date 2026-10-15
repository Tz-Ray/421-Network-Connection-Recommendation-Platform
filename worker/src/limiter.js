// worker/src/limiter.js
//
// Every AI request is counted by ONE Durable Object instance (idFromName("global"))
// backed by SQLite storage, so the counters are shared by every Worker isolate and
// survive restarts and deploys. It keeps four counters:
//
//   - per user, a sliding 60-second window          (AI_RATE_LIMIT_PER_MIN)
//   - per user, a daily count                       (AI_RATE_LIMIT_PER_DAY; allowlisted uids are exempt)
//   - per network address, a daily count            (AI_RATE_LIMIT_PER_IP_DAY; allowlisted uids are
//                                                   exempt), so throwaway accounts from one place
//                                                   can't use up the shared allowance; the address is
//                                                   stored only as a hash and dropped the next day
//   - for everyone together, a daily count of Gemini calls (AI_GLOBAL_DAILY_CAP), whose last
//     AI_DEMO_RESERVE calls only allowlisted uids may use. `charge` counts a request's first call;
//     `chargeCall` counts each further one (retries, the fallback model, the strict second pass).
//
// A "day" is the calendar date in America/Los_Angeles, because the Gemini free-tier
// daily quota resets at midnight Pacific time. A request is charged only when every
// check passes; a refused request costs nothing.

import { DurableObject } from "cloudflare:workers";

const WINDOW_MS = 60_000;
const DAY_TZ = "America/Los_Angeles";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DAY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DAY_TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "YYYY-MM-DD" for the Pacific calendar date of `ms`. */
export function pacificDayKey(ms) {
  return dayFormatter.format(new Date(ms));
}

/** Whole seconds (>= 1) until the next midnight in America/Los_Angeles, DST-aware. */
export function secondsUntilPacificMidnight(now) {
  const parts = Object.fromEntries(timeFormatter.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const elapsed = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  let secs = 86_400 - elapsed;
  const today = pacificDayKey(now);
  // A 25-hour day (DST ends): 24h-based guess still lands on today.
  if (pacificDayKey(now + secs * 1000) === today) secs += 3600;
  // A 23-hour day (DST starts): an hour earlier is already tomorrow.
  else if (secs > 3600 && pacificDayKey(now + (secs - 3600) * 1000) !== today) secs -= 3600;
  return Math.max(1, secs);
}

function refuse(retryAfter, error, kind) {
  return { ok: false, status: 429, retryAfter, error, kind };
}

export class RateLimiter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS minute_hits (uid TEXT NOT NULL, ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS minute_hits_uid_ts ON minute_hits (uid, ts);
      CREATE INDEX IF NOT EXISTS minute_hits_ts ON minute_hits (ts);
      CREATE TABLE IF NOT EXISTS user_daily (day TEXT NOT NULL, uid TEXT NOT NULL, used INTEGER NOT NULL,
        PRIMARY KEY (day, uid));
      CREATE TABLE IF NOT EXISTS global_daily (day TEXT PRIMARY KEY, used INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ip_daily (day TEXT NOT NULL, ip TEXT NOT NULL, used INTEGER NOT NULL,
        PRIMARY KEY (day, ip));
    `);
  }

  /**
   * Counts one request for `uid`, or refuses it.
   * limits = { perMin, perDay, perIpDay, globalCap, demoReserve }; privileged = uid is allowlisted;
   * ipKey = hashed caller address, or "" when unknown (then no per-address limit applies).
   * Returns { ok: true, ... } or { ok: false, status: 429, retryAfter, error, kind }.
   */
  charge({ uid, ipKey = "", privileged, limits }) {
    const now = Date.now();
    const day = pacificDayKey(now);
    const { perMin, perDay, perIpDay, globalCap, demoReserve } = limits;

    // Opportunistic cleanup: old window entries and earlier days.
    this.sql.exec("DELETE FROM minute_hits WHERE ts <= ?", now - WINDOW_MS);
    this.sql.exec("DELETE FROM user_daily WHERE day < ?", day);
    this.sql.exec("DELETE FROM global_daily WHERE day < ?", day);
    this.sql.exec("DELETE FROM ip_daily WHERE day < ?", day);

    // 1) Per-user sliding 60-second window.
    const minute = this.sql
      .exec("SELECT COUNT(*) AS n, MIN(ts) AS oldest FROM minute_hits WHERE uid = ? AND ts > ?", uid, now - WINDOW_MS)
      .one();
    if (minute.n >= perMin) {
      const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - minute.oldest)) / 1000));
      return refuse(retryAfter, `Rate limit reached. Try again in ${retryAfter} seconds.`, "minute");
    }

    // 2) Per-user daily count (allowlisted uids are exempt; they are still under the global cap).
    const userRow = this.sql.exec("SELECT used FROM user_daily WHERE day = ? AND uid = ?", day, uid).toArray()[0];
    const userUsed = userRow ? userRow.used : 0;
    if (!privileged && userUsed >= perDay) {
      const retryAfter = secondsUntilPacificMidnight(now);
      return refuse(
        retryAfter,
        `You've used your ${perDay} AI requests for today. They reset at midnight Pacific time.`,
        "user-day"
      );
    }

    // 3) Per-address daily count (allowlisted uids are exempt).
    const checkIp = !privileged && ipKey !== "";
    if (checkIp) {
      const ipRow = this.sql.exec("SELECT used FROM ip_daily WHERE day = ? AND ip = ?", day, ipKey).toArray()[0];
      if ((ipRow ? ipRow.used : 0) >= perIpDay) {
        const retryAfter = secondsUntilPacificMidnight(now);
        return refuse(
          retryAfter,
          "Too many AI requests from your network today. They reset at midnight Pacific time.",
          "ip-day"
        );
      }
    }

    // 4) Shared daily allowance; the last `demoReserve` calls are for allowlisted uids only.
    const globalUsed = this.globalUsed(day);
    if (globalUsed >= this.ceiling(privileged, limits)) return this.refuseGlobal(now);

    // Charge all three.
    this.sql.exec("INSERT INTO minute_hits (uid, ts) VALUES (?, ?)", uid, now);
    this.sql.exec(
      "INSERT INTO user_daily (day, uid, used) VALUES (?, ?, 1) ON CONFLICT (day, uid) DO UPDATE SET used = used + 1",
      day,
      uid
    );
    if (checkIp) {
      this.sql.exec(
        "INSERT INTO ip_daily (day, ip, used) VALUES (?, ?, 1) ON CONFLICT (day, ip) DO UPDATE SET used = used + 1",
        day,
        ipKey
      );
    }
    this.bumpGlobal(day);
    return { ok: true, day, userUsed: userUsed + 1, globalUsed: globalUsed + 1 };
  }

  /**
   * Counts one more Gemini call for a request that `charge` already let through
   * (its first call is included there), or refuses it when the shared allowance
   * is used up. Same result shape as `charge`.
   */
  chargeCall({ privileged, limits }) {
    const now = Date.now();
    const day = pacificDayKey(now);
    const globalUsed = this.globalUsed(day);
    if (globalUsed >= this.ceiling(privileged, limits)) return this.refuseGlobal(now);
    this.bumpGlobal(day);
    return { ok: true, day, globalUsed: globalUsed + 1 };
  }

  globalUsed(day) {
    const row = this.sql.exec("SELECT used FROM global_daily WHERE day = ?", day).toArray()[0];
    return row ? row.used : 0;
  }

  ceiling(privileged, { globalCap, demoReserve }) {
    return privileged ? globalCap : Math.max(0, globalCap - demoReserve);
  }

  refuseGlobal(now) {
    return refuse(
      secondsUntilPacificMidnight(now),
      "Today's shared AI allowance is used up. It resets at midnight Pacific time.",
      "global-day"
    );
  }

  bumpGlobal(day) {
    this.sql.exec(
      "INSERT INTO global_daily (day, used) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET used = used + 1",
      day
    );
  }
}
