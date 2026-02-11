/**
 * CLI entry point for OSS Decrypt
 * Parses arguments and routes to appropriate commands
 */

import { VERSION } from './index.js';
import { setupCommand } from './commands/setup.js';
import { decryptCommand } from './commands/decrypt.js';

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

Options:
  --setup              Run initial setup (fetch credentials)
  --type, -t <type>    Prompt type: commands, workflows, skills, agents, hooks, custom
  --name, -n <name>    Prompt name
  --debug, -d          Enable verbose debug output
  --no-cache           Bypass cache, always fetch from API
  --clear-cache        Clear all cached prompts
  --help, -h           Show this help
  --version, -v        Show version

Examples:
  oss-decrypt --setup
  oss-decrypt --type commands --name plan
  oss-decrypt --type workflows --name build
  oss-decrypt --debug --type commands --name plan
  oss-decrypt --no-cache --type commands --name plan
  oss-decrypt --clear-cache
`);
}

/**
 * Show version
 */
function showVersion(): void {
  console.log(`oss-decrypt v${VERSION}`);
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
