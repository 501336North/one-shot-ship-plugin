# Testing: oss-writer-nofollow

## Suites
| Suite | Runs | Cases |
|---|---|---|
| hooks/__tests__/oss-writer-nofollow.test.sh | REAL hooks + REAL watcher/dist CLIs against a git-cloned malicious repo; asserts $T/outside byte-identical (cksum of every file + listing) | 33 attack + 8 controls = 41 |
| watcher/test/security/oss-writer-nofollow.test.ts | real watcher services, real fs (no mocks) | 13 attack + 3 controls = 16 |
| hooks/__tests__/oss-notify-workflow-name.test.sh | real oss-notify.sh, recording stubs for oss-log/node | 6 invalid names, 3 valid controls, 3 LOW cases = 12 |
| hooks/__tests__/watcher-dist-fresh.test.sh | tsc build of src vs every tracked dist .js; tracked imports | 1 guard |
| hooks/__tests__/session-start-copy.test.sh F12 | session start installs oss-safe-path.sh; ~/.oss/hooks/oss-log.sh writes project logs | +1 |

## RED (commit 3bd4178, before any fix)
- Bash suite: 32 of the 33 attack assertions failed. The 33rd is an auxiliary check ("API key never lands outside" with only a state link), and it already held before the fix. 9/41 passed (8 controls + that check), on bash 3.2 and bash 5.
- Node suite: 13/13 attack cases failed; the 3 controls passed.
- Name suite: 3/11 passed. The 6 invalid names were all logged and fired chain-trigger, the log line was `[failed] '{}'`, and setProgress received `{"progress": "3/9", "currentTask": "Fix "quoted", "x": 1"}`, which is invalid JSON.
  - A 12th case was added in GREEN before its fix: `--session`/`--issue` default context. Its RED showed that `--issue` was never logged at all, because jq failed on `'{}'` under `set -e`.
- dist-fresh: RED on "tracked dist imports untracked files: watcher/dist/utils/safe-project-write.js" until the new dist was committed.
- F12: RED with the HOOKS_TO_COPY entry removed (guard=n, 7/8).

## Attack matrix (sink × link): before → after
| Sink | Links tested | Before | After |
|---|---|---|---|
| oss-log.sh write | .oss/logs→dir, current-session→dir, session.log→file, build.log→file, .oss→dir, session.log hard link | creates/appends outside | refused, rc 0, stderr line |
| oss-log.sh workflow set-feature | health-workflow-state.json→file | overwritten | refused |
| oss-log.sh health-check | health-check.log→file | truncated | refused |
| oss-notify.sh --workflow build failed | state→json, logs→dir, .oss→dir | state merged / logs created / outside state.json + watcher.pid touched | unchanged |
| oss-notify.sh --workflow build start via current-project | state→json | merged | unchanged |
| update-workflow-state.js setSupervisor | state→json, .oss→dir, hard link | overwritten | refused |
| oss-error.js | workflow.log→file, .oss→dir, hard link | appended/created | refused (in-band JSON still printed) |
| drain-queue.js | queue.json.tmp→file | target truncated with queue JSON | refused |
| oss-session-start.sh | .gitignore→file, .claude/settings.local.json→json, .oss→dir | `.oss/*` appended / allow rules merged / outside watcher.pid deleted | unchanged |
| oss-session-end.sh | session-context.md→file, .oss→dir | overwritten / created + logs | unchanged |
| oss-worktree-create.sh | config.json→file, workflow-state.json→json, .oss→dir | API key copied outside / overwritten | refused; API key never outside |
| oss-worktree-remove.sh | .oss→dir | outside config.json, workflow-state.json, logs/ deleted | refused |
| oss-archive-check.sh | dev/completed→dir | feature dir moved outside | refused |
| Node library sinks (queue persist/archive/.oss dir, WorkflowStateService hard link, WorkflowLogger, StatusLineService, WebhookConfig, PRMonitorState, saveAgentConfig, SpecMetricsService, logDiff, Watcher pid+log, WatcherSupervisor) | one link each | written | unchanged |
| oss-notify.sh --workflow `build/../ship`, `Build`, `../x`, `build;ship`, `-ship`, 42 chars | n/a | logged and chain fired | refused, rc 0, no log/state/chain |

## GREEN
- Bash suite 41/41 and name suite 12/12 on /bin/bash 3.2.57 and /opt/local/bin/bash 5.
- Node suite 16/16. dist-fresh: 121 tracked dist .js files fresh. F12 8/8.
- Regression (vitest, one file at a time):
  - queue-manager 31, workflow-logger 17, status-line 23, watcher-supervisor 24, webhook-config 23
  - pr-monitor-state 8, agents/cli 13, spec-metrics 17, diff-generator 28, watcher 18, oss-error 11, workflow-state 56
  - update-workflow-state* 18, health-check 5, workflow-state-* 31, supervisor iron-law 2, webhook integration 7, supervisor-e2e 6, watcher-agents 6
  - All pass.
