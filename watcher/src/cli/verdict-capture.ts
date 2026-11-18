#!/usr/bin/env node
/**
 * verdict-capture CLI (R-257 T19): run by hooks/oss-verdict-capture.sh at SubagentStop as the bundle
 * dist/cli/verdict-capture.cjs, on the recorded node (D21).
 *
 * Usage: verdict-capture <input-file>
 *   <input-file> holds Claude Code's SubagentStop hook input (the hook writes it to a private temp folder). At most
 *   INPUT_CAP bytes are read. The review agent's verdict block is recorded by captureVerdict
 *   (phase-results/verdict-capture.ts). Always exits 0 and prints nothing: a capture failure never changes a stop.
 */
import * as fs from 'node:fs';
import { captureVerdict } from '../phase-results/verdict-capture.js';

const INPUT_CAP = 1024 * 1024;

function readInput(file: string | undefined): unknown {
  if (file === undefined) return null;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > INPUT_CAP) return null;
    return JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown;
  } finally {
    fs.closeSync(fd);
  }
}

try {
  captureVerdict(readInput(process.argv[2]));
} catch {
  // Unreadable or malformed input records nothing.
}
process.exitCode = 0;
