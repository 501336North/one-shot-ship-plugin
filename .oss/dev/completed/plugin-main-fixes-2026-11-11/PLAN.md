# Plan: plugin-main-fixes

Two shell tests that fail on main, and the dormant metrics push (a Radical Observability G5 loose end). The release is plugin **2.1.3** (D1).
Planned 2026-11-08. Not built yet.

## Owner decision at build start (AskUserQuestion)
**Metrics push.** `hooks/oss-push-metrics.sh` is never called: no entry in hooks.json, no command calls it, only tests use it. Its header says the intended pipe is `oss-log-analyzer.sh <cmd> | oss-push-metrics.sh`.
- Option A (recommended if the API still has the metrics endpoint and the dashboard reads it): wire it into the `complete` path of `oss-notify.sh --workflow`, in the background and silent on failure.
- Option B: delete the hook and its tests, because the G1-G4 timeline already gives the dashboard its data.
- Check first, in AgenticDevWorkflow, whether the endpoint the hook posts to still exists.

## Tasks

### Task 1: ideate-template test
- **Problem:** `commands/__tests__/ideate-template.test.sh` test 2 greps `commands/ideate.md` for template-fetch text. ideate.md no longer has that text, because the template moved to a hook covered by `hooks/__tests__/oss-claude-md-template.test.sh`.
- **Plan:**
  - Find the commit that removed the wording (`git log -S 'template' -- commands/ideate.md`).
  - If the template fetch now lives in the hook, point test 2 (and 4, for skills) at the real behavior: ideate never holds a hardcoded CLAUDE.md template. ⚠ changes existing test. Quote the spec: "commands/ideate.md should contain API template fetch instruction".
  - If the behavior was lost by accident, restore the wording instead: RED is the current failure, GREEN is the fix.
- **Acceptance:** the test passes on its own, and oss-claude-md-template still passes.

### Task 2: no-telegram-command test
- **Problem:** the check "/oss:settings never mentions Telegram" fails. settings.md:287, 308 and 310 legitimately name the retired keys in a cleanup (`jq 'del(.telegram, .notifications.telegram)'`).
- **Plan:** narrow the check so it fails on any Telegram offer (a menu option, setup text, an `/api/v1/telegram` call) but allows the `del(...)` cleanup of retired keys. ⚠ changes existing test. Quote @business-rule "Telegram removal phase 2, Task 8: the plugin offers only the notification styles...". The rule is about offering, and the cleanup offers nothing.
- RED: first add a fixture case where settings.md offers Telegram, and show it still fails. Then GREEN.
- **Acceptance:** the test passes on main's settings.md and fails on an offering line.

### Task 3: Metrics push (pending the decision)
- **A, wire:**
  - RED: a hook test showing that `oss-notify.sh --workflow X complete` calls the analyzer and the push, with the API stubbed and no network.
  - GREEN: one backgrounded line.
  - Security review: the key goes only to apiUrl, as the header says.
- **B, delete:** remove `hooks/oss-push-metrics.sh` and its tests, and change other hooks' tests that reference it. ⚠ changes existing test.

### Task 4: Version
- `.claude-plugin/plugin.json` 2.1.2 → 2.1.3 (D1).

## Test rule
Run only the touched shell tests. Never run the watcher's full suite (it pkills OSS processes machine-wide).

## Sequence
Tasks 1 and 2 (independent), then Task 3, then Task 4, then one PR.
- The served merge step cannot test this repo (no root package.json) until oss-test-command ships. Until then the owner merges by hand.
- Or ship this after oss-test-command and use it as that feature's Task 4 acceptance.
