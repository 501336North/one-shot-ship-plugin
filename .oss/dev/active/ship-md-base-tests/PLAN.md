# Plan: ship-md-base-tests (Sprint D fix PR)

Owner pick 2026-11-26: "Separate fix PR". Three tests fail on Sprint D at a88f7d91. All three come from `commands/ship.md` as #241 (98fe401d) changed it. The fix lands by PR into feat/determinism-sprint/build, and gate-discipline ships after it.

The RED tests already exist: they are the three failing rows. Each task makes one of them pass without weakening any test.

### T1: Step 8 wording (watcher/test/commands/chain-step-contract.test.ts)
- RED: the row "ship.md Step 8 sends merged and complete only once the --merge merge landed" fails. Step 8 says "Send `merged` then `complete` only if…", but the pin expects lowercase "send".
- GREEN: join the two sentences with a colon so the line reads "…remain: send `merged` then `complete` only if the merge landed in this session." The meaning does not change.

### T2: `sleep 1` (commands/__tests__/bash-blocks-allowlisted.test.sh)
- RED: the `sleep 1` line in Step 5a is not on the allowlist and has no exemption.
- GREEN: owner pick 2026-11-27, "Accept the prompt". Add `commands/ship.md	sleep 1` under a new group `pr241-override-wait`, and give that group a reason in the test.
  - Customers see one approval prompt (at most 5) on the rare "Override <gate>" path.
  - The permission installer does not change.

### T3: model-text detector (commands/__tests__/no-model-text-in-failed.test.sh)
- RED: `ship.md:249` is a prose line that names `oss-value.sh` and also holds `Override <gate>`, so the detector reads it as a shell line with a placeholder.
- GREEN: reword the aside "(step 1's `oss-value.sh dir` clears `overrides.json`)" to "(step 1 clears `overrides.json`)". The line keeps its meaning and no longer names the hook.

### Checks
- The three tests above.
- ship-wrapper-chain.test.ts, which pins the Step 5a wording.
- The served command-blocks fixture check in served-commands.acceptance.
- All targeted, with a temp HOME. Shell tests run singly, each with a notifier tripwire.
- No watcher/src change, so no rebundle.
