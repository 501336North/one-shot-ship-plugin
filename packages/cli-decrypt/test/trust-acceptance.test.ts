/**
 * @behavior /oss:trust CLI features: --verify-manifest and --list-prompts
 * @acceptance-criteria AC-TRUST-001 through AC-TRUST-010
 * @business-rule TRUST-001: Users can verify prompt integrity without auth
 * @business-rule TRUST-002: Users can list prompts by category for auditing
 * @boundary CLI Entry Point
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

import { parseArgs, runCli } from '../src/cli-entry.js';
import * as manifestVerifier from '../src/manifest-verifier.js';

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
  const data = JSON.stringify({
    version: 1,
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
    version: 1,
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

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    keypair = generateTestKeypair();
    validManifest = createTestManifest(keypair.privateKey);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
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

      await runCli(['--list-prompts', '--category', 'commands']);

      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      const prompts = JSON.parse(output);
      expect(prompts.every((p: { category: string }) => p.category === 'commands')).toBe(true);
      expect(prompts.length).toBe(3); // build, ship, plan
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
});
