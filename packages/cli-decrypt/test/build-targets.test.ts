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
});
