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
**Correction (ship round 3, R3-8):** that last sentence was wrong. agents/visionos-developer.md:36 and
skills/visionos-developer.md:44 also have a model-filled `{user_context}` in a WebFetch URL query
string. It is not a shell line (no command runs it) and agents/skills stay out of wrapper scope, so it
is a FOLLOWUPS security line, not a guard change. Request shapes are now fenced ```http (R3-7, D8).

## D6 (2026-10-20, ship round 2 R2-3): notification copy falls back to static text
When interpolation leaves any field missing, NotificationCopyService uses the service's own static
text for that string (title `OSS`, workflow message `Workflow event`, issue message `Issue detected`,
session message `Session event`: the same texts it already returns for an unknown template). With
the fixed '{}' payloads (D2) a notice reads e.g. "OSS / Workflow event" instead of "{current}/{total}
/ {taskName}". Partial context (one field of two) also falls back.

## D7 (2026-10-20, ship round 3 R3-4/R3-5): two more oss-value.sh verbs, same value folder
- `read <name>` prints <name>.txt for a fixed set of names, each with its own rule in code: key
  `^[A-Za-z0-9_-]{8,200}$` (login had no key-shape check of its own), style `visual|audio|sound|none`,
  prompt and model `^[a-z0-9_./:-]{1,100}$` (the round-3 brief said `^[a-z0-9_.:-]`; `/` is added
  because model ids such as `ollama/codellama` and prompt names such as `/oss:ship` need it; the
  value is only ever a quoted argument), workflow `^[a-z0-9_.:-]{1,100}$`, trust category/name
  `^[a-z0-9_-]{1,100}$` (the stricter rule trust.md already stated). It reads through `_ov_open` (same
  not-link, regular-file, link-count-1, same-inode checks), deletes the file as soon as it is read
  (valid or not: a key never lingers) and prints only a value that matches; nothing is cleaned or
  cut, a non-matching value is refused.
- `agent <workflow> start|complete` holds agent.txt to `^[a-z][a-z0-9:-]{0,60}$`, deletes it, and
  calls the sibling oss-log.sh `agent <workflow> <name> "starting: delegated task"|"completed:
  delegated task"`, routed by `_ov_walk` like failed/error. oss-log's setActiveAgent writes
  `activeAgent.type`, which oss-statusline.sh shows (lines 285, 420): the specialist's name is back.
- `dir` clears these 8 files with the 7 earlier ones (one list of value-file names).
- Login's first-run VOICE/SOUND are not model-filled (step 2 writes Samantha/Glass); step 3 reads all
  three back from ~/.oss/settings.json with jq, so only STYLE needed `read`.
- The verbs need a git repo (the folder is per repo, ADR-001): login --key, models set, workflows
  <name> and trust now refuse outside one and say so. Reported, not worked around (stop rule).
  **Superseded by D9 (ship round 4, R4-1):** outside a repo the folder is ~/.oss/run/home.

