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
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const workflowPath = resolve(
  __dirname,
  '../../../.github/workflows/release-cli-decrypt.yml'
);

const ARM64_ASSET = 'oss-decrypt-Linux-arm64';
const ARM64_TARGET = 'node22-linux-arm64';

describe('Release pipeline: aarch64 Linux support', () => {
  it('builds the node22-linux-arm64 target in the local build:binary script', () => {
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
    // Find the matrix include entry whose target is node22-linux-arm64 and capture its `os`.
    const m = yml.match(/-\s*os:\s*(\S+)\s+target:\s*node22-linux-arm64/);
    expect(m, 'arm64 matrix entry not found (expected `- os: <runner>` then `target: node22-linux-arm64`)').not.toBeNull();
    const os = m![1];
    expect(os, `arm64 must build on an arm64 runner, got os: ${os}`).toMatch(/arm/);
  });
});

/**
 * @behavior A cli-decrypt release refuses to build when its tag does not match the source.
 * @acceptance-criteria The tag version (cli-decrypt-vX.Y.Z) must equal package.json "version"
 *           AND `VERSION` in src/index.ts, checked before `Build bundle`; any mismatch fails the job.
 * @boundary Release pipeline
 *
 * Root cause guarded: a release once shipped with package.json bumped but VERSION not,
 * so the binary reported a stale version.
 */
const CHECK_STEP = 'Check tag matches version';

function stepRunScript(yml: string, stepName: string): string | null {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (start === -1) return null;
  const stepIndent = lines[start].indexOf('-');
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    const indent = l.search(/\S/);
    if (indent !== -1 && indent <= stepIndent) break; // next step / end of steps
    if (l.trim() === 'run: |') {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const bi = lines[j].search(/\S/);
        if (bi !== -1 && bi <= indent) break;
        body.push(lines[j].slice(indent + 2));
      }
      return body.join('\n');
    }
  }
  return null;
}

function runCheck(script: string, tag: string, pkgVersion: string, srcVersion: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'tag-check-'));
  try {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: pkgVersion }));
    writeFileSync(join(dir, 'src/index.ts'), `export const VERSION = '${srcVersion}';\n`);
    try {
      execFileSync('bash', ['-c', script], {
        cwd: dir,
        env: { ...process.env, GITHUB_REF_NAME: tag },
        stdio: 'pipe',
      });
      return 0;
    } catch (e) {
      return (e as { status?: number }).status ?? 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Release pipeline: tag must match the source version', () => {
  const yml = readFileSync(workflowPath, 'utf8');

  it('should check the tag against package.json and VERSION before building', () => {
    const check = yml.indexOf(`- name: ${CHECK_STEP}`);
    const build = yml.indexOf('- name: Build bundle');
    expect(check, `build job has no "${CHECK_STEP}" step`).toBeGreaterThan(-1);
    expect(check, `"${CHECK_STEP}" must run before "Build bundle"`).toBeLessThan(build);
  });

  describe('the check script', () => {
    const script = stepRunScript(yml, CHECK_STEP);

    it('has a run: | script', () => {
      expect(script, `"${CHECK_STEP}" step has no \`run: |\` script`).not.toBeNull();
    });

    it('passes when tag, package.json and VERSION all agree', () => {
      expect(script).not.toBeNull();
      expect(runCheck(script!, 'cli-decrypt-v1.2.4', '1.2.4', '1.2.4')).toBe(0);
    });

    it('fails when the tag differs from both sources', () => {
      expect(script).not.toBeNull();
      expect(runCheck(script!, 'cli-decrypt-v1.2.5', '1.2.4', '1.2.4')).not.toBe(0);
    });

    it('fails when VERSION in src/index.ts was not bumped', () => {
      expect(script).not.toBeNull();
      expect(runCheck(script!, 'cli-decrypt-v1.2.4', '1.2.4', '1.2.1')).not.toBe(0);
    });

    it('fails when package.json was not bumped', () => {
      expect(script).not.toBeNull();
      expect(runCheck(script!, 'cli-decrypt-v1.2.4', '1.2.3', '1.2.4')).not.toBe(0);
    });
  });
});

/**
 * @behavior The release pipeline cannot be hijacked through a moved action tag or an
 *           over-privileged build job.
 * @acceptance-criteria Every third-party action is pinned to a full commit SHA; the build job
 *           only reads the repo (contents: read); only the release job may write (contents: write,
 *           nothing broader); the tag/version check runs before any dependency is installed.
 * @boundary Release pipeline
 */
function jobBlock(yml: string, job: string): string {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

function permissionsOf(block: string): string[] {
  const lines = block.split('\n');
  const at = lines.findIndex((l) => /^ {4}permissions:\s*$/.test(l));
  if (at === -1) return [];
  const out: string[] = [];
  for (let i = at + 1; i < lines.length && /^ {6}\S/.test(lines[i]); i++) out.push(lines[i].trim());
  return out;
}

describe('Release pipeline: supply-chain hardening', () => {
  const yml = readFileSync(workflowPath, 'utf8');

  it('pins every action to a full 40-char commit SHA', () => {
    const uses = [...yml.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(uses.length).toBe(6);
    for (const u of uses) expect(u, `unpinned action: ${u}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it('gives the build job read-only repo access', () => {
    expect(permissionsOf(jobBlock(yml, 'build'))).toEqual(['contents: read']);
  });

  it('gives the release job contents: write and nothing broader', () => {
    expect(permissionsOf(jobBlock(yml, 'release'))).toEqual(['contents: write']);
  });

  it('checks the tag before installing dependencies', () => {
    const check = yml.indexOf(`- name: ${CHECK_STEP}`);
    const install = yml.indexOf('run: npm ci');
    expect(check).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(-1);
    expect(check, `"${CHECK_STEP}" must run before npm ci`).toBeLessThan(install);
  });

  // npm ci runs dependency install scripts; a persisted checkout token in .git/config
  // would hand them the job's GITHUB_TOKEN.
  it('never leaves the GITHUB_TOKEN in .git/config for dependency install scripts', () => {
    const checkouts = [
      ...yml.matchAll(/^(\s*)-\s*uses:\s*actions\/checkout@\S+[^\n]*\n((?:\1\s+[^\n]*\n)*)/gm),
    ];
    expect(checkouts.length).toBeGreaterThan(0);
    for (const c of checkouts) {
      expect(c[2], 'actions/checkout must set persist-credentials: false').toMatch(
        /^\s+persist-credentials:\s*false\s*$/m
      );
    }
  });

  // A tag-triggered release must not restore a shared npm cache another workflow could poison.
  it('does not restore a shared npm cache in the release build', () => {
    expect(yml).not.toMatch(/^\s*cache:/m);
    expect(yml).not.toMatch(/^\s*cache-dependency-path:/m);
  });
});
