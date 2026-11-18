/**
 * CLI entry point for OSS Decrypt
 * Parses arguments and routes to appropriate commands
 */

import { VERSION } from './index.js';
import { setupCommand } from './commands/setup.js';
import { createHash } from 'crypto';
import { decryptCommand, fetchManifestQuietly } from './commands/decrypt.js';
import { verifyManifestSignature, type SignedManifest } from './manifest-verifier.js';
import { checkAndRecordManifestVersion, type FloorVerdict } from './manifest-floor.js';
import { stripControl } from './strip-control.js';
import { getApiUrl } from './config.js';

/**
 * Parsed CLI arguments
 */
export interface CliArgs {
  help?: boolean;
  version?: boolean;
  setup?: boolean;
  debug?: boolean;
  noCache?: boolean;
  clearCache?: boolean;
  verifyManifest?: boolean;
  listPrompts?: boolean;
  verifyBody?: string;
  category?: string;
  type?: 'commands' | 'workflows' | 'skills' | 'agents' | 'hooks' | 'custom';
  name?: string;
}

/**
 * Parse command line arguments
 */
export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--help':
      case '-h':
        result.help = true;
        break;
      case '--version':
      case '-v':
        result.version = true;
        break;
      case '--setup':
        result.setup = true;
        break;
      case '--debug':
      case '-d':
        result.debug = true;
        break;
      case '--no-cache':
        result.noCache = true;
        break;
      case '--clear-cache':
        result.clearCache = true;
        break;
      case '--verify-manifest':
        result.verifyManifest = true;
        break;
      case '--list-prompts':
        result.listPrompts = true;
        break;
      case '--verify-body':
        result.verifyBody = args[++i] ?? '';
        break;
      case '--category':
        result.category = args[++i];
        break;
      case '--type':
      case '-t':
        result.type = args[++i] as CliArgs['type'];
        break;
      case '--name':
      case '-n':
        result.name = args[++i];
        break;
    }
  }

  return result;
}

/**
 * Show help text
 */
function showHelp(): void {
  console.log(`
OSS Decrypt CLI v${VERSION}

Usage:
  oss-decrypt --setup              Fetch and store credentials
  oss-decrypt --type <type> --name <name>  Decrypt a prompt
  oss-decrypt --verify-manifest    Verify prompt manifest signature
  oss-decrypt --list-prompts       List all prompts in the manifest
  oss-decrypt --list-prompts --category <cat>  List prompts filtered by category
  oss-decrypt --verify-body <key> < body  Check a fetched body against the signed manifest

Options:
  --setup              Run initial setup (fetch credentials)
  --type, -t <type>    Prompt type: commands, workflows, skills, agents, hooks, custom
  --name, -n <name>    Prompt name
  --debug, -d          Enable verbose debug output
  --no-cache           Bypass cache, always fetch from API
  --clear-cache        Clear all cached prompts
  --verify-manifest    Fetch and verify the signed prompt manifest
  --list-prompts       List all prompts from the manifest
  --category <cat>     Filter --list-prompts by category
  --verify-body <key>  Exit 0 only if stdin's sha256 equals the signed servedHash of <key>
                       (shared/iron-laws or templates/claude-md); needs no credentials
  --help, -h           Show this help
  --version, -v        Show version

Examples:
  oss-decrypt --setup
  oss-decrypt --type commands --name plan
  oss-decrypt --type workflows --name build
  oss-decrypt --debug --type commands --name plan
  oss-decrypt --no-cache --type commands --name plan
  oss-decrypt --clear-cache
  oss-decrypt --verify-manifest
  oss-decrypt --list-prompts
  oss-decrypt --list-prompts --category commands
`);
}

/**
 * Show version
 */
function showVersion(): void {
  console.log(`oss-decrypt v${VERSION}`);
}

const MANIFEST_PUBLIC_KEY = 'MCowBQYDK2VwAyEAAwFG32b8TuiVTxrDnXzNrb2v68YN5U9epLnZ3O7pQaI=';

/** Why a command that verifies no prompt stops when the manifest can't be fetched (decrypt has its own). */
const MANIFEST_UNREACHABLE = '[SECURITY] Manifest unreachable — check your connection and run the command again';

