# Jaz fork

This fork is upstream [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
plus the patches below. Keep each patch until upstream covers its contract.

| Patch                     | Where                                                                            | Why it stays                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_session/mcp/refresh`    | `src/mcp-refresh.ts`, `refreshMcpServers`                                        | Before a turn, Jaz reconnects the native MCP servers whose configuration changed. Upstream reconnects only through the `/mcp reconnect` slash command, which is a prompt turn.                                  |
| Context window unknown    | `src/context-window.ts`, `src/session-usage.ts`                                  | The window is `0` until Claude reports it. Upstream assumes 1,000,000. v1 also leaves the pre-turn control channel free instead of calling `getContextUsage` in the background.                               |
| Native Default effort     | `src/session-effort.ts`, `applyConfigOptionValue`                                | The effort selector keeps `default`, so Claude Code resolves effort itself. Upstream recommends `medium` to a `recommendedValue` client and writes it to the SDK.                                               |
| Reported model resolution | `resolveReportedModel` in `src/session-model.ts`                                 | A model that Claude reports maps to the row with that id or resolved model, then to one that differs only by the context suffix. Upstream's preference matching can pick a sibling row.                         |
| Terminal exit status      | `src/v2/tasks.ts`, `src/v2/terminal.ts`                                          | A background command's terminal exit carries the exit code parsed from its `task_notification` summary (`… failed with exit code 3`). Without a code the exit is empty, as upstream reports it.                 |
| Standalone releases       | `.github/workflows/release-standalone.yml`, `script/build-standalone-release.sh` | Jaz installs platform archives that bundle Claude Code. The npm, release-please and preview workflows are upstream's and are removed. Executables use upstream's `binary-entry.ts` and disable Bun's project dotenv and bunfig autoload. |

## Reverted to upstream

Session titles and automatic compaction returned to upstream behaviour. The patches that removed
them came from the gluonfield fork without a recorded reason; with ACP v2 the prompts are clean, so
the upstream title and compaction turns are kept. Jaz disables idle compaction through the client
settings the adapter forwards (`idleCompaction: false`).

The upstream v1 surface (`src/v1/acp-agent.ts` turn origin, titles and idle-compaction wiring)
is restored on top of v0.111.0: `git diff v0.111.0 HEAD -- src/v1` carries only the PR-able
patches below. `waitForCompletion` steering answers (0f2c6aa) are gone from the tree; the
upstream `_session/steering` contract (outcomes `injected`/`startedNewTurn`/`promptRequired`)
is upstream AIR and untouched.

## Upstream test exceptions

Upstream tests run unmodified except where a patch above changes the behaviour under test:

| Test file | Patch | What changes |
| --- | --- | --- |
| `src/tests/v1/session-config-options.test.ts` | native Default effort | expectations of the recommendedValue effort flow (concrete medium, apply-on-switch) removed |
| `src/tests/v1/acp-agent-settings.test.ts` | native Default effort | same, for settings-derived effort at session start |
| `src/tests/v1/provider-session-configuration.test.ts` | native Default effort | automatic effort stays unpinned (`null`) across refresh/switch |
| `src/tests/v1/ultracode-config.test.ts` | native Default effort | ultracode no longer applies the new model's effort on switch |
| `src/tests/v1/providers.test.ts` | context window unknown | `getContextUsage` may never run; the ordering assertion tolerates the absent call |
| `src/tests/v1/session-doubles.ts` | context window unknown | drops the removed `contextWindowAuthoritative` mock field |
| `src/tests/model-resolution.test.ts` | reported model resolution | adds the provider-reported-variant case |
| `src/tests/recommended-config-values.test.ts` | native Default effort | recommendedValue no longer set on the effort option |
| `src/tests/acp-scenarios/` (compare.ts, harness.ts, snapshots) | all of the above | `withoutJazFork` strips the patches' wire differences; snapshots regenerated |
| `src/tests/v2/acp-v2.test.ts`, `src/tests/v2/v2.test.ts` | terminal exit status | new assertions for the exit code carried from the task notification summary |

The scenario baseline comparison drops these wire differences in one call, `withoutJazFork` in
`src/tests/acp-scenarios/compare.ts`.

## Native parity, 0.93.0-jaz.1

Validated on macOS arm64 on 2026-10-18 with the subscription OAuth profile Jaz uses. No API key
was used. Each run selects `opus[1m]` and asks Claude to read a fixture with its file tool; the ACP
runs declare Jaz's client capabilities.

| Check                             | Claude Code 2.1.300, `-p` | 0.93.0-jaz.1             | 0.89.1-jaz.2             |
| --------------------------------- | ------------------------- | ------------------------ | ------------------------ |
| Claude Code                       | 2.1.300                   | 2.1.300                  | 2.1.296                  |
| Model                             | `claude-opus-5-5[1m]`     | `claude-opus-5-5[1m]`    | `claude-opus-5-5[1m]`    |
| Context window                    | 1,000,000                 | unknown, then 1,000,000  | unknown, then 1,000,000  |
| Tools                             | 39                        | 28                       | the same 28              |
| First user prompt                 | one, the same text        | one, the same text       | one, the same text       |
| First turn input, including cache | 54,132 tokens             | 55,835 tokens            | 55,607 tokens            |
| File read                         | fixture token             | fixture token            | fixture token            |
| Resume in a fresh process, recall | fixture token             | fixture token            | not rerun                |
| `/compact`, then recall           | fixture token             | fixture token            | not rerun                |
| Authentication                    | subscription, no API key  | subscription, no API key | subscription, no API key |

The adapters pass Claude Code identical arguments and environment variable names. The tool sets
differ by mode: headless `-p` drops AskUserQuestion, EnterPlanMode and ExitPlanMode, which an ACP
host keeps, and lists the claude.ai MCP tools that had connected before its first turn. The
228-token difference between the adapters is Claude Code's: in a paired run, 0.89.1-jaz.2 driving
Claude Code 2.1.300 sent the same 55,793 tokens as 0.93.0-jaz.1.

The only other difference in what the adapter sends Claude Code is `promptSuggestions: true` in its
`initialize` request, upstream's default since 0.92.0. Claude Code 2.1.300 skips a suggestion while
the conversation has fewer than two assistant messages, after an API error, in plan mode or with a
permission pending, when its rate limit is not "allowed", and after a turn of more than 10k tokens.
Otherwise it makes one extra request (`source=prompt_suggestion`) over the cached prefix, about
$0.01 per turn at 33k context, and the adapter forwards the result to AIR clients as
`session_info_update._meta.promptSuggestions`. In nine live turns four suggestions survived its
filters. An earlier three-turn probe saw none because every turn hit a gate, and it compared totals
that leave out the request after the last turn. Jaz shows the suggestion as composer ghost text.
