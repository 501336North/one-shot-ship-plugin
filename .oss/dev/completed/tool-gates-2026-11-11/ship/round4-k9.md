# Fix round 4, part K9: two missed HIGH findings (the user decided this on 2026-11-10)

The round-4 code reviewer rated both of these HIGH security. They were left out of K8 because the orchestrator listed them at the auditor's MEDIUM. The user chose a short K9 that switches both to allowlists. Follow `ship/fix-rules.md`.
- **Strict TDD.** Write each acceptance test first, in `watcher/test/cli/tool-gate.acceptance.test.ts` under the describe "tool-gate acceptance: fix round 4, K9". Run it through the real gate and watch it FAIL. Record the reason, then write the code.
- Put a "still allowed" case next to each refusal, and add unit tests in `watcher/test/tool-gate/rules/push-setup.test.ts`.

Code: `watcher/src/tool-gate/rules/push-setup.ts`: `harmlessSsh` (about :559), `helperRuns` / `helperProgramRuns` / `standardProgram` (about :487-555). Verify the lines yourself.

## 1. ssh values: an allowlist of options (`harmlessSsh`)
This applies to `GIT_SSH_COMMAND`, `GIT_SSH`, and `core.sshCommand` set by `-c`, `--config-env` or `GIT_CONFIG_*`. Since K7, push carries a value that passes this check.
- **Today:** the program word must be `ssh` or a standard-bin absolute ssh, and the options are checked against a deny list.
- **Gap:** options that load a program, library or config file get through. These are `-I <lib>`, `-o PKCS11Provider=…`, `-o SecurityKeyProvider=…`, `-o Include=…`, `-o XAuthLocation=…`, and a key name with a backslash or odd case such as `Proxy\Command`.
- **New rule:** harmless only when every option is on an allowlist.
  - **Plain flags:** `-4 -6 -A -a -C -k -N -n -q -T -t -v` (repeatable, also grouped as in `-vvv` or `-4q`).
  - **Flags with a value:** `-p <port>`, `-l <user>`, `-i <keyfile>`, `-c <cipher>`, `-m <mac>`, `-b <bind>`, `-E <logfile>`. Treat `-E` as a write target or refuse it, whichever is simpler. Values may be attached or separate.
  - **`-o Key=Value` or `-o "Key Value"`:** the key is matched case-insensitively against an allowlist with no backslashes. Allowed keys:
    - `StrictHostKeyChecking`, `UserKnownHostsFile`, `BatchMode`, `ConnectTimeout`, `IdentitiesOnly`, `IdentityFile`, `Port`, `User`, `ServerAliveInterval`, `ServerAliveCountMax`;
    - `LogLevel`, `Compression`, `HostKeyAlias`, `PreferredAuthentications`, `PubkeyAuthentication`, `PasswordAuthentication`, `AddKeysToAgent`;
    - `ControlMaster`, `ControlPath`, `ControlPersist`.
  - **Anything else is refused.** That includes `-F`, `-I`, `-J`/ProxyJump, `-W`, `-L`/`-R`/`-D` forwarding, `-S`, `-e`, any other `-o` key, any word with a shell metacharacter or a backslash, and anything after the options.
  - **Still allowed:** `ssh -i ~/.ssh/deploy -o IdentitiesOnly=yes`, `ssh -o StrictHostKeyChecking=no`, and `/usr/bin/ssh -p 2222`.

## 2. `!` credential helpers: an allowlist approach to the program word (`helperProgramRuns`)
- **Today:** the gate refuses relative programs, variables, functions, substitutions, shells and interpreters, and absolute programs outside the standard bin folders.
- **Gap:** runners that run their own arguments as a command get through: `nohup`, `{ … }` groups, `awk`, `xargs`, `command`, `builtin`, `exec`, `env`, `osascript`, and any wrapper the gate unwraps (`script`, `unbuffer`, `expect`, `flock`, `faketime`, `caffeinate`, `ionice`, `chrt`, `timeout`, `nice`, `sudo`, `doas` and the like).
- **New rule:** the helper is harmless only when all of these hold:
  - the program word is a plain PATH name (or a standard-bin absolute path);
  - it is not a shell, an interpreter, a runner or wrapper that executes its arguments, awk/sed/perl, or `osascript`;
  - the value has no shell metacharacters beyond simple words.
- Reuse the reader's existing wrapper and interpreter tables rather than a new list wherever you can, so a wrapper added later is covered automatically.
- **Still allowed:** `!gh auth git-credential`, `!/usr/local/bin/gh auth git-credential`, `!git-credential-manager`, `!op plugin run -- gh`. If one of these can't stay allowed under the new rule, STOP on it and report it as "needs the user's decision".

## Hard rules
- **No silent security deferrals.** If closing an item would refuse ordinary commands, STOP on that item and report it as "needs the user's decision". Report new gaps; don't fix them.
- **Cleanup:** remove ONLY the exact `mktemp -d` paths you stored, after checking that each is non-empty and matches. Never a parent, `dirname`, `$TMPDIR`, `/tmp`, `/private/tmp` or a glob.
- Run the dev-docs symlink guard before writing under `.oss/dev`. Add a NOTES.md entry "Fix round 4 (K9, <date from date cmd>)". Never touch CLAUDE.md or any ndjson file. Never switch branches, stage, commit or push. Never use `git -C` or `git stash`.
- Ordinary calls must stay around 100 ms.
- When done:
  1. Run the scoped tests (`cd watcher && npx vitest run test/tool-gate test/cli test/hooks`) and tsc (`./node_modules/.bin/tsc --noEmit -p .`).
  2. Rebuild the bundle with `npm run build:cli-bundle`, then restore `watcher/dist/cli/oss-launch.cjs` with `git checkout --`.
  3. Run the full suite (`npx vitest run`). Only model-frontmatter, offload-step-safety and chain-step-contract may fail.
  4. Run `pgrep -fl tool-gate.cjs; pgrep -fl vitest` and leave nothing of yours running. vitest under AgenticDevWorkflow-ship-followups belongs to another session; leave it alone.

## Report
- Each item: closed or "needs the user's decision", its RED reason, tests and files.
- New gaps.
- Existing tests changed, with the reason.
- Suite counts and the tsc result.
- The pgrep output.
