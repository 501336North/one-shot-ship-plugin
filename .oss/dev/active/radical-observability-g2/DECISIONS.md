# Decisions: Radical Observability G2, Phase B (plugin)

The design-level ADRs (ADR-001 to ADR-010) live in AgenticDevWorkflow `.oss/dev/active/radical-observability-g2/DECISIONS.md`. These are the plugin-side choices made while planning, 2026-11-06.

## P-1: One script, `hooks/oss-timeline.sh`, with fixed verbs
- **Decision:** one script handles everything.
  - Verbs: `command`, `gate`, `merge` and `push`, plus the PostToolUse entry when it is called with no verb.
  - The gate and merge values arrive only through `oss-value.sh timeline gate|merge`.
- **Why:** there is one writer, one lock and one validation table, so nothing can disagree about a field's rules.

## P-2: `merge-unknown` is a local line, never pushed
- **Context:** REQUIREMENTS asks for a `merge-unknown` event when `gh` is unavailable, but the shipped API schema has only `command`, `agent`, `gate` and `merge`.
- **Problem:** a pushed `merge-unknown` line would get a 400 and stay `refused`.
- **Decision:** write `kind: merge-unknown` to the repo copy only, never queue it, and never send it.
- **Consequence:** G3 sees no merge line, which already shows as unverified.
- **Later:** if the dashboard should show it, add the kind to the API schema first, in a separate change.

## P-3: Unfiled lines are never pushed
- **Decision:** a line with no feature folder goes to `.oss/dev/timeline-unfiled.ndjson` and never into the outbox, the same as G1's unfiled decisions.
- **Why:** the API requires `feature`.
- **Not done:** REQUIREMENTS' "attached on the next feature commit" is not built. G1 does not do it either. Revisit both together.

## P-4: No client-side redaction
- **Decision:** the plugin does not redact timeline lines.
- **Why:** every field is checked against a closed pattern before the write, so no field can carry a secret or free text. The API runs `redactRecord` on every field anyway (AC-G2-005.4).
- **What would change it:** a free-text field would need G1's `redact-decision.js` step first.

## P-5: Agent types are lower-cased before the check
- **Why:** built-in types such as `Explore` or `Plan` have capitals, and the API pattern is `^[a-z0-9:_-]{1,64}$`.
- **Decision:** lower-case the type, then check it. A type that still fails is skipped with one stderr line.

## P-6: The gate verb refuses names outside the G3 contract
- **Decision:** a gate name must be one of the four standard names, or match `^[a-z0-9-]{1,40}$` as a quality-gate agent name without its plugin prefix.
- **Pinned by a test:** the gate-to-agent map, copied from G3 `flags.ts`.
- **Why:** a gate named any other way shows as unverified in G3, so the plugin refuses it at write time.

## P-7: The push uses the decisions switch and team policy
- **Decision:** the same local switch (`oss_decisions_push_off`) and the same `GET /api/v1/decisions/policy` apply. There is no second setting.
- **Why:** AC-G2-005.2 says the push is refused "the same way as a decision push". One switch means a user who opted out of decisions is never surprised by a timeline push.

## P-8: Session id
- **Source:** the hook's `.session_id`, then `CLAUDE_CODE_SESSION_ID`, then the fixed value `unknown`.
- **Check:** each candidate must match `^[A-Za-z0-9-]{1,64}$`.
- **Why:** oss-notify has no hook stdin, and the API requires a valid `session`.

