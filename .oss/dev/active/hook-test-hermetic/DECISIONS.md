# Decisions: hook-test-hermetic

## D1: Ship before log-rounds, on its own branch (user, 2026-10-28)
The log-rounds gate found the flaky suite. The user ruled that flaky tests do not ship to paying customers. This fix ships first. log-rounds is then rebased on it and shipped.

## D2: What RED means for a test-only task (T7–T14)
These tasks change no production code, so "the test fails on current code" alone would be vacuous or impossible. RED is therefore:
1. a new assertion that fails against the defect it guards (for example, it observes a network call, a real-HOME write, or the live session id); and
2. an anti-vacuity mutant of the production guard the file protects, shown RED.

GREEN means it passes on the real code, with the flaky dependency removed.
**Why:** this matches the repo's measured lesson (2026-09-06): only a guard that kills its own mutant counts as guarded.

## D3: The opt-in session-start health check is detached; its summary goes to its log (T4)
Its echoed summary only reached the user because Claude Code waited for EOF, which means startup blocked for the whole test run. That contradicts the feature's own comment, "Run in background to not block session start". The summary is appended to `health-check.log`, which the hook already writes.

## D4: The root fix lives in setup.ts, not in 16 separate files (T5, T6)
Redirecting `HOME` once covers every `os.homedir()` user. Files that break under it are fixed one by one (T6). This is not a rewrite of all 16.

## D5: Repo-scaffolding steps of /oss:plan Step 0 not applied
That step would overwrite `.gitignore`, add ci.yml and an ecosystem config, and change branch protection on main. All of it is out of scope for this fix, and changing main is forbidden (IRON LAW #4).

## D6: The sandbox HOME gets an empty `.oss`, created in setup.ts (T6.a, 2026-10-29)
8 test files write into `$HOME/.oss` and relied on the old setup.ts creating the real one. Every real install has `~/.oss`, so a temp HOME that has one is the faithful world. Creating it once in setup.ts, guarded by its own assertion, is one change. The alternative is the same mkdir copied into 8 files. It never touches the real HOME.

## D7: A local http API needs an explicit opt-in, and the refusal is never silent (T20, user decision 2026-10-30)
Pen-test M2: an `http://localhost` apiUrl sent the API key in clear text to a port any local process can take,
and the reply was written into CLAUDE.md and team-iron-laws.json. Chosen: refuse loopback http unless
`OSS_ALLOW_HTTP_LOOPBACK=1`, and print one line naming the switch at session start and in /oss:login.
Rejected: refuse silently (a dev setup goes quiet with no reason); keep allowing it (open security finding);
allow but drop the CLAUDE.md write (the key still travels in clear text).

## Last Updated: 2026-10-30 by /oss:build (ship round 1, D7)

## D8: the decrypt tool's plain-http loopback goes to a follow-up PR (2026-10-30)
- **Context:** D7's opt-in (`OSS_ALLOW_HTTP_LOOPBACK=1`) covers the hooks only. `packages/cli-decrypt/src/config.ts`
  still accepts a plain-http localhost apiUrl with no opt-in, so oss-decrypt can send the key unencrypted to a local API.
- **Decision (user):** a separate follow-up PR. It changes cli-decrypt to require the same opt-in with the same message, cuts a
  release, and bumps the pinned `OSS_DECRYPT_TAG` and checksums. This PR lists it as a security follow-up and in the PR body.
- **Why:** oss-decrypt is a separately released binary pinned at cli-decrypt-v1.2.4; a source change here reaches no user
  without that release, and this PR is at its 3-round gate cap.

## D9: oss_json_field drops its "exactly one object" type check (T46, 2026-10-30)
- **Context:** the T38 check `(.[0] | type) == "object"` survived every mutant. Over a corpus (`[]`, `[1]`,
  `[{"p":"x"}]`, `"s"`, `1`, `true`, `false`, `null`, `{}`, objects, two documents, garbage, empty input) stdout is
  identical with and without it. A top-level `null` indexes to null and prints "" either way; an array, string, number
  or boolean cannot be indexed by name, so jq errors and prints nothing. The only difference is the exit status (0 with
  the check, 5 without), and the exit status is not part of the contract: garbage input already exits non-zero, and the
  one caller (`hooks/oss-login.sh`, the `Plan:` line) discards it and sends stderr to /dev/null.
- **Decision:** remove the check in a REFACTOR (all tests green before and after); `length == 1` stays, guarded by the
  two-documents cases in oss-json-field.test.sh. The header comment says that only stdout is the contract.
- **Rejected:** a test pinning exit 0 for a non-object value. It would guard an exit status no caller reads, and would
  not match the non-zero exit the function already gives for invalid JSON.
- **Note:** unlike oss_config_strings (T30, where a top-level `null` was a real "no apiUrl, use the default" bypass),
  here `null` and a non-object both give "", which is the safe output.

## Last Updated: 2026-10-30 by /oss:build (T46, D9)
