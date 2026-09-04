import assert from "node:assert/strict";
import test from "node:test";
import { apply } from "./index.mjs";

test("session filtering skips subagents without changing main-session recall", async () => {
  const handlers = new Map();
  let memoryRuntime;
  const ctx = {
    logger: { debug() {} },
    provide(name, value) {
      if (name === "openvikingMemory") memoryRuntime = value;
    },
    effect(execute) {
      execute();
      return async () => {};
    },
    tools: { register() {} },
    plugin() {},
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  apply(ctx, {
    endpoint: "http://127.0.0.1:1933",
    workspacePeer: false,
    skipSubagentSessions: true,
  });

  const agent = {
    session: { id: "dsh-final-batch", header: { cwd: "/workspace" } },
    ctx: {
      effect(execute) {
        execute();
        return async () => {};
      },
    },
  };
  const sessionStart = handlers.get("agent/session-start");
  assert.equal(typeof sessionStart, "function");

  const preStep = handlers.get("agent/pre-step");
  const initial = [message("initial input")];
  const downstream = [message("downstream replacement")];
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/health") return response({});
    if (path === "/api/v1/sessions") return response({});
    if (path === "/api/v1/search/search") {
      seen.push(JSON.parse(init.body).query);
      return response({ rendered: "" });
    }
    if (path === "/api/v1/fs/ls") return response([]);
    return response({}, 404);
  };

  try {
    await preStep({
      agent,
      messages: initial,
      signal: new AbortController().signal,
    }, async () => ({ kind: "enter", messages: downstream }));

    const child = {
      status: "idle",
      session: {
        id: "dsh-derived-child",
        header: { cwd: "/workspace", origin: "subagent" },
      },
      inject() {
        assert.fail("subagent profile must not be injected");
      },
      ctx: {
        effect() {
          assert.fail("subagent teardown commit must not be registered");
        },
      },
    };
    assert.equal(await sessionStart({ agent: child }), false);
    const childMessages = [message("derived worker input")];
    const childDecision = await preStep({
      agent: child,
      messages: childMessages,
      signal: new AbortController().signal,
    }, async () => ({ kind: "enter", messages: childMessages }));
    handlers.get("session/event")(child.session, {
      type: "user/message",
      data: message("derived exploration chatter"),
    });
    handlers.get("session/event")(child.session, { type: "turn/end", data: {} });
    await handlers.get("session/flush")(child.session);

    assert.deepEqual(childDecision.messages, childMessages);
    assert.equal(memoryRuntime.states.has(child.session.id), false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(seen, ["downstream replacement"]);
});

function message(text) {
  return {
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  };
}

function response(result, status = 200) {
  return new Response(JSON.stringify({
    status: status < 400 ? "ok" : "error",
    ...(status < 400 ? { result } : { error: { code: "NOT_FOUND" } }),
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("agent/pre-step runs profile and recall concurrently", async () => {
  const handlers = new Map();
  let memoryRuntime;
  const ctx = {
    logger: { debug() {} },
    provide(name, value) {
      if (name === "openvikingMemory") memoryRuntime = value;
    },
    effect(execute) {
      execute();
      return async () => {};
    },
    tools: { register() {} },
    plugin() {},
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  apply(ctx, {
    endpoint: "http://127.0.0.1:1933",
    workspacePeer: false,
    skipSubagentSessions: false,
  });

  let recallEntered = false;
  let profileSawRecall = false;
  let resolveRecallGate;
  const recallGate = new Promise((resolve) => {
    resolveRecallGate = resolve;
  });

  memoryRuntime.profileMessage = async () => {
    // Wait until recall has started; sequential awaits would hang / fail this gate.
    const timed = Promise.race([
      recallGate,
      new Promise((_, reject) => setTimeout(() => reject(new Error("profile waited too long for concurrent recall")), 500)),
    ]);
    await timed;
    profileSawRecall = recallEntered;
    return message("profile-msg");
  };
  memoryRuntime.recallMessage = async () => {
    recallEntered = true;
    resolveRecallGate();
    return message("recall-msg");
  };

  const agent = {
    session: { id: "dsh-parallel", header: { cwd: "/workspace" } },
    ctx: {
      effect(execute) {
        execute();
        return async () => {};
      },
    },
  };
  const preStep = handlers.get("agent/pre-step");
  const initial = [message("user input")];
  const decision = await preStep(
    { agent, messages: initial, signal: new AbortController().signal },
    async () => ({ kind: "enter", messages: initial }),
  );

  assert.equal(profileSawRecall, true);
  assert.deepEqual(
    decision.messages.map((m) => m.content[0].text),
    ["user input", "profile-msg", "recall-msg"],
  );
});
