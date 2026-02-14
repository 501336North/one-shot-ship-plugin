/**
 * CLI entry point for OSS Decrypt
 * Parses arguments and routes to appropriate commands
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { VERSION } from './index.js';
import { setupCommand } from './commands/setup.js';
import { decryptCommand } from './commands/decrypt.js';
import { fetchManifest, verifyManifestSignature } from './manifest-verifier.js';

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
const DEFAULT_API_URL = 'https://one-shot-ship-api.onrender.com';

function getApiUrl(): string {
  const configPath = join(homedir(), '.oss', 'config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.apiUrl || DEFAULT_API_URL;
    } catch {
      // Fall through to default
    }
  }
  return DEFAULT_API_URL;
}

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

  console.log(JSON.stringify(report));

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

  let entries = Object.entries(manifest.prompts).map(([key, value]) => ({
    name: key,
    category: key.split('/')[0],
    hash: value.hash,
    size: value.size,
  }));

  if (category) {
    entries = entries.filter((entry) => entry.category === category);
  }

  console.log(JSON.stringify(entries));
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
