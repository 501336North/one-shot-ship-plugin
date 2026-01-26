#!/usr/bin/env node
/**
 * OSS Decrypt CLI Entry Point
 * Usage: oss-decrypt --setup | --type <type> --name <name>
 */

import { runCli } from './cli-entry.js';

// Run CLI with process arguments (skip node and script path)
runCli(process.argv.slice(2)).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