## D8 (2026-10-20, ship round 3 R3-6/R3-7): the guard's widened rule
Adds to D5: a placeholder may contain spaces, `.`, `:` and `|` (not at its ends), or be an upper-case
`[WORD]`/`[TWO WORDS]`; `${...}` is stripped innermost-first only when balanced (so `${X:-{reason}}`
keeps `{reason}`); `%{...}` is stripped only on a curl `-w`/`--write-out` line; a heredoc fed to
bash/sh/zsh/ksh is shell (`<word>` counts); ```http fences are scanned with `{apiKey}` allowed by name.
In a shell fence, a `$NAME`/`${NAME}`/`$1` the same fence never assigns (NAME=, read, for, local,
export, declare) counts too, outside single quotes and quoted heredocs; HOME, PWD and BASH_SOURCE
(shell-set) are allowed. Two exemptions, each by name: a line that starts with `/oss` (a slash-command
usage line, typed to Claude, never run) and the fixed log tag `[CHAIN]`.
Known-open: the unassigned-variable rule also hits 21 file:NAME pairs in wrappers outside the R3-5
list (settings.md STYLE/VOICE/SOUND/VERBOSITY/TELEGRAM_LINKED/API_KEY/API_URL, telegram.md and
oss-custom.md `$1` plus API_URL/API_KEY, watcher.md PID, models.md PLUGIN_ROOT (never set), login.md
and webhook.md CLAUDE_PLUGIN_ROOT, login.md PLIST_PATH/STATUSLINE_SCRIPT, oss-audio.md sourced vars,
visual-test.md OSS_CONFIG_DIR). They are listed in KNOWN_OPEN in the guard, checked both ways (a new
hit fails; a listed pair that no longer occurs fails as STALE), and in FOLLOWUPS. Fixing them is
beyond the round-3 tasks (stop rule).
**Superseded by D10 (ship round 4, R4-2):** all 21 pairs are fixed and the KNOWN_OPEN mechanism is
removed from the guard; an unassigned variable in a shell fence now always fails it.

## D9 (2026-10-20, ship round 4 R4-1): outside a git repo, one per-user value folder
When `git rev-parse --show-toplevel` fails (the cwd is in no repository), `_ov_repo` leaves the
toplevel empty and `_ov_key` returns the fixed key `home`, so the folder is `~/.oss/run/home`. It gets
exactly the checks a repo folder gets (`~/.oss/run` and the folder: not a link, owned, mode 700;
value files through `_ov_open`), is cleared by `dir` and pruned with the others. `home` is never 16
hex, so it cannot meet a repo's folder. `_ov_walk` already maps an empty toplevel to `$HOME`, so
`failed`/`error`/`agent` events from outside a repo land in `~/.oss`. A repo whose git-dir lookup
fails is still refused (only a failed toplevel lookup means "no repo"). login --key, models set,
workflows <name> and trust work from any folder again; the wrappers no longer say "inside a git
repository".

## D10 (2026-10-20, ship round 4 R4-2): compute in the fence, read the rest, type nothing
Every `$NAME` a wrapper shell block uses is assigned in that block (the guard's rule, now without
exceptions). Where it comes from, in order of preference:
1. Not needed in the shell at all: telegram's subcommand only picks which block to run (prose).
2. Computed in the block: the API key and URL from `~/.oss/config.json` with jq (settings, telegram);
   the Telegram link from the API, true only when it says exactly `true`; the plugin root with the new
   verb `oss-value.sh root` (models set, webhook, login), which applies the checks `error` already
   applied to `~/.oss/plugin-root` (not a link, owned, absolute, one line, a folder; one helper
   `_ov_root` for both); fixed paths for PLIST_PATH, STATUSLINE_SCRIPT and visual-test's config.json
   (`OSS_CONFIG_DIR` was never set in the Bash tool); oss-audio's three settings read by name with
   sed instead of sourcing (running) the file.
3. Read from the block's own file with a check: watcher.md's PID from `.oss/watcher.pid`, used only
   when it matches `^[0-9]{1,10}$` (`1 1` would otherwise make `ps -p` report running).
4. A user/model value: a value file read by `oss-value.sh read <name>` with a per-name rule in code,
   each the wrapper's own list: `notify_style` visual|audio|sound|telegram|none (login's `style` has
   no telegram, so it is a separate name), `voice` Samantha|Daniel|Karen|Moira, `sound`
   Glass|Ping|Purr|Pop, `verbosity` all|important|errors-only, `custom` `^[a-z0-9-]{1,100}$`
   (oss-custom Step 0 = isSafeTeamCommandName). `dir` clears these 5 files too (20 in all).
settings.md Steps 3.5-5 became one block: it reads style and verbosity (and voice/sound only for
audio/sound, otherwise keeps the current value from settings.json), checks the link, falls back to
visual for an unlinked Telegram, syncs, writes settings.json with `jq -n --arg` (no heredoc
interpolation) and prints the new configuration. The lead's brief named `telegram_linked` and a
telegram argument as read names; the link is computed instead (the API is the source, not the model)
and the argument never reaches a shell, so neither name exists.
