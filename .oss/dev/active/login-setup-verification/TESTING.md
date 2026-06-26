# TESTING: Fix /oss:login false-positive "Setup Complete"

## Strategy
London TDD. One real testable unit (the verifier script) + two thin contract guards.

### Unit — `verify-decrypt-setup.sh` (bash harness)
`hooks/__tests__/verify-decrypt-setup.test.sh`, mirroring `ensure-decrypt-cli.test.sh`
(temp `$HOME`, PATH/file mocks). Mocks the external collaborator (the decrypt binary) —
never mocks the verifier's own logic.

| Scenario | Mock | Expect |
|----------|------|--------|
| Binary crashes (v1.2.2 repro) | `oss-decrypt` exits 1 on `--version`, stderr `Cannot find module '/snapshot/dist/oss-decrypt.cjs'` | exit ≠ 0, stderr surfaced, NO success marker |
| Runs but no credentials | `--version` exit 0; `~/.oss/credentials.enc` absent | exit ≠ 0, names missing creds, NO success |
| Runs + creds present | `--version` exit 0; non-empty `credentials.enc` | exit 0, success marker printed |
| Creds present but empty file | empty `credentials.enc` | exit ≠ 0 (non-empty required) |

### Contract — `commands/login.md`
Grep-contract test asserting login.md (a) references `verify-decrypt-setup.sh`, (b) no longer
prints an install-success line guarded only by `[ -x …oss-decrypt ]`. Lives in
`hooks/__tests__/` (bash) or `watcher/test/hooks/` (vitest) — match existing infra.

### Regression — `ensure-decrypt-cli.sh`
Extend its harness: a binary that passes `--version` but whose `--setup` leaves no
`credentials.enc` must NOT yield a bare "ready". All 9 existing hook tests stay green.

## How to run
```bash
bash hooks/__tests__/verify-decrypt-setup.test.sh       # new verifier unit
bash hooks/__tests__/ensure-decrypt-cli.test.sh         # regression (was 9/9)
# contract test: bash or `cd watcher && npx vitest run test/hooks/<name>`
```

## Acceptance
The defining test: a v1.2.2-style crashing binary must make login FAIL loudly with the
`Cannot find module` stderr — never "Setup Complete". This is the exact false-positive being
eliminated.

## Results
### Acceptance (RED) — 2026-06-26
`bash hooks/__tests__/verify-decrypt-setup.test.sh` → **0/1 (expected RED)**.
`test_crashing_binary_fails_verification` fails because the boundary
`hooks/verify-decrypt-setup.sh` does not exist yet (exit 127) — canonical outside-in RED.
It encodes the defining behavior: a v1.2.2-style crashing binary
(`Cannot find module '/snapshot/dist/oss-decrypt.cjs'`) must yield exit≠0 + surfaced stderr
+ NO success marker. Turns green once the verifier is implemented (Phase 1 build).

### Build (GREEN) — 2026-06-26
- `verify-decrypt-setup.test.sh`: **4/4** (crash⇒fail+stderr, missing-creds⇒fail,
  empty-creds⇒fail, healthy⇒success).
- `ensure-decrypt-cli.test.sh`: **10/10** — new `test_setup_failure_no_false_ready` (hook
  no longer prints "ready" when `--setup` fails); pre-existing 9 still green.
- `login-setup-gate.test.sh`: **2/2** — login.md references the verifier and no longer
  prints success on a bare `[ -x ]` check.
- Wiring guard: `session-start-hooks-copy.test.ts` now asserts `verify-decrypt-setup.sh` is
  in HOOKS_TO_COPY; watcher hooks targeted suite **7/7**.

Acceptance met: a v1.2.2-style crashing binary now makes login FAIL loudly with the real
stderr instead of "Setup Complete".

## Last Updated: 2026-06-26 by /oss:plan
