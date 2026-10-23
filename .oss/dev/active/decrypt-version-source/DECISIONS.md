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
