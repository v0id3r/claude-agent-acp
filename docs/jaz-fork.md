# Jaz fork

This fork is upstream [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)
v0.112.0 plus the patches below and standalone packaging. Each patch is meant to go upstream; drop it
once upstream covers its contract.

| Patch                     | Where                                                                            | What it changes                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal exit status      | `src/v2/tasks.ts`                                                                | A background command's terminal exit carries the exit code from its `task_notification` summary (`… failed with exit code 3`). Without a code the exit stays empty, as upstream reports it. |
| Context window matching   | `src/session-usage.ts`                                                           | `modelUsage` matches the current model by its canonical form instead of the longest shared prefix, so a prefix cannot borrow another model's window.                                        |
| Reported model resolution | `src/session-model.ts`, `src/v1/acp-agent.ts`                                    | A model that Claude reports maps to the row with that id or resolved model, then to one that differs only by the context suffix. Upstream's preference matching can pick a sibling row.     |
| Standalone releases       | `.github/workflows/release-standalone.yml`, `script/build-standalone-release.sh` | Platform archives that bundle Claude Code. Upstream's npm, release-please and preview workflows are removed. See [RELEASES.md](RELEASES.md).                                                |

## Upstream tests

Upstream tests run unmodified, except where a patch changes the behaviour under test:

| Test file                            | Patch                     | What changes                                                            |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------------- |
| `src/tests/v2/acp-v2.test.ts`        | terminal exit status      | assertions for the exit code carried from the task notification summary |
| `src/tests/model-resolution.test.ts` | reported model resolution | adds the provider-reported-variant case                                 |
| `src/tests/v1/acp-agent.test.ts`     | context window matching   | adds the shared-name-prefix window case                                 |
| `src/tests/v2/v2.test.ts`            | context window matching   | the usage_update window comes from the modelUsage row Claude reported   |

## v0.112.0 notes

Upstream v0.112.0 adds the AIR `sessionRewind` capability (opt-in `_session/rewind` on ACP v1) and
stops holding MCP requests Claude Code abandoned. The fork takes both unchanged. A client that does
not declare `sessionRewind` sees no rewind and no behaviour change.
