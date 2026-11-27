# Decisions: complete-gaps

Last Updated: 2026-11-27 17:00 +07 by /oss:adr

- D1 (owner pick, 2026-11-27, "Narrow to (a)+(b)"): cards 1 and 2 are narrowed. The refusals behind them came from a mixed install (R-257 hooks in the real ~/.oss/hooks from the 11-24 clean-copy run, used with the 2.2.x wrapper and main-served prompts, which never assemble). Ship after the archive already works under Sprint D (D78, D84-D88). The scope is (a) and (b) below, proven first by an acceptance test of the real Sprint D flow.
- D2 (from D1): (a) `build` gets the D84 archived-folder lookup, with every D84/D85/D86 rule unchanged. The merge proof, `--record-ready` and D86 5c stay ship-only. `ideate` and `plan` do not get it, because no served flow runs them after the archive.
- D3 (owner pick, 2026-11-27, "Pass + mark unverified"): (b) `complete` passes a legacy run. Legacy means no `run/<phase>` row, no repo `results/` entry for the feature, and no ledger `results/<feature>` entry. It prints one fixed notice, writes the ledger `unverified/<feature>/<phase>` marker (ADR-1's) and runs the chain. Any results entry, or a run row, keeps today's refusal.
- D4 (OSS DETERMINISTIC ask, 2026-11-27): a guard so that no test or clean-copy run writes into the real $HOME/.oss is not part of this feature. It widens FOLLOWUPS card 3. The three leftover files in ~/.oss/hooks wait for the owner's answer.

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
