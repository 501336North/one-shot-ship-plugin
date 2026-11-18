/**
 * @behavior /oss:trust CLI features: --verify-manifest and --list-prompts
 * @acceptance-criteria AC-TRUST-001 through AC-TRUST-010
 * @business-rule TRUST-001: Users can verify prompt integrity without auth
 * @business-rule TRUST-002: Users can list prompts by category for auditing
 * @boundary CLI Entry Point
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { parseArgs, runCli } from '../src/cli-entry.js';
import * as manifestVerifier from '../src/manifest-verifier.js';
import { MIN_MANIFEST_VERSION } from '../src/manifest-floor.js';

// Mock manifest verifier (collaborator)
vi.mock('../src/manifest-verifier.js');

function generateTestKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64'),
  };
}

function createTestManifest(privateKey: string): manifestVerifier.SignedManifest {
  const prompts: Record<string, { hash: string; size: number }> = {
    'commands/build': { hash: 'abc123', size: 100 },
    'commands/ship': { hash: 'def456', size: 200 },
    'commands/plan': { hash: 'ghi789', size: 150 },
    'hooks/pre-commit': { hash: 'jkl012', size: 80 },
    'agents/typescript-pro': { hash: 'mno345', size: 300 },
    'workflows/ideate': { hash: 'pqr678', size: 250 },
  };
  const sortedKeys = Object.keys(prompts).sort();
  const sortedPrompts: Record<string, { hash: string; size: number }> = {};
  for (const key of sortedKeys) {
    sortedPrompts[key] = prompts[key];
  }
  // R-273: at the compiled anti-rollback floor, so the floor accepts it.
  const data = JSON.stringify({
    version: MIN_MANIFEST_VERSION,
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts: sortedPrompts,
  });
  const sig = crypto.sign(
    null,
    Buffer.from(data, 'utf8'),
    crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' })
  );
  return {
    version: MIN_MANIFEST_VERSION,
    generatedAt: '2026-02-14T00:00:00Z',
    algorithm: 'sha256',
    signing: 'ed25519',
    prompts,
    signature: sig.toString('base64'),
  };
}

describe('/oss:trust - Acceptance Tests', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let keypair: { publicKey: string; privateKey: string };
  let validManifest: manifestVerifier.SignedManifest;
  let configDir: string;

  beforeEach(() => {
    vi.resetAllMocks();
    // R-273: these commands now read and record the manifest floor; keep it in a temp config dir.
    configDir = mkdtempSync(join(tmpdir(), 'oss-trust-'));
    process.env.OSS_CONFIG_DIR = configDir;
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    keypair = generateTestKeypair();
    validManifest = createTestManifest(keypair.privateKey);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
    delete process.env.OSS_CONFIG_DIR;
    rmSync(configDir, { recursive: true, force: true });
  });

  // =========================================================================
  // AC-TRUST-001: --verify-manifest flag parsing
  // =========================================================================
  describe('--verify-manifest (Quick Tier)', () => {
    /**
     * @behavior CLI accepts --verify-manifest flag
     * @acceptance-criteria AC-TRUST-001
     */
    it('should parse --verify-manifest flag', () => {
      const args = parseArgs(['--verify-manifest']);
      expect(args.verifyManifest).toBe(true);
    });

    /**
     * @behavior Verify manifest fetches from public endpoint without auth
     * @acceptance-criteria AC-TRUST-002
     */
    it('should fetch manifest without requiring auth credentials', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);

      await runCli(['--verify-manifest']);

      expect(manifestVerifier.fetchManifest).toHaveBeenCalled();
      // Should NOT require credentials/auth - just fetches public manifest
    });

    /**
     * @behavior Valid manifest outputs structured JSON report with signatureValid=true
     * @acceptance-criteria AC-TRUST-003
     */
    it('should output JSON report with signature valid when manifest is good', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);

      await runCli(['--verify-manifest']);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const report = JSON.parse(output);
      expect(report.signatureValid).toBe(true);
      expect(report.promptCount).toBe(6);
      expect(report.generatedAt).toBe('2026-02-14T00:00:00Z');
      expect(report.categories).toBeDefined();
    });

    /**
     * @behavior Invalid manifest outputs FAIL report
     * @acceptance-criteria AC-TRUST-004
     */
    it('should output JSON report with signatureValid=false when tampered', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);

      await runCli(['--verify-manifest']);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const report = JSON.parse(output);
      expect(report.signatureValid).toBe(false);
    });

    /**
     * @behavior Exit code 0 on valid, 1 on invalid
     * @acceptance-criteria AC-TRUST-005
     */
    it('should set exit code 1 when signature is invalid', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);

      await runCli(['--verify-manifest']);

      expect(process.exitCode).toBe(1);
    });

    /**
     * @behavior Handles manifest fetch failure gracefully
     * @acceptance-criteria AC-TRUST-006
     */
    it('should report error when manifest cannot be fetched', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(null);

      await runCli(['--verify-manifest']);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const report = JSON.parse(output);
      expect(report.signatureValid).toBe(false);
      expect(report.error).toContain('fetch');
    });
  });

  // =========================================================================
  // AC-TRUST-007: --list-prompts flag parsing and output
  // =========================================================================
  /**
   * @behavior Manifest text printed by --verify-manifest / --list-prompts cannot drive the terminal
   * @business-rule The manifest is server-supplied; JSON escapes C0 but not DEL or C1 (e.g. U+009B CSI),
   *   so the printed report carries none of them while staying valid JSON
   */
  describe('manifest text is stripped of terminal control characters', () => {
    const hostile = (): manifestVerifier.SignedManifest => ({
      ...validManifest,
      generatedAt: '2026\u009b2J\u007f-02-14',
      prompts: { 'commands/evil\u009b2J\u007f\u0085': { hash: 'h\u009dx', size: 1 } },
    });

    it('--list-prompts prints no DEL or C1 characters', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(hostile());
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);
      await runCli(['--list-prompts']);
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(JSON.parse(output)[0].name).toContain('evil');
    });

    it('--verify-manifest prints no DEL or C1 characters', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(hostile());
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);
      await runCli(['--verify-manifest']);
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
      expect(JSON.parse(output).generatedAt).toContain('2026');
    });
  });

  describe('--list-prompts (Prompt Enumeration)', () => {
    /**
     * @behavior CLI accepts --list-prompts flag
     * @acceptance-criteria AC-TRUST-007
     */
    it('should parse --list-prompts flag', () => {
      const args = parseArgs(['--list-prompts']);
      expect(args.listPrompts).toBe(true);
    });

    /**
     * @behavior List prompts outputs JSON array of all prompt entries
     * @acceptance-criteria AC-TRUST-008
     */
    it('should output JSON array with name, category, hash, size', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);

      await runCli(['--list-prompts']);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const prompts = JSON.parse(output);
      expect(Array.isArray(prompts)).toBe(true);
      expect(prompts.length).toBe(6);
      expect(prompts[0]).toHaveProperty('name');
      expect(prompts[0]).toHaveProperty('category');
      expect(prompts[0]).toHaveProperty('hash');
      expect(prompts[0]).toHaveProperty('size');
    });

    /**
     * @behavior --category flag filters prompt list
     * @acceptance-criteria AC-TRUST-009
     */
    it('should filter by --category when provided', () => {
      const args = parseArgs(['--list-prompts', '--category', 'commands']);
      expect(args.listPrompts).toBe(true);
      expect(args.category).toBe('commands');
    });

    it('should output only matching category prompts', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);

      await runCli(['--list-prompts', '--category', 'commands']);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const prompts = JSON.parse(output);
      expect(prompts.every((p: { category: string }) => p.category === 'commands')).toBe(true);
      expect(prompts.length).toBe(3); // build, ship, plan
    });

    /**
     * @behavior --list-prompts never lists a manifest whose signature fails
     * @business-rule R-273 P1 (Revision 3, user decision): --list-prompts verifies the signature;
     *   on failure it prints [] and exits non-zero
     */
    it('prints [] and exits non-zero when the manifest signature fails', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);
      process.exitCode = undefined;

      await runCli(['--list-prompts']);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const exitCode = process.exitCode;
      process.exitCode = undefined;
      expect(JSON.parse(output)).toEqual([]);
      expect(exitCode).not.toBe(0);
      expect(exitCode).toBeDefined();
    });

    /**
     * @behavior List prompts works without auth (uses public manifest)
     * @acceptance-criteria AC-TRUST-010
     */
    it('should work without auth credentials', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);

      await runCli(['--list-prompts']);

      expect(manifestVerifier.fetchManifest).toHaveBeenCalled();
      // No auth-related calls should happen
    });
  });

  /**
   * @behavior --verify-manifest and --list-prompts judge the manifest like decrypt does: a bounded retry
   *   when it is unreachable, and the anti-rollback floor
   * @business-rule R-273 ship round 1: an unreachable manifest is a failure (exit 1 with the unreachable
   *   reason), never an empty list; a signed manifest older than the floor is refused
   * @boundary CLI Entry Point (manifest fetch stubbed; the floor file is real, in a temp config dir)
   */
  describe('unreachable and replayed manifests (R-273)', () => {
    // these commands verify no prompt, so the line says only what failed (decrypt keeps its own message)
    const UNREACHABLE = '[SECURITY] Manifest unreachable — check your connection and run the command again';
    let stderr: string[];

    beforeEach(() => {
      process.exitCode = undefined;
      stderr = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        stderr.push(args.map(String).join(' '));
      });
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);
    });

    afterEach(() => {
      process.exitCode = undefined;
    });

    const exitCode = (): number => Number(process.exitCode ?? 0);

    it.each([['--list-prompts'], ['--verify-manifest']])(
      '%s retries once, then exits 1 with the unreachable reason',
      async (flag) => {
        vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(null);

        await runCli([flag]);

        expect(manifestVerifier.fetchManifest).toHaveBeenCalledTimes(2);
        expect(exitCode()).toBe(1);
        expect(stderr).toEqual([UNREACHABLE]);
      }
    );

    it.each([['--list-prompts'], ['--verify-manifest']])(
      '%s refuses a signed manifest older than the floor: exit 1, no prompts listed',
      async (flag) => {
        vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue({ ...validManifest, version: MIN_MANIFEST_VERSION - 1 });

        await runCli([flag]);

        expect(exitCode()).toBe(1);
        expect(stderr.join('\n')).toMatch(/older than one already seen/);
        expect(consoleSpy.mock.calls.map(c => String(c[0])).join('\n')).not.toContain('commands/build');
      }
    );

    it('--list-prompts lists a manifest at the floor', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue({ ...validManifest, version: MIN_MANIFEST_VERSION });

      await runCli(['--list-prompts']);

      expect(exitCode()).toBe(0);
      expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toHaveLength(6);
    });
  });

  /**
   * @behavior --verify-manifest reports a junk, unsigned manifest as not valid instead of crashing on it
   * @business-rule R-273 ship round 2 (pen F7): a failed signature (or prompts that are not an object) is a
   *   signatureValid:false JSON report with exit 1; nothing in an unverified manifest is walked
   * @boundary CLI Entry Point (manifest fetch stubbed)
   */
  describe('--verify-manifest on a junk manifest', () => {
    it.each([
      ['{}', {}],
      ['prompts: null', { version: MIN_MANIFEST_VERSION, generatedAt: 'x', algorithm: 'sha256', signing: 'ed25519', prompts: null, signature: 'x' }],
      ['prompts: a string', { version: MIN_MANIFEST_VERSION, generatedAt: 'x', algorithm: 'sha256', signing: 'ed25519', prompts: 'x', signature: 'x' }],
    ])('%s: signatureValid false, exit 1, no crash', async (_label, junk) => {
      process.exitCode = undefined;
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(junk as unknown as manifestVerifier.SignedManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);

      await runCli(['--verify-manifest']);

      const report = JSON.parse(consoleSpy.mock.calls.map(c => String(c[0])).join('\n')) as { signatureValid: boolean };
      expect(report.signatureValid).toBe(false);
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });
  });

  /**
   * @behavior --verify-manifest says in its JSON whether the manifest is trusted, so /oss:trust never shows a
   *   refused (rolled-back) manifest as VALID just because its signature checks out
   * @business-rule R-273 ship step 2: `trusted` is true only when the signature verifies AND the anti-rollback
   *   floor accepts the version; `signatureValid` stays truthful about the signature alone
   * @boundary CLI Entry Point (manifest fetch stubbed; the floor file is real, in a temp config dir)
   */
  describe('--verify-manifest trusted verdict (R-273)', () => {
    type Report = { signatureValid: boolean; trusted?: boolean; error?: string };
    const report = (): Report => JSON.parse(consoleSpy.mock.calls.map(c => String(c[0])).join('\n')) as Report;

    beforeEach(() => {
      process.exitCode = undefined;
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      process.exitCode = undefined;
    });

    it('a signed manifest older than the floor: trusted false, error kept, exit 1', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue({ ...validManifest, version: MIN_MANIFEST_VERSION - 1 });
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);

      await runCli(['--verify-manifest']);

      expect(report()).toMatchObject({ signatureValid: true, trusted: false, error: 'Manifest is older than one already seen' });
      expect(process.exitCode).toBe(1);
    });

    it('a signed manifest at the floor: trusted true, no error, exit 0', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(true);

      await runCli(['--verify-manifest']);

      expect(report()).toMatchObject({ signatureValid: true, trusted: true });
      expect(report().error).toBeUndefined();
      expect(Number(process.exitCode ?? 0)).toBe(0);
    });

    it('an unsigned manifest: signatureValid false, trusted false, exit 1', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(validManifest);
      vi.mocked(manifestVerifier.verifyManifestSignature).mockReturnValue(false);

      await runCli(['--verify-manifest']);

      expect(report()).toMatchObject({ signatureValid: false, trusted: false });
      expect(process.exitCode).toBe(1);
    });

    it('an unreachable manifest: trusted false, exit 1', async () => {
      vi.mocked(manifestVerifier.fetchManifest).mockResolvedValue(null);

      await runCli(['--verify-manifest']);

      expect(report()).toMatchObject({ signatureValid: false, trusted: false, error: 'Failed to fetch manifest' });
      expect(process.exitCode).toBe(1);
    });
  });
});
