import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SyncManager } from "../sync.ts";
import { enqueue, listPending } from "../shared/pending-queue.mjs";

function config(overrides = {}) {
  return {
    commitTokenThreshold: 20000,
    commitKeepRecentCount: 10,
    captureAssistantTurns: true,
    captureToolMaxChars: 2000,
    captureMaxLength: 24000,
    takeoverEnabled: true,
    ...overrides,
  };
}

function client(overrides = {}) {
  return {
    connected: true,
    addMessagePayload: async () => true,
    getSession: async () => ({ pending_tokens: 0 }),
    commitSession: async () => ({ task_id: "t-1", archive_uri: "viking://archive/1" }),
    commitSessionResponse: async () => ({
      result: { task_id: "t-1", archive_uri: "viking://archive/1" },
    }),
    fetchJSON: async () => ({ ok: true, result: {} }),
    ...overrides,
  };
}

async function withPendingDir(fn) {
  const previous = process.env.OPENVIKING_PENDING_DIR;
  const dir = await mkdtemp(join(tmpdir(), "ov-pi-pending-"));
  process.env.OPENVIKING_PENDING_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.OPENVIKING_PENDING_DIR;
    else process.env.OPENVIKING_PENDING_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test("syncBranch returns added token accounting and delivered status", async () => {
  await withPendingDir(async () => {
    const c = client();
    const sync = new SyncManager(c, config({ takeoverEnabled: false }));
    await sync.ensureSession("pi-session");

    const result = await sync.syncBranch([
      { type: "message", message: { role: "user", content: "Remember this implementation decision for the next run." } },
    ]);

    assert.equal(result.added, 1);
    assert.ok(result.tokens > 0);
    assert.equal(result.allDelivered, true);
    assert.equal(sync.syncedCount, 1);
  });
});

test("commit writes success trace_id to the pi debug log", async () => {
  await withPendingDir(async (dir) => {
    const previous = process.env.OV_DEBUG_LOG;
    const debugLogPath = join(dir, "pi-debug.log");
    process.env.OV_DEBUG_LOG = debugLogPath;
    try {
      const c = client({
        commitSessionResponse: async () => ({
          result: {
            task_id: "t-trace",
            archive_uri: "viking://archive/trace",
            trace_id: "trace-pi-commit",
          },
          traceId: "trace-pi-commit",
        }),
      });
      const sync = new SyncManager(c, config());
      await sync.ensureSession("pi-trace-session");

      const result = await sync.commit();
      assert.equal(result.trace_id, "trace-pi-commit");
      assert.match(await readFile(debugLogPath, "utf8"), /trace_id=trace-pi-commit/);
    } finally {
      if (previous === undefined) delete process.env.OV_DEBUG_LOG;
      else process.env.OV_DEBUG_LOG = previous;
    }
  });
});

test("commit writes failure trace_id to the pi debug log", async () => {
  await withPendingDir(async (dir) => {
    const previous = process.env.OV_DEBUG_LOG;
    const debugLogPath = join(dir, "pi-debug-error.log");
    process.env.OV_DEBUG_LOG = debugLogPath;
    try {
      const c = client({
        commitSessionResponse: async () => ({
          result: null,
          status: 500,
          traceId: "trace-pi-error",
          error: { message: "commit failed" },
        }),
      });
      const sync = new SyncManager(c, config());
      await sync.ensureSession("pi-trace-error");

      assert.equal(await sync.commit({ queueOnFailure: false }), null);
      const raw = await readFile(debugLogPath, "utf8");
      assert.match(raw, /trace_id=trace-pi-error/);
      assert.match(raw, /error=commit failed/);
    } finally {
      if (previous === undefined) delete process.env.OV_DEBUG_LOG;
      else process.env.OV_DEBUG_LOG = previous;
    }
  });
});

test("queued addMessage makes takeover flush barrier false until replay succeeds", async () => {
  await withPendingDir(async () => {
    let replayOk = false;
    const c = client({
      addMessagePayload: async () => false,
      fetchJSON: async () => ({ ok: replayOk, status: replayOk ? 200 : 500, result: {} }),
    });
    const sync = new SyncManager(c, config());
    await sync.ensureSession("pi-session");

    const result = await sync.syncBranch([
      { type: "message", message: { role: "user", content: "This should be queued for takeover barrier testing." } },
    ]);

    assert.equal(result.added, 1);
    assert.equal(result.allDelivered, false);
    assert.equal((await listPending()).length, 1);
    assert.equal(await sync.flushForTakeover(), false);

    replayOk = true;
    assert.equal(await sync.flushForTakeover(), true);
    assert.equal((await listPending()).length, 0);
  });
});

test("current-session addMessage 500 remains queued and keeps barrier closed", async () => {
  await withPendingDir(async () => {
    const c = client({
      addMessagePayload: async () => false,
      fetchJSON: async () => ({ ok: false, status: 500 }),
    });
    const sync = new SyncManager(c, config());
    await sync.ensureSession("pi-session");

    await sync.addPayload({ role: "user", content: "Queued content with retryable server failure." });

    assert.equal(await sync.flushForTakeover(), false);
    const pending = await listPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].entry.type, "addMessage");
    assert.equal(pending[0].entry.sessionId, sync.sessionId);
  });
});

