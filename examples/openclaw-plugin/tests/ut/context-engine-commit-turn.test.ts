import { beforeEach, describe, expect, it, vi } from "vitest";

const afterTurnOpenVikingSession = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/context-lifecycle-service.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/context-lifecycle-service.js")>(
    "../../services/context-lifecycle-service.js",
  );
  return {
    ...actual,
    afterTurnOpenVikingSession,
  };
});

import type { OpenVikingClient } from "../../client.js";
import { memoryOpenVikingConfigSchema } from "../../config.js";
import { createMemoryOpenVikingContextEngine } from "../../context-engine.js";

function makeEngine() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return createMemoryOpenVikingContextEngine({
    id: "openviking",
    name: "Context Engine (OpenViking)",
    version: "test",
    cfg: memoryOpenVikingConfigSchema.parse({ mode: "remote", baseUrl: "http://127.0.0.1:1933" }),
    logger,
    getClient: vi.fn().mockResolvedValue({} as OpenVikingClient),
    resolveAgentId: vi.fn(() => "agent"),
  });
}

beforeEach(() => {
  afterTurnOpenVikingSession.mockClear();
});

// OpenClaw >=2026.8.1 degrades the engine to "legacy" every turn unless both
// transcript semantics are declared and commitTurn exists.
describe("context-engine durable turn contract (OpenClaw 2026.8.1)", () => {
  it("declares transcript semantics", () => {
    expect(makeEngine().info.transcriptSemantics).toEqual({
      currentTurnFence: "before-current-turn-entry-v1",
      turnAdvancementIdempotency: "atomic-idempotent-v1",
    });
  });

  it("commitTurn is idempotent per advancementKey", async () => {
    const engine = makeEngine();
    const params = { advancementKey: "k1", sessionId: "s", messages: [] };
    await expect(engine.commitTurn(params)).resolves.toEqual({ status: "committed" });
    await expect(engine.commitTurn(params)).resolves.toEqual({ status: "duplicate" });
    await expect(engine.commitTurn({ ...params, advancementKey: "k2" })).resolves.toEqual({
      status: "committed",
    });
  });

  it("commitTurn persists closed-turn messages before acknowledging (#4850)", async () => {
    const engine = makeEngine();
    const messages = [{ role: "user", content: "hello" }] as never[];
    await expect(
      engine.commitTurn({
        advancementKey: "persist-1",
        sessionId: "sess-1",
        sessionKey: "agent:main:sess-1",
        messages,
      }),
    ).resolves.toEqual({ status: "committed" });

    expect(afterTurnOpenVikingSession).toHaveBeenCalledTimes(1);
    expect(afterTurnOpenVikingSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        messages,
        prePromptMessageCount: 0,
      }),
    );

    await expect(
      engine.commitTurn({
        advancementKey: "persist-1",
        sessionId: "sess-1",
        messages,
      }),
    ).resolves.toEqual({ status: "duplicate" });
    expect(afterTurnOpenVikingSession).toHaveBeenCalledTimes(1);
  });
});
