# Decisions: decrypt-version-source

## D1 — Keep the VERSION constant, guard it with a test (2026-10-22)
tsconfig `rootDir: ./src` forbids importing `../package.json`; deriving it via an esbuild define would leave the
`tsc` build (`dist/index.js`) with a different value. A test that VERSION equals package.json, plus a release
step that refuses a mismatching tag, gives one checked source with no build change.

## D2 — MINIMUM_VERSION stays 1.2.1 (2026-10-22)
Raising it would re-download the CLI for every existing user for a cosmetic version string. New installs get
v1.2.4 through the pin; existing installs keep a working binary.

## D3 — Ship FOLLOWUPS line 46 in the same release (user, 2026-10-22)
It touches the same binary; doing it later would need a second release. `redirect: 'error'` on the three
keyed fetches (the API never redirects them, checked against prod) and `encodeURIComponent` on names.
`fetchManifest` sends no key and is left alone.

## D4 — Two PRs (2026-10-22)
The hook's committed checksums must be the real release hashes, which exist only after the tag is pushed.

## D5 (2026-10-23, supersedes D2): MINIMUM_VERSION = 1.2.4
All four PR 2 gate reviewers: with 1.2.1 the security fixes in v1.2.4 never reach existing installs. v1.2.4 reports its real version, so a 1.2.4 floor cannot loop. Cost: one verified download per existing user. User chose this.

## D6 (2026-10-23): soft upgrade
A failed upgrade download keeps a working older binary (warn, exit 0, retry next command); hash mismatches and a missing binary stay hard failures; a binary reporting below the floor is never installed. Trade-off accepted: whoever blocks GitHub can delay (not prevent or downgrade) the upgrade. User chose this over fail-closed and over dropping the 1.2.4 floor.