test("other-session addMessage and commit queue entries do not block takeover barrier", async () => {
  await withPendingDir(async () => {
    const c = client({
      fetchJSON: async () => ({ ok: false, status: 500 }),
    });
    const sync = new SyncManager(c, config());
    await sync.ensureSession("pi-session");

    await enqueue("addMessage", "different-session", { role: "user", content: "other" });
    await enqueue("commitSession", sync.sessionId, { keep_recent_count: 1 });

    assert.equal(await sync.flushForTakeover(), true);
  });
});

test("restoreWatermark prevents pi -c from re-syncing already captured entries", async () => {
  await withPendingDir(async () => {
    const calls = [];
    const c = client({
      addMessagePayload: async (_sid, payload) => {
        calls.push(payload);
        return true;
      },
    });
    const sync = new SyncManager(c, config());
    await sync.ensureSession("pi-session");
    sync.restoreWatermark(1);

    const result = await sync.syncBranch([
      { type: "message", message: { role: "user", content: "Already captured entry should be skipped." } },
      { type: "message", message: { role: "user", content: "Fresh entry should be captured now." } },
    ]);

    assert.equal(result.added, 1);
    assert.equal(calls.length, 1);
    assert.match(calls[0].parts[0].text, /Fresh entry/);
  });
});


test("flushForTakeover drains backlog larger than one replay window", async () => {
  await withPendingDir(async () => {
    process.env.OPENVIKING_PENDING_REPLAY_LIMIT = "5";
    try {
      let posts = 0;
      const c = client({
        fetchJSON: async (path, init) => {
          if (String(path).includes("/messages") && init?.method === "POST") {
            posts += 1;
            return { ok: true, result: {} };
          }
          return { ok: true, result: {} };
        },
      });
      const sync = new SyncManager(c, config());
      await sync.ensureSession("pi-backlog-session");
      const sid = sync.sessionId;
      for (let i = 0; i < 12; i++) {
        await enqueue("addMessage", sid, { role: "user", content: `m${i}` });
      }
      assert.equal((await listPending()).length, 12);
      const ok = await sync.flushForTakeover();
      assert.equal(ok, true);
      assert.ok(posts >= 12);
      assert.equal((await listPending()).length, 0);
    } finally {
      delete process.env.OPENVIKING_PENDING_REPLAY_LIMIT;
    }
  });
});

test("flushForTakeover stops after one retryable failure without exhausting retries", async () => {
  await withPendingDir(async () => {
    process.env.OPENVIKING_PENDING_REPLAY_LIMIT = "1";
    process.env.OPENVIKING_PENDING_MAX_RETRIES = "3";
    try {
      let m0Attempts = 0;
      const c = client({
        fetchJSON: async (path, init) => {
          if (String(path).includes("/messages") && init?.method === "POST") {
            const body = JSON.parse(String(init.body || "{}"));
            if (body.content === "m0") {
              m0Attempts += 1;
              return { ok: false, status: 500, error: { message: "retryable" } };
            }
            return { ok: true, result: {} };
          }
          return { ok: true, result: {} };
        },
      });
      const sync = new SyncManager(c, config());
      await sync.ensureSession("pi-retry-session");
      const sid = sync.sessionId;
      const t0 = Date.now();
      // Pin createdAt so m0 is always replayed first (same-ms enqueue order is unstable).
      await enqueue("addMessage", sid, { role: "user", content: "m0" }, { createdAt: t0 });
      await enqueue("addMessage", sid, { role: "user", content: "m1" }, { createdAt: t0 + 1 });

      assert.equal(await sync.flushForTakeover(), false);
      assert.equal(m0Attempts, 1);
      const pending = await listPending();
      assert.equal(pending.length, 2);
      const byContent = Object.fromEntries(
        pending.map((p) => [p.entry.payload.content, p.entry]),
      );
      assert.equal(byContent.m0.retries, 1);
      assert.equal(byContent.m1.retries, 0);
    } finally {
      delete process.env.OPENVIKING_PENDING_REPLAY_LIMIT;
      delete process.env.OPENVIKING_PENDING_MAX_RETRIES;
    }
  });
});