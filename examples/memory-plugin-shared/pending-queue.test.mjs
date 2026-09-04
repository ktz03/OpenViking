import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  drainPendingForSession,
  enqueue,
  listPending,
} from "./lib/pending-queue.mjs";

const originalEnv = {
  dir: process.env.OPENVIKING_PENDING_DIR,
  maxRetries: process.env.OPENVIKING_PENDING_MAX_RETRIES,
  replayLimit: process.env.OPENVIKING_PENDING_REPLAY_LIMIT,
  ttlDays: process.env.OPENVIKING_PENDING_TTL_DAYS,
};

async function withPendingDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "openviking-shared-pending-test-"));
  process.env.OPENVIKING_PENDING_DIR = dir;
  process.env.OPENVIKING_PENDING_MAX_RETRIES = "3";
  process.env.OPENVIKING_PENDING_REPLAY_LIMIT = "50";
  process.env.OPENVIKING_PENDING_TTL_DAYS = "7";
  try {
    return await fn(dir);
  } finally {
    for (const [key, envName] of [
      ["dir", "OPENVIKING_PENDING_DIR"],
      ["maxRetries", "OPENVIKING_PENDING_MAX_RETRIES"],
      ["replayLimit", "OPENVIKING_PENDING_REPLAY_LIMIT"],
      ["ttlDays", "OPENVIKING_PENDING_TTL_DAYS"],
    ]) {
      if (originalEnv[key] === undefined) delete process.env[envName];
      else process.env[envName] = originalEnv[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("drainPendingForSession drains backlog larger than one replay window", async () => {
  await withPendingDir(async () => {
    process.env.OPENVIKING_PENDING_REPLAY_LIMIT = "5";
    let posts = 0;
    const fetchJSON = async (path, init) => {
      if (String(path).includes("/messages") && init?.method === "POST") {
        posts += 1;
        return { ok: true, result: {} };
      }
      return { ok: true, result: {} };
    };
    for (let i = 0; i < 12; i++) {
      await enqueue("addMessage", "drain-session", { role: "user", content: `m${i}` }, { createdAt: i + 1 });
    }
    const result = await drainPendingForSession(fetchJSON, () => {}, {
      sessionId: "drain-session",
      maxRounds: 40,
    });
    assert.equal(result.ok, true);
    assert.ok(posts >= 12);
    assert.equal((await listPending()).length, 0);
  });
});

test("drainPendingForSession stops after retryable failure without exhausting retries", async () => {
  await withPendingDir(async () => {
    process.env.OPENVIKING_PENDING_REPLAY_LIMIT = "1";
    process.env.OPENVIKING_PENDING_MAX_RETRIES = "3";
    let m0Attempts = 0;
    const fetchJSON = async (path, init) => {
      if (String(path).includes("/messages") && init?.method === "POST") {
        const body = JSON.parse(String(init.body || "{}"));
        if (body.content === "m0") {
          m0Attempts += 1;
          return { ok: false, status: 500, error: { message: "retryable" } };
        }
        return { ok: true, result: {} };
      }
      return { ok: true, result: {} };
    };
    const t0 = Date.now();
    await enqueue("addMessage", "drain-session", { role: "user", content: "m0" }, { createdAt: t0 });
    await enqueue("addMessage", "drain-session", { role: "user", content: "m1" }, { createdAt: t0 + 1 });
    const result = await drainPendingForSession(fetchJSON, () => {}, {
      sessionId: "drain-session",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "retryable-failure");
    assert.equal(m0Attempts, 1);
    const pending = await listPending();
    assert.equal(pending.length, 2);
  });
});
