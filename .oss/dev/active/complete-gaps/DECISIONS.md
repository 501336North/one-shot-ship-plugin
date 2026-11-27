# Decisions: complete-gaps

Last Updated: 2026-11-27 17:00 +07 by /oss:adr

- D1 (owner pick, 2026-11-27, "Narrow to (a)+(b)"): cards 1 and 2 are narrowed. The refusals behind them came from a mixed install (R-257 hooks in the real ~/.oss/hooks from the 11-24 clean-copy run, used with the 2.2.x wrapper and main-served prompts, which never assemble). Ship after the archive already works under Sprint D (D78, D84-D88). The scope is (a) and (b) below, proven first by an acceptance test of the real Sprint D flow.
- D2 (from D1): (a) `build` gets the D84 archived-folder lookup, with every D84/D85/D86 rule unchanged. The merge proof, `--record-ready` and D86 5c stay ship-only. `ideate` and `plan` do not get it, because no served flow runs them after the archive.
- D3 (owner pick, 2026-11-27, "Pass + mark unverified"): (b) `complete` passes a legacy run. Legacy means no `run/<phase>` row, no repo `results/` entry for the feature, and no ledger `results/<feature>` entry. It prints one fixed notice, writes the ledger `unverified/<feature>/<phase>` marker (ADR-1's) and runs the chain. Any results entry, or a run row, keeps today's refusal.
- D4 (OSS DETERMINISTIC ask, 2026-11-27): a guard so that no test or clean-copy run writes into the real $HOME/.oss is not part of this feature. It widens FOLLOWUPS card 3. The three leftover files in ~/.oss/hooks wait for the owner's answer.
- D6 (owner pick, 2026-11-27, "Only pre-upgrade starts"; narrows D3 and ADR-1 after a heads-up): D3 as picked also passed a new feature whose model skipped `start`. Legacy now also needs proof that the run started before the R-257 hooks were installed. On its first run, the new oss-notify writes a one-time marker, ledger `phase-results-since` (owner-only, never moved). At the first non-start event of a run with no run row, if the workflow state's current command is this phase, its `currentCommandStartedAt` is before the marker, and the feature has no results anywhere, oss-notify appends a ledger `legacy/<phase>` row (`{startedAt, feature}`). It records this then because `merged` resets the workflow state before `complete`. `complete` passes as legacy only on a `legacy/<phase>` row with no later `run/<phase>` row and no results. A skipped start, or any run under the new hooks, refuses as today. The phase is still marked unverified, and the chain still runs.
- D7 (owner pick, 2026-11-27, "Add a routing task"; widens D2 after a build finding): after the archive, `oss-value.sh timeline gate` wrote a ship re-run's new gate lines to `.oss/dev/timeline-unfiled.ndjson`, so `assemble ship` refused gate_missing even after a fixed build. Task 2b sends those lines to the folder the D84 lookup picks: only this branch's single archived folder for this feature, with the same rules and the same fail-closed behaviour (anything else stays unfiled). Acceptance case a3 is fixed to record gates the way a real ship does (as `prf_ship` does).
- D8 (owner pick, 2026-11-27, "Same feature only"; replaces the build's first rule after a simplifier heads-up): `complete` refuses the legacy pass when a `run/<phase>` row for the *same feature* exists in the repo key. That row means this feature already ran the phase under the new hooks. Run rows of other features don't count. The build first refused on *any* run row for the phase. In a normal single checkout all features share one ledger key, so one new feature's ship would have blocked every older feature's legacy pass. A row that can't be read or checked still refuses (fail closed). A linked `unverified/` folder refuses too (nothing is written through the link). `complete` is itself a non-start event, so a pre-marker run can get its legacy row at `complete` itself (consistent with D6).
- D5 (owner picks, 2026-11-27, "Add card 3" and "Delete the 3 files"): D4 is superseded. Card 3, the guard that refuses any test or clean-copy write into the real $HOME/.oss (hooks, config, ledger), is now in scope for complete-gaps. The three leftover files (oss-phase-result.sh, oss-node.sh, oss-statusline-settings.sh) were deleted from the real ~/.oss/hooks after checking that none is in plugin 2.2.4.

## ADR-1: Legacy pass at complete, marked unverified

**Status:** Accepted (D3)

**Context:** A phase started under a pre-R-257 plugin has no run row. After the upgrade, assemble refuses `no_run_started`, and `complete` has no legitimate way to pass. D17 already lets such a feature *start* with a notice.

**Decision:** At `complete`, the same legacy test as D17 plus "no run row" passes with a fixed notice and the ledger unverified marker. The decision is made in the shell gate from ledger and repo state only, never from a model-written value.

**Consequences:**
- Positive: no dead end across the upgrade; the team view shows the phase as unverified, not as verified.
- Negative: a model that never sends `start` on a feature with no results anywhere gets a pass, marked unverified. This is the same allowance D17 gives at start. It is accepted, not deferred.
- Neutral: once the feature has any result, the rule no longer applies.

**Alternatives considered:**
- Pass with a notice only: rejected, because the team view would not show the phase as unverified.
- Refuse and say re-run: rejected, because a re-ship costs a full gate round, and it was circular for Sprint D's own features.

**Related:** R-257 D14 (ledger), D16/D17 (start gate), ADR-1 (Stop dispatcher unverified marker).
