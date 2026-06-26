/**
 * @behavior The release pipeline publishes a Linux/arm64 binary so aarch64 hosts
 *           (GB10, Graviton, GH200, Ampere) can auto-install the decrypt CLI.
 * @acceptance-criteria The exact asset name the install hook downloads on aarch64
 *           Linux — `oss-decrypt-Linux-arm64` (+ its .sha256) — is built and released.
 * @boundary Release pipeline / install-hook asset contract
 *
 * The install hook (hooks/ensure-decrypt-cli.sh) maps `uname -m`=aarch64 -> arm64 and
 * downloads `oss-decrypt-${PLATFORM}-${ARCH}` = `oss-decrypt-Linux-arm64` from the
 * latest release. If the pipeline does not publish that asset, the hook 404s and the
 * whole OSS pipeline is locked out on aarch64. This test guards that contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const workflowPath = resolve(
  __dirname,
  '../../../.github/workflows/release-cli-decrypt.yml'
);

const ARM64_ASSET = 'oss-decrypt-Linux-arm64';
const ARM64_TARGET = 'node18-linux-arm64';

describe('Release pipeline: aarch64 Linux support', () => {
  it('builds the node18-linux-arm64 target in the local build:binary script', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const buildBinary: string = pkg.scripts?.['build:binary'] ?? '';
    expect(buildBinary).toContain(ARM64_TARGET);
  });

  it('declares the oss-decrypt-Linux-arm64 artifact in the CI build matrix', () => {
    const yml = readFileSync(workflowPath, 'utf8');
    expect(yml).toContain(ARM64_TARGET);
    expect(yml).toContain(`artifact: ${ARM64_ASSET}`);
  });

  it('publishes the arm64 binary and its checksum in the release files list', () => {
    const yml = readFileSync(workflowPath, 'utf8');
    // The release job uploads both the binary and its .sha256 (hook fails closed
    // without a verifiable checksum).
    expect(yml).toContain(`${ARM64_ASSET}/${ARM64_ASSET}\n`);
    expect(yml).toContain(`${ARM64_ASSET}.sha256/${ARM64_ASSET}.sha256`);
  });

  it('builds the arm64 target on a NATIVE arm64 runner (pkg cannot cross-compile bytecode)', () => {
    // Regression guard for the v1.2.2 break: pkg compiles JS -> V8 bytecode PER CPU
    // arch and cannot cross-generate it. Cross-building node18-linux-arm64 on an x64
    // runner yields an arm64 ELF whose snapshot is missing the entry module ->
    // `Cannot find module '/snapshot/dist/oss-decrypt.cjs'` at runtime. The arm64
    // target MUST build on a native arm64 runner (e.g. ubuntu-24.04-arm).
    const yml = readFileSync(workflowPath, 'utf8');
    // Find the matrix include entry whose target is node18-linux-arm64 and capture its `os`.
    const m = yml.match(/-\s*os:\s*(\S+)\s+target:\s*node18-linux-arm64/);
    expect(m, 'arm64 matrix entry not found (expected `- os: <runner>` then `target: node18-linux-arm64`)').not.toBeNull();
    const os = m![1];
    expect(os, `arm64 must build on an arm64 runner, got os: ${os}`).toMatch(/arm/);
  });
});
