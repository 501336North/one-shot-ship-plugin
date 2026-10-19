# Decisions: plugin-value-flags (plugin Phase A)

## D1 (2026-10-20): code-simplifier's wrapper `failed` step was removed
/oss:code-simplifier serves agents/code-simplifier, whose served prompt sends
`--workflow code-simplifier failed` itself, so the wrapper's own step logged the failure twice.
P5 removed it with the other 25 duplicates (26 deletions + the oss-custom rewrite).

## D2 (2026-10-20, ship round 1 R1-1): wrapper lifecycle notify lines send a fixed '{}'
The wrapper owns the start/complete lifecycle events (served-paths-fix ADR-5), so the lines stay,
but no shell line in commands/*.md may carry a `{PLACEHOLDER}` for the model to fill: the payload
is always the literal `'{}'` (also for task_complete, milestone, pr_created, merged, issues_found).
`oss-log.sh` lines lose any free-text argument (`oss-log.sh test red FAIL`, details optional).
Guarded by commands/__tests__/no-model-text-in-failed.test.sh section 4 (every line in a bash fence
plus every inline hook line). Cost: the status line / Telegram lose counts like totalTasks.

## D3 (2026-10-20, ship round 1 R1-3): the value-folder key is toplevel + git dir
`printf '%s\n%s\n' <toplevel> <absolute-git-dir> | git hash-object --stdin | cut -c1-16`. This
diverges from the served formula (git dir alone). No served prompt calls oss-value.sh yet, so
both stay self-consistent; Phase B must move the served copies onto the helper in step.

## D4 (2026-10-20, R1-7 / R1-8): reported, not built
- R1-7: the `error` path is already redacted (oss-error.js redactWire: message, retry_hint, source).
  There is no shell-callable redactor for the `failed` reason (redactString lives only in the
  watcher TS), and building one is out of scope.
- R1-8: oss-log.sh refuses unsafe writes with rc 0 by contract, and oss-notify.sh always exits 0
  (`|| true` around the log write). Making `failed` detect a refused write needs a contract change
  in both scripts for all callers, not a few lines.

## D5 (2026-10-20, ship round 2 R2-2): the guard's scope rule
A placeholder is `{word}` or `<word>` in any case (word = letters, digits, `_`, `-`) after `${...}`,
`$name` and curl's `%{name}` are stripped. It counts on every shell line: every line of a fenced block
(``` or ~~~, case-insensitive language, info strings allowed, a bare fence = shell) unless the
language is json/yaml/yml/markdown/md/typescript/ts/javascript/js/text/txt/diff; outside fences, every
inline backtick span that runs an oss hook/bin, `~/.oss`, `$HOME/.oss`, `git `, `gh `, `node ` or
`kubectl `, and any line that runs oss-log/oss-notify/oss-value. In a heredoc body only `{word}`
counts (`<dict>` there is plist markup). Display blocks (slash-command usage, sample output, WebFetch
request shapes) are fenced ```text; a ```text fence is never run as shell. agents/ and skills/ are not
in scope: their only hits are WebFetch `Authorization: Bearer {apiKey}` request shapes.

## D6 (2026-10-20, ship round 2 R2-3): notification copy falls back to static text
When interpolation leaves any field missing, NotificationCopyService uses the service's own static
text for that string (title `OSS`, workflow message `Workflow event`, issue message `Issue detected`,
session message `Session event`: the same texts it already returns for an unknown template). With
the fixed '{}' payloads (D2) a notice reads e.g. "OSS / Workflow event" instead of "{current}/{total}
/ {taskName}". Partial context (one field of two) also falls back.
