import { describe, expect, it, vi } from "vitest";
import { ClaudeAcpAgent } from "../../v1/acp-agent.js";
import type { AcpClient } from "../../acp-client.js";
import { Pushable } from "../../utils.js";
import {
  mockSessionState,
  successfulResultMessage,
  userEcho,
  wrapQuery,
} from "./session-doubles.js";

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  const refused = () => {
    throw new Error("Unexpected real SDK call");
  };
  return {
    ...actual,
    query: vi.fn(refused),
    getSessionMessages: vi.fn(async () => []),
    getSubagentMessages: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    getSessionInfo: vi.fn(async () => undefined),
    deleteSession: vi.fn(refused),
    forkSession: vi.fn(refused),
    importSessionToStore: vi.fn(refused),
  };
});

async function untilDone<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Prompt did not settle")), 3000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function createAgent() {
  const client = { sessionUpdate: async () => {} } as unknown as AcpClient;
  return new ClaudeAcpAgent(client, { log: () => {}, error: () => {} });
}

function usage(inputTokens: number, outputTokens: number) {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

const idle = { type: "system", subtype: "session_state_changed", state: "idle" };

describe("a steer with waitForCompletion", () => {
  it("answers with the joined turn's terminal outcome, not the interrupted cycle's", async () => {
    const agent = createAgent();
    const input = new Pushable<any>();
    const echoed = Promise.withResolvers<void>();
    const interrupted = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const processed = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let response: unknown;
    let steerResponse: unknown;
    async function* messages() {
      const iter = input[Symbol.asyncIterator]();
      const { value: original } = await iter.next();
      yield userEcho(original);
      echoed.resolve();
      const { value: steered } = await iter.next();
      yield successfulResultMessage({
        origin: { kind: "human" },
        user_message_uuid: original.uuid,
        user_message_uuids: [original.uuid],
        queued_turn_count: 1,
        stop_reason: "tool_use",
        usage: usage(10, 5),
      });
      interrupted.resolve();
      await resume.promise;
      yield userEcho(steered);
      yield successfulResultMessage({
        origin: { kind: "human" },
        user_message_uuid: steered.uuid,
        user_message_uuids: [steered.uuid],
        queued_turn_count: 0,
        stop_reason: "max_tokens",
        usage: usage(20, 7),
      });
      yield idle;
      processed.resolve();
      await finish.promise;
    }
    const session = mockSessionState({ input, query: wrapQuery(messages()) });
    agent.sessions["test-session"] = session;
    const prompt = agent
      .prompt({ sessionId: "test-session", prompt: [{ type: "text", text: "original" }] })
      .then((value) => (response = value));
    const steer = agent
      .steer({
        sessionId: "test-session",
        prompt: [{ type: "text", text: "also handle this" }],
        waitForCompletion: true,
      })
      .then((value) => (steerResponse = value));
    try {
      await untilDone(echoed.promise);
      await untilDone(interrupted.promise);
      // The interrupted cycle's result already exists; the steer must not have
      // answered with it.
      expect(steerResponse).toBeUndefined();
      resume.resolve();
      await untilDone(processed.promise);
      await untilDone(steer);
      await untilDone(prompt);
      expect(response).toMatchObject({ stopReason: "max_tokens" });
      expect(steerResponse).toEqual({
        outcome: "injected",
        stopReason: "max_tokens",
        _meta: (response as { _meta: unknown })._meta,
      });
      expect(
        steerResponse && (steerResponse as { _meta?: { quota?: unknown } })._meta?.quota,
      ).toBeDefined();
      expect(session.activeTurn).toBeNull();
    } finally {
      resume.resolve();
      finish.resolve();
      await untilDone(session.consumer);
      await untilDone(prompt);
      await steer.catch(() => {});
    }
  });

  it("answers startedNewTurn with the new turn's outcome at an idle session", async () => {
    const agent = createAgent();
    const input = new Pushable<any>();
    const echoed = Promise.withResolvers<void>();
    const processed = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let response: unknown;
    async function* messages() {
      const iter = input[Symbol.asyncIterator]();
      const { value: steered } = await iter.next();
      yield userEcho(steered);
      echoed.resolve();
      yield successfulResultMessage({
        user_message_uuid: steered.uuid,
        user_message_uuids: [steered.uuid],
        usage: usage(3, 2),
      });
      yield idle;
      processed.resolve();
      await finish.promise;
    }
    const session = mockSessionState({ input, query: wrapQuery(messages()) });
    agent.sessions["test-session"] = session;
    const steer = agent
      .steer({
        sessionId: "test-session",
        prompt: [{ type: "text", text: "start something" }],
        waitForCompletion: true,
      })
      .then((value) => (response = value));
    try {
      await untilDone(echoed.promise);
      await untilDone(processed.promise);
      await untilDone(steer);
      expect(response).toEqual({
        outcome: "startedNewTurn",
        stopReason: "end_turn",
        _meta: expect.objectContaining({ quota: expect.anything() }),
      });
    } finally {
      finish.resolve();
      await untilDone(session.consumer);
      await steer.catch(() => {});
    }
  });

  it("still answers promptRequired immediately when an idle session opts in", async () => {
    const agent = createAgent();
    const input = new Pushable<any>();
    const finish = Promise.withResolvers<void>();
    async function* messages() {
      yield idle;
      await finish.promise;
    }
    const session = mockSessionState({ input, query: wrapQuery(messages()) });
    agent.sessions["test-session"] = session;
    try {
      await expect(
        agent.steer({
          sessionId: "test-session",
          prompt: [{ type: "text", text: "anything" }],
          waitForCompletion: true,
          _meta: { steering: { idleBehavior: "promptRequired" } },
        }),
      ).resolves.toEqual({ outcome: "promptRequired", reason: "noRunningTurn" });
      expect(session.turnQueue ?? []).toHaveLength(0);
    } finally {
      finish.resolve();
      await untilDone(session.consumer);
    }
  });

  it("answers cancelled when a cancel settles the joined turn first", async () => {
    const agent = createAgent();
    // The steered turn's answer never comes; the cancel backstop settles it.
    agent.forceCancelGraceMs = 20;
    const input = new Pushable<any>();
    const echoed = Promise.withResolvers<void>();
    const steeredIn = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let response: unknown;
    async function* messages() {
      const iter = input[Symbol.asyncIterator]();
      const { value: original } = await iter.next();
      yield userEcho(original);
      echoed.resolve();
      await iter.next();
      steeredIn.resolve();
      await finish.promise;
    }
    const session = mockSessionState({ input, query: wrapQuery(messages()) });
    agent.sessions["test-session"] = session;
    const prompt = agent
      .prompt({ sessionId: "test-session", prompt: [{ type: "text", text: "original" }] })
      .then((value) => (response = value));
    const steer = agent.steer({
      sessionId: "test-session",
      prompt: [{ type: "text", text: "stop and answer" }],
      waitForCompletion: true,
    });
    try {
      await untilDone(echoed.promise);
      await untilDone(steeredIn.promise);
      // cancel() marks the session cancelled synchronously; the interrupt's
      // trailing idle then settles the turn through the consumer.
      const cancelling = agent.cancel({ sessionId: "test-session" });
      input.push(idle);
      await untilDone(cancelling);
      await expect(steer).resolves.toMatchObject({
        outcome: "injected",
        stopReason: "cancelled",
        _meta: { quota: { token_count: { totalTokens: 0 } } },
      });
      await untilDone(prompt);
      expect(response).toMatchObject({ stopReason: "cancelled" });
    } finally {
      finish.resolve();
      await untilDone(session.consumer);
      await untilDone(prompt);
      await steer.catch(() => {});
    }
  });
});
