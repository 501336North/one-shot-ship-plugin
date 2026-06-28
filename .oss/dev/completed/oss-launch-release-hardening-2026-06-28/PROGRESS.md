# Progress: oss-launch release hardening + binary build

## Current Phase: build — Phase 1 DONE & VERIFIED → ready to /oss:ship. Phases 2–4 are gated ops.

## Tasks
### Phase 1 — Supply-chain hardening (reviewed PR, pre-tag) ✅
- [x] T1: SHA-pin all 5 actions in build-oss-launch.yml (incl. softprops/action-gh-release). Pin test 3/3.
- [x] T2: two-method verify in ensure-oss-launch.sh (in-release .sha256 + committed manifest),
      fail-closed. Shell 6/6 incl. release-tamper reject + no-entry fail-closed.
- [x] T3: pin release tag via OSS_LAUNCH_TAG (default oss-launch-v2.0.77) — no more latest/download.
- [x] T4: scripts/verify-release.sh (downloads + recomputes + cross-checks + emits manifest for
      review) + test 2/2.
- [x] Placeholder hooks/oss-launch-checksums.txt committed (no entries yet → fail-closed until Phase 3).
### Phase 2 — Build + release (gated CI op)
- [ ] T5: tag oss-launch-v<version> → native-runner build → 4 binaries + checksums + Release
### Phase 3 — Pin-back verified hashes (the security gate, reviewed PR)
- [ ] T6: capture + review + commit oss-launch-checksums.txt; point ensure at tag; version bump
- [ ] T7: local end-to-end verify against the REAL release asset (+ flip-byte reject)
### Phase 4 — Field acceptance (other session)
- [ ] T8: DeepBlue re-run, NO system Node, via bundled oss-launch

## Gates
- Phase 1 PR + Phase 3 PR are the two security gates (both human-reviewed).
- Phase 2 tag only BUILDS; nothing is customer-trusted until Phase 3 lands.

## Ship hardening (quality gates GO, applied)
- Fixed L1: stage the temp binary INSIDE BIN_DIR so the final `mv` is a same-fs atomic rename
  (was mktemp in $TMPDIR → cross-fs copy could leave a truncated +x binary).
- Fixed M1: verify-release.sh ARTIFACTS is now an array (no word-split footgun).
- Follow-up (LOW, non-blocking): bump `softprops/action-gh-release` from the v1 SHA (2022) to a
  pinned v2 SHA in a reviewed PR. Pinned-but-old is safe; just missing fixes.

## Blockers
- None for the code. T5 (push tag) + T6 (review/commit hashes) + T7 (verify) are now MINE to run
  once Phase 1 merges; only T8 (DeepBlue routing e2e) needs the other session's box.

## Last Updated: 2026-06-27 by /oss:plan
