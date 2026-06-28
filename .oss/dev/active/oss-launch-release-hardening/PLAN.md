# PLAN: oss-launch release hardening + binary build

**Repo:** `one-shot-ship-plugin` (plugin-only)
**Branch:** `feat/oss-launch-release-hardening/build` (cut from `origin/main`)
**Methodology:** London TDD where code applies (shell harness for `ensure-oss-launch.sh`); the
release run + hash pin-back are **gated ops steps** with explicit human review, not auto-runnable.
**Design:** see `DESIGN.md`. Two-method verification (in-release `.sha256` + committed manifest) +
SHA-pinned actions + pinned release tag.

> ⛔ IRON LAW #4: branch off main. ⚠️ Vitest-overload N/A (shell tests only here).
> 🔒 This feature MUTATES the release surface — treat tag push + hash commit as deliberate, reviewed.

---

## Phase 1 — Supply-chain hardening (pre-tag, fully code-reviewable)

- **T1 — SHA-pin every action in `build-oss-launch.yml`.** Resolve each `uses: <a>@<tag>` to a full
  commit SHA (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>` → `.object.sha`, deref annotated tags),
  rewrite as `uses: <a>@<sha> # <tag>`. Priority: `softprops/action-gh-release` (write-capable job);
  also `actions/checkout|setup-node|upload-artifact|download-artifact`. Verify the workflow still
  parses (`actionlint` if available, else a YAML parse + a `grep` asserting no bare `@vN` remains).
- **T2 — Two-method verify in `ensure-oss-launch.sh` (RED→GREEN, shell).** Add a committed
  manifest check: after the existing in-release `.sha256` passes, look up the expected hash for
  `oss-launch-<OS>-<arch>` in `hooks/oss-launch-checksums.txt` and require it to match too. Fail-closed:
  manifest missing the entry, OR mismatch → reject (nothing cached executable). New tests in
  `hooks/__tests__/ensure-oss-launch.test.sh`:
  - committed-hash present + matches → install.
  - committed-hash **mismatch** (even if the in-release `.sha256` matches) → **reject** (the release-
    tamper defense).
  - manifest entry **absent** for this OS/arch → reject (fail-closed, never "trust on first use").
- **T3 — Pin the release tag.** `ensure-oss-launch.sh` fetches from
  `releases/download/<OSS_LAUNCH_TAG>/…` (default = the released tag constant), not `latest`.
  Test: with `OSS_LAUNCH_TAG` set, the constructed URL contains the tag. Keep `OSS_LAUNCH_RELEASES_URL`
  override as the test seam.
- **T4 — `scripts/verify-release.sh` (the releaser's gate helper).** Given a tag, downloads each
  published binary + `.sha256`, recomputes SHA-256, and prints a ready-to-commit
  `oss-launch-checksums.txt` for human review. Shell-test the formatting against fixtures.

✅ **Milestone: Phase 1 ships as a reviewed PR** — hardens the verify path and the workflow BEFORE any
binary exists. (The manifest is empty/absent until Phase 3; ensure-oss-launch fail-closes, which is
correct — no binary is trusted yet.)

## Phase 2 — Build + release the binaries (gated CI op)

- **T5 — Cut tag `oss-launch-v<version>`** → triggers `build-oss-launch.yml`. Produces 4 native
  binaries (Linux arm64/x64, Darwin arm64/x64) + `.sha256` + a GitHub Release. **Gate:** the
  workflow's own node-stripped `--version` smoke must pass on every arch; confirm all 8 assets
  attached. (Human-initiated tag; CI does the build.)

## Phase 3 — Pin-back the verified hashes (the security gate, reviewed PR)

- **T6 — Capture + review + commit the manifest.** Run `scripts/verify-release.sh <tag>`, **review**
  the four hashes against the Release page, commit `hooks/oss-launch-checksums.txt`, set the default
  `OSS_LAUNCH_TAG` to the released tag, bump `.claude-plugin/plugin.json`. This PR is the gate —
  binaries become customer-trusted only here.
- **T7 — Local end-to-end of the verify path against the REAL release.** Hashing is OS-agnostic, so on
  this Mac: fetch the real `oss-launch-Linux-arm64` + `.sha256` from the tag and assert
  `ensure-oss-launch.sh` accepts it AND that a one-byte-flipped copy is rejected by the committed
  manifest. Proves the two-method gate end-to-end without needing to execute a Linux binary.

## Phase 4 — Field acceptance (other session)

- **T8 — DeepBlue re-run with NO system Node**, launched via the bundled `oss-launch` (drain.sh →
  the binary). Expect the proven routing result (0→N Ollama calls, per-agent dispatch, loud fallback)
  with zero system Node on the box. Same VERIFY commands as the shipped routing feature.

---

## Task → file → verified-by
| Phase | Tasks | File(s) | Verified by |
|------|------|---------|-------------|
| 1 | T1 | build-oss-launch.yml | no bare `@vN`; workflow parses |
| 1 | T2–T4 | ensure-oss-launch.sh, oss-launch-checksums.txt, scripts/verify-release.sh, tests | shell: tamper-reject, fail-closed, tag URL |
| 2 | T5 | (tag) | CI: per-arch node-stripped smoke + 8 assets |
| 3 | T6–T7 | oss-launch-checksums.txt, ensure-oss-launch.sh, plugin.json | local fetch+verify of REAL release asset; flip-byte reject |
| 4 | T8 | drain.sh (DeepBlue) | 0→N Ollama, zero system Node |

## Sequencing & gates
Phase 1 (reviewed PR) → Phase 2 (tag, CI build) → Phase 3 (reviewed pin-back PR) → Phase 4 (field).
The two reviewed PRs (Phase 1, Phase 3) are the security gates; the tag in Phase 2 only builds —
nothing is *trusted* by customers until Phase 3 lands.

## Risks
- **R1 — annotated vs lightweight tags when resolving action SHAs (T1):** deref via
  `git/ref/tags` → if `object.type == tag`, follow to the commit. Get it wrong and CI breaks loudly
  (caught immediately, not a silent risk).
- **R2 — `pkg` is archived.** Pinned to 5.8.1; works. Future: migrate to `@yao-pkg/pkg` (node20+).
  Out of scope; note in DECISIONS.
- **R3 — manifest staleness:** every future release MUST update `oss-launch-checksums.txt` in the
  same PR, or ensure-oss-launch fail-closes. That's the intended safety (loud), but document it.

## Definition of done
SHA-pinned workflow; ensure-oss-launch verifies BOTH the in-release checksum AND a committed,
code-reviewed manifest, pinned to a release tag, fail-closed; the first `oss-launch-v*` release built
on native runners; hashes committed via reviewed PR; local end-to-end of the verify path against the
real release. DeepBlue field acceptance is the final external gate.

## Last Updated: 2026-06-27 by /oss:plan