## P-9: The merge verb bounds gh with a third inline supervisor
- **Decision:** the merge verb bounds gh with a third inline copy of the supervisor in oss-timeline.sh (`oss_tl_bounded`), checked byte-identical by one-copy-helpers (T81's inline rule; a sourced copy could be missing mid-update).
- **Context:** PLAN.md Task 7 assumed `run_with_timeout` could be reached. It cannot: it and `run_bounded` live inline in oss-notify.sh and oss-session-start.sh, which run their hook body when loaded and cannot be sourced.
- **Decided by:** the build orchestrator, 2026-11-06, when Task 7 found no reachable bounded helper.

## P-10: Two short copies of the outbox and reply code, not one `oss_outbox_*`
- **Decision:** `oss-timeline.sh` keeps its own copy of G1's outbox state log (`waiting()`, `mark()`, `withhold()`) and reply table (`_oss_tl_push`); nothing moved into `oss-api-curl.sh`.
- **Why it is not line for line:**
  - G1's push is the top level of `oss-decision-record.sh`, sharing globals, its EXIT trap and its record lock with the writer above it; the timeline push is a verb of its own that finds its outbox from the project, not from a record it just wrote.
  - The bodies differ: G1 makes its body through the watcher's redactor (`--push-body`), the timeline stores the checked line as it is (P-4).
  - The timeline push loops: pushes start detached and overlap, so the push-lock holder looks again after it lets the lock go (P-11). G1 runs once per answer and does not.
  - The 400 reply names the line id on stderr (PLAN.md); G1's names nothing.
- **Shared already:** `oss_ask`, `oss_api_creds`, `oss_private_dir`, `oss_private_run_dir`, `oss_take_stale`, `oss_lock_id`, `oss_release_lock`, `oss_json_field`, `oss_decisions_push_off`, `oss_single_link`.
- **Cost:** a change to the reply table must be made in both places. Moving G1 onto shared functions would touch 200+ G1 checks for no behaviour change.

## P-11: Where the push starts, and how
- **Starts:** oss-notify after its `command` line (`oss-timeline.sh push --detach`); the `gate` and `merge` verbs and the Agent|Task PostToolUse hook after their line. The `command` verb starts none itself, so oss-notify starts exactly one.
- **How:** `_oss_tl_push_bg` runs `oss-timeline.sh push` in a process group of its own (`perl setpgrp`, else a plain `&`), stdin, stdout and stderr closed. A hook whose group is killed, or a caller that waits on its group (Claude Code, `run_capped`), neither cuts a POST short nor waits for one. The push bounds itself: 8 POSTs of 15 s (Task 10: the 1.5-6.5 s China route), none started after 40 s.
- **Overlap:** a push that finds the push lock busy leaves its lines pending; the holder, after releasing the lock, reads the outbox again and runs once more while lines wait and the bounds allow. Without that, the last line of a burst (a ship's gate and merge) could wait until the next command.
- **Decided by:** the Task 8 build, 2026-11-06.

## Last Updated: 2026-11-06 by /oss:build

## P-12: No repo name on timeline lines (2026-11-06, user)
- **Context:** ship round 1 gates noted that lines carry no `repo`, so the same feature name in two repos shows as one timeline in the team view. The fix round briefly planned to send `owner/name` from origin; a heads-up flagged that as new customer data the approved plan had left out.
- **Decision:** the user chose to leave it out. No repo name leaves the machine (as in G1). The collision is a G3 follow-up.

## P-13: Delivery rules (Task 10, 2026-11-06)
- **Every outbox:** a push walks `~/.oss/timeline-outbox/*.ndjson`, each under its own push lock, so a branch switch or the ship archive never strands a line. The feature need not resolve; the switch and the policy GET (once per run, asked only when a line waits) are unchanged.
- **Retry:** any reply that is not final (5xx, 401, 403, 404, 413, 422, 429, an unknown 409, a 2xx naming no account, a timeout, no answer) is a retry; the third marks the line failed. A run sends each line at most once and goes on to the lines behind it, so a 5xx no longer stops the run either.
- **Compaction:** once per outbox per run, before it sends, under the writer's lock (tried once, never waited on), the outbox is rewritten in place to the entries of ids not in a final state. What a run marks stays readable until the next run.
- **A failed write** of a mark or a withhold stops the run.

## P-14: What a merge line trusts (Task 11, 2026-11-06)
- **decision:<uuid>:** accepted only when that id is the `id` of a line in this feature's G1 record (`.oss/dev/active/<feature>/decisions.ndjson`, read only as a single-link regular file). Otherwise the merge verb refuses the approval: exit 1, one stderr line, and nothing for the API (the same as an approval.txt outside its rule). It does not fall back to `none`. Since Task 12 a refusal still writes a local merge-unknown line (P-15). merge-flag and chat-instruction stay self-reported (DESIGN.md).
- **Value-file age:** the gate and merge verbs refuse, and still delete, a value file last written more than 10 minutes ago (`_ov_take`'s optional max age, the opened file's mtime, GNU `stat -c` first as stat-order requires).
- **gh:** runs with every GIT_* variable unset.
- **Facts outside the merge schema** (a bot login, a null mergeCommit, a mergedAt before 2020) give a local merge-unknown line, with the pr when it is valid.

## P-15: Bounds on what the timeline writes and reads (Task 12, 2026-11-06)
- **Bare key:** the API's holdsBareSecret rule (AgenticDevWorkflow 574a772, routes/timeline.ts) is copied into `_OSS_TL_RULES` as `keyless`: in session, feature, agent, gate, command and mergedBy, a run of 32+ letters and digits with a digit refuses the line before the committed file is written. In mergedBy it fails the merge schema, so a real merge still gives a local merge-unknown line.
- **Reads:** the hook's stdin only up to 1 MB (still within the 2 s read); workflow-state.json only as a single-link regular file of at most 64 KB; decisions.ndjson only its first 1 MB for the decision-id check.
- **Writes:** never to a timeline.ndjson the person does not own (`test -O`, checked under the lock in oss-timeline.sh; the shared `oss_safe_target` is unchanged); nothing at all when the project resolves to $HOME; a feature folder name over 128 characters files the line as unfiled; timeline-unfiled.ndjson stops growing at 1 MB.
- **Refused approval:** a decision id not in the record, or an approval.txt that is stale, unsafe or outside its rule, still writes a local merge-unknown line (exit 1, never queued), so a real merge always leaves a trace.
- **Outbox ids:** matched with `\A..\z` (jq's `$` let a trailing newline through).
