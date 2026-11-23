import { PromptRequest, RequestError } from "@agentclientprotocol/sdk/unstable";
import type { StopReason } from "./turn-events.js";

/** Custom (extension) request method a client uses to steer the turn that is
 *  currently running: the message is injected into the in-flight turn rather
 *  than queued as a separate `session/prompt`. Named `_session/steering` per the
 *  agreed ACP steering wire protocol; advertised to clients via the top-level
 *  `InitializeResponse._meta.steering.supported`. */
export const STEER_METHOD = "_session/steering";

/** Request-level steering options. `promptRequired` is opt-in so existing Hosts
 *  keep the established idle fallback behavior. */
type SteerMeta = {
  [key: string]: unknown;
  steering?: {
    idleBehavior?: "promptRequired";
  };
};

/** Params of a {@link STEER_METHOD} request. Shaped like the relevant subset of
 *  a `PromptRequest` so the same `promptToClaude` conversion applies. Delivery
 *  priority is deliberately NOT exposed here — it's an internal detail the agent
 *  chooses. */
export type SteerRequest = {
  sessionId: string;
  prompt: PromptRequest["prompt"];
  /** Answer only once the work this steer joins has settled: the response then
   *  carries the turn's terminal `stopReason` and `_meta`, like a prompt
   *  response. Without it the response keeps the established immediate shape. */
  waitForCompletion?: boolean;
  _meta?: SteerMeta | null;
};

/** Terminal fields are present only for a `waitForCompletion` request. */
type SteerTurnResult = {
  stopReason?: StopReason;
  _meta?: Record<string, unknown>;
};

/** Result of a {@link STEER_METHOD} request. The legacy `startedNewTurn` result
 *  remains the default idle behavior; `promptRequired` is returned only when the
 *  Host explicitly opts into the host-owned fallback in request `_meta`. */
export type SteerResponse =
  | ({ outcome: "injected" } & SteerTurnResult)
  | ({ outcome: "startedNewTurn" } & SteerTurnResult)
  | { outcome: "promptRequired"; reason: "noRunningTurn" };

/** Validate raw JSON-RPC params into a {@link SteerRequest}. Kept minimal — the
 *  content blocks are handed to `promptToClaude`, which tolerates unknown block
 *  types — but `sessionId` and a non-empty `prompt` array are required. */
export function parseSteerRequest(params: unknown): SteerRequest {
  if (!params || typeof params !== "object") {
    throw RequestError.invalidParams(undefined, "steer params must be an object");
  }
  const { sessionId, prompt, waitForCompletion, _meta } = params as Record<string, unknown>;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw RequestError.invalidParams(undefined, "steer params require a non-empty sessionId");
  }
  if (!Array.isArray(prompt) || prompt.length === 0) {
    throw RequestError.invalidParams(undefined, "steer params require a non-empty prompt array");
  }
  if (waitForCompletion !== undefined && typeof waitForCompletion !== "boolean") {
    throw RequestError.invalidParams(undefined, "steer params require a boolean waitForCompletion");
  }
  const steering =
    _meta && typeof _meta === "object" ? (_meta as Record<string, unknown>).steering : undefined;
  const idleBehavior =
    steering && typeof steering === "object"
      ? (steering as Record<string, unknown>).idleBehavior
      : undefined;
  if (idleBehavior !== undefined && idleBehavior !== "promptRequired") {
    throw RequestError.invalidParams(undefined, "unsupported steering idleBehavior");
  }
  return {
    sessionId,
    prompt: prompt as PromptRequest["prompt"],
    waitForCompletion: waitForCompletion === true,
    _meta: _meta as SteerMeta | null | undefined,
  };
}