/** The manifest (3 s attempt, one 10 s retry), or null once the unreachable line is printed. */
async function fetchManifestBounded(apiUrl: string): Promise<SignedManifest | null> {
  const manifest = await fetchManifestQuietly(apiUrl);
  if (manifest === null) console.error(MANIFEST_UNREACHABLE);
  return manifest;
}

/** The anti-rollback refusal for a signature-verified manifest, or null when the floor accepts it. */
function floorRefusal(verdict: FloorVerdict): string | null {
  if (verdict === 'accepted') return null;
  return verdict === 'older'
    ? 'Manifest is older than one already seen'
    : 'Manifest has no valid version';
}

/**
 * Verify the signed prompt manifest and output a JSON report
 */
async function verifyManifestCommand(): Promise<void> {
  const apiUrl = getApiUrl();
  const manifest = await fetchManifestBounded(apiUrl);

  if (manifest === null) {
    console.log(JSON.stringify({ signatureValid: false, trusted: false, error: 'Failed to fetch manifest' }));
    process.exitCode = 1;
    return;
  }

  // Nothing in a manifest whose signature fails is walked (it may not even have a prompts object).
  const prompts: unknown = manifest.prompts;
  const signatureValid =
    prompts !== null && typeof prompts === 'object' && !Array.isArray(prompts)
    && verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY);
  if (!signatureValid) {
    console.log(JSON.stringify({ signatureValid: false, trusted: false, error: 'Manifest signature does not verify' }));
    process.exitCode = 1;
    return;
  }
  const refusal = floorRefusal(checkAndRecordManifestVersion(apiUrl, manifest.version));

  const categories: Record<string, number> = {};
  for (const key of Object.keys(manifest.prompts)) {
    const category = key.split('/')[0];
    categories[category] = (categories[category] ?? 0) + 1;
  }

  // trusted: the signature verifies AND the anti-rollback floor accepts the version (/oss:trust shows only this as VALID)
  const report = {
    signatureValid,
    trusted: refusal === null,
    promptCount: Object.keys(manifest.prompts).length,
    generatedAt: manifest.generatedAt,
    categories,
    ...(refusal === null ? {} : { error: refusal }),
  };

  console.log(stripControl(JSON.stringify(report)));
  if (refusal !== null) console.error(`[SECURITY] ${refusal} — manifest not trusted`);

  if (refusal !== null) {
    process.exitCode = 1;
  }
}

/**
 * List prompts from the manifest, optionally filtered by category
 */
async function listPromptsCommand(category?: string): Promise<void> {
  const apiUrl = getApiUrl();
  const manifest = await fetchManifestBounded(apiUrl);

  if (manifest === null || !verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY)) {
    console.log(JSON.stringify([]));
    process.exitCode = 1;
    return;
  }

  const refusal = floorRefusal(checkAndRecordManifestVersion(apiUrl, manifest.version));
  if (refusal !== null) {
    console.error(`[SECURITY] ${refusal} — manifest not trusted`);
    console.log(JSON.stringify([]));
    process.exitCode = 1;
    return;
  }

  let entries = Object.entries(manifest.prompts).map(([key, value]) => ({
    name: key,
    category: key.split('/')[0],
    hash: value.hash,
    size: value.size,
  }));

  if (category) {
    entries = entries.filter((entry) => entry.category === category);
  }

  console.log(stripControl(JSON.stringify(entries)));
}

/** Bodies a hook may verify (R-273 D12): an exact set, so no prototype key can match. */
const VERIFIABLE_BODIES = new Set(['shared/iron-laws', 'templates/claude-md']);

/** Largest body --verify-body reads: 1 MiB, far above the IRON LAWS and CLAUDE.md template bodies. */
export const OSS_BODY_MAX = 1024 * 1024;

/** How long --verify-body waits for its piped body to end. */
export const VERIFY_BODY_STDIN_TIMEOUT_MS = 30_000;