- `npx tsc --noEmit`: clean. No lint is configured in watcher.
- All hooks/__tests__/*.test.sh and commands/__tests__/*.test.sh were run one at a time. The only failures are the known ones from main:
  - config-change-guard 3/4
  - format-hook 5/6
  - worktree-hooks 5/7 (the hooks.json path; its create/remove behaviour cases pass)
  - ideate-template 3/4

## Anti-vacuity (revert one fixed file to HEAD, run, restore, cmp identical: all identical)
- oss-log.sh → 12 RED · oss-session-start.sh → 2 · oss-session-end.sh → 2 · oss-setup-permissions.sh → 1 · oss-worktree-create.sh → 5 · oss-worktree-remove.sh → 1 · oss-archive-check.sh → 1 · oss-notify.sh → 9 (name suite)
- dist: services/workflow-state.js → 7 · cli/oss-error.js → 3 · queue/manager.js → 1. The bash suite runs the dist CLIs, so a src-only fix stays RED.
- src (vitest): queue/manager 3 · workflow-state 1 · workflow-logger 1 · status-line 1 · webhook-config 1 · pr-monitor-state 1 · agents/config 1 · spec-metrics 1 · diff-generator 1 · index 1 · watcher-supervisor 1
- dist-fresh guard: HEAD dist/services/workflow-state.js put back → "stale watcher/dist: services/workflow-state.js"
- F12: HOOKS_TO_COPY entry removed → RED

## Changed existing tests (no assertion deleted)
- optional-helper-source: the sandbox also ships oss-safe-path.sh, as HOOKS_TO_COPY does.
- pr-monitor-state "save": runs in a real temp project instead of mocking fs.promises.writeFile. The assertions are the same: a file named pr-monitor-state.json containing IC_789.

## Ship round 1 (G1-G16)
| Task | RED | GREEN | Anti-vacuity |
|---|---|---|---|
| G1 | attack 41/42 (dev/active link moved the outside dir) | 42/42 (bash 3.2 and 5) | archive-check reverted: 1 RED |
| G2 | oss-safe-path 3/10 | 10/10 | helper reverted: 3 RED; oss-log reverted: 2 RED |
| G3 | bash rc=1; node 1 failing | 11/11; node 17/17 | each twin reverted: its G3 case RED |
| G4 G5 G8 G14 | oss-safe-path 11/19 | 19/19 | helper reverted: G4, G5 RED; oss-log reverted: G8 x5, G14 RED |
| G6 G7 G13 | node 2 failing (G6, plus G11, later deferred); attack 42/43; G13 4 failing | node 19/19; attack 43/43; oss-safe-path 24/24 | safe-project-write reverted: G6 RED; worktree-create: G7 RED; 3 sourcers: their G13 RED |
| G9 G10 G15 | refactor (behaviour-equivalent) | all suites unchanged and green | n/a |

**G6 coverage gap:** no RED case covers the write-failure cleanup path; only the rename-failure path is tested (that test passed before the change). Both now share one catch that removes the temp file.

**Docs regression fixed in this round:** e00c02d's FOLLOWUPS line named the retired ship preflight hook, which turned its retirement test RED. Reworded; 3/3.

**Final sequential run:** all hooks/__tests__ and commands/__tests__ suites pass except the four failures already on main (config-change-guard, format-hook, worktree-hooks hooks.json path, ideate-template). `npx tsc --noEmit` is clean and dist is fresh (121 files).

## Ship round 2 (N2-1 to N2-5)
| Task | RED | GREEN | Anti-vacuity |
|---|---|---|---|
| N2-1 | attack 43/45 (`tail` created the outside file through a dangling link; tail on a fresh project could not create session.log) | 45/45 (bash 3.2 and 5) | oss-log.sh reverted: 2 RED |
| N2-2 | bash: system-tmp case accepted; node: non-root foreign owner accepted, tmp accepted | oss-safe-path 25/25 (both bashes); node 22/22 | helper reverted: 1 RED; safe-project-write reverted: 3 RED |
| N2-3 | could not go RED on macOS (its kernel already clears setuid/setgid when a non-root user writes); guard test kept | mode now taken from the checked lstat & 0o777 | n/a |
| N2-4 | node: a new config.json was 0644 | 0600 for new, existing mode kept; webhook-config 23/23 | webhook-config.ts reverted: 1 RED |
| N2-5 | doc | TOCTOU comment now matches DECISIONS and the pen test | n/a |

GREEN also fixed a root-project edge in Node: with the project at `/`, the inside-check prefix became `//`, which refused `/usr`. Bash already accepted it.

The `tail` tests stub `tail` on PATH. A first attempt used a perl alarm; it orphaned a `tail -f` process, which I killed by its own PID, not by pkill.

dist rebuilt (121 files fresh); `npx tsc --noEmit` clean.

## Last Updated: 2026-10-19 17:21 +07 by /oss:build round 2
