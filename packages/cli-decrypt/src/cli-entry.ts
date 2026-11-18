/**
 * CLI entry point for OSS Decrypt
 * Parses arguments and routes to appropriate commands
 */

import { VERSION } from './index.js';
import { setupCommand } from './commands/setup.js';
import { createHash } from 'crypto';
import { decryptCommand, fetchManifestWithRetry } from './commands/decrypt.js';
import { fetchManifest, verifyManifestSignature, type SignedManifest } from './manifest-verifier.js';
import { checkAndRecordManifestVersion } from './manifest-floor.js';
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

/**
 * Verify the signed prompt manifest and output a JSON report
 */
async function verifyManifestCommand(): Promise<void> {
  const manifest = await fetchManifest(getApiUrl());

  if (manifest === null) {
    console.log(JSON.stringify({ signatureValid: false, error: 'Failed to fetch manifest' }));
    process.exitCode = 1;
    return;
  }

  const signatureValid = verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY);

  const categories: Record<string, number> = {};
  for (const key of Object.keys(manifest.prompts)) {
    const category = key.split('/')[0];
    categories[category] = (categories[category] ?? 0) + 1;
  }

  const report = {
    signatureValid,
    promptCount: Object.keys(manifest.prompts).length,
    generatedAt: manifest.generatedAt,
    categories,
  };

  console.log(stripControl(JSON.stringify(report)));

  if (!signatureValid) {
    process.exitCode = 1;
  }
}

/**
 * List prompts from the manifest, optionally filtered by category
 */
async function listPromptsCommand(category?: string): Promise<void> {
  const manifest = await fetchManifest(getApiUrl());

  if (manifest === null) {
    console.log(JSON.stringify([]));
    return;
  }

  if (!verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY)) {
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

/** Raw stdin bytes (no decoding, no trimming), or null once more than OSS_BODY_MAX arrive. */
async function readStdinCapped(): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += (chunk as Buffer).length;
    if (total > OSS_BODY_MAX) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Why the body can't be trusted, or null when it is exactly what the signed manifest says was served. */
async function verifyBodyReason(key: string): Promise<string | null> {
  if (!VERIFIABLE_BODIES.has(key)) return '[SECURITY] --verify-body: key is not a verifiable body';
  const body = await readStdinCapped();
  if (body === null) return `[SECURITY] --verify-body: body is larger than ${OSS_BODY_MAX} bytes`;
  const apiUrl = getApiUrl();
  let manifest: SignedManifest;
  try {
    manifest = await fetchManifestWithRetry(apiUrl);
  } catch {
    return ''; // fetchManifestWithRetry already printed its one line
  }
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
  if (reason !== '') console.error(reason);
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