/** Raw stdin bytes (no decoding, no trimming), or why they were not read in full. */
async function readStdinCapped(): Promise<Buffer | 'too-large' | 'timed-out'> {
  const stdin = process.stdin;
  const readAll = async (): Promise<Buffer | 'too-large'> => {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stdin) {
      total += (chunk as Buffer).length;
      if (total > OSS_BODY_MAX) return 'too-large';
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  };
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<'timed-out'>((done) => {
    timer = setTimeout(() => done('timed-out'), VERIFY_BODY_STDIN_TIMEOUT_MS);
  });
  const reading = readAll();
  reading.catch(() => undefined);
  try {
    const result = await Promise.race([reading, deadline]);
    if (result === 'timed-out') stdin.destroy();
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** Why the body can't be trusted, or null when it is exactly what the signed manifest says was served. */
async function verifyBodyReason(key: string): Promise<string | null> {
  if (!VERIFIABLE_BODIES.has(key)) return '[SECURITY] --verify-body: key is not a verifiable body';
  if (process.stdin.isTTY) return '[SECURITY] --verify-body: the body must be piped on stdin, not typed at a terminal';
  const apiUrl = getApiUrl();
  // Request the manifest while stdin is read (it prints nothing itself); a body refused on its own cancels
  // it, so that reason is the one line printed.
  const cancel = new AbortController();
  const manifestRequest = fetchManifestQuietly(apiUrl, cancel.signal);
  const body = await readStdinCapped();
  if (body === 'too-large' || body === 'timed-out') {
    cancel.abort();
    return body === 'too-large'
      ? `[SECURITY] --verify-body: body is larger than ${OSS_BODY_MAX} bytes`
      : `[SECURITY] --verify-body: stdin did not end within ${VERIFY_BODY_STDIN_TIMEOUT_MS / 1000} s`;
  }
  const manifest = await manifestRequest;
  if (manifest === null) return MANIFEST_UNREACHABLE;
  if (!verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY)) {
    return '[SECURITY] Manifest signature verification FAILED — body not verified';
  }
  const floorVerdict = checkAndRecordManifestVersion(apiUrl, manifest.version);
  if (floorVerdict !== 'accepted') {
    return floorVerdict === 'older'
      ? '[SECURITY] Manifest is older than one already seen — body not verified'
      : '[SECURITY] Manifest has no valid version — body not verified';
  }
  const entry = Object.hasOwn(manifest.prompts, key) ? manifest.prompts[key] : undefined;
  if (typeof entry?.servedHash !== 'string') {
    return `[SECURITY] No servedHash in the manifest for ${key} — body not verified`;
  }
  if (createHash('sha256').update(body).digest('hex') !== entry.servedHash) {
    return `[SECURITY] Body hash does not match the signed manifest for ${key} — body not verified`;
  }
  return null;
}

/**
 * --verify-body <key>: exit 0 only when stdin's sha256 equals the signed manifest's servedHash for
 * <key>. Any failure: exit 1, one reason line on stderr, nothing on stdout.
 */
async function verifyBodyCommand(key: string): Promise<void> {
  const reason = await verifyBodyReason(key);
  if (reason === null) return;
  console.error(reason);
  process.exitCode = 1;
}

/**
 * Run the CLI with the given arguments
 */
export async function runCli(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    showHelp();
    return;
  }

  if (parsed.version) {
    showVersion();
    return;
  }

  if (parsed.setup) {
    await setupCommand();
    return;
  }

  if (parsed.clearCache) {
    await decryptCommand('commands', 'any', parsed.debug ?? false, { clearCache: true });
    return;
  }

  if (parsed.verifyManifest) {
    await verifyManifestCommand();
    return;
  }

  if (parsed.verifyBody !== undefined) {
    await verifyBodyCommand(parsed.verifyBody);
    return;
  }

  if (parsed.listPrompts) {
    await listPromptsCommand(parsed.category);
    return;
  }

  if (parsed.type && parsed.name) {
    await decryptCommand(parsed.type, parsed.name, parsed.debug ?? false, {
      noCache: parsed.noCache,
    });
    return;
  }

  // No valid command - show help
  showHelp();
  process.exitCode = 1;
}
