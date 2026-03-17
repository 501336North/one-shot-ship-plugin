#!/usr/bin/env node
/**
 * OSS Decrypt CLI Entry Point
 * Usage: oss-decrypt --setup | --type <type> --name <name>
 */

// Suppress Node 18 ExperimentalWarning for fetch API
const originalEmit = process.emit.bind(process);
process.emit = function (event: string, ...args: unknown[]) {
  if (event === 'warning' && typeof args[0] === 'object' && args[0] !== null && (args[0] as { name?: string }).name === 'ExperimentalWarning') {
    return false;
  }
  return originalEmit(event, ...args);
} as typeof process.emit;

import { runCli } from './cli-entry.js';

// Run CLI with process arguments (skip node and script path)
runCli(process.argv.slice(2)).catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
