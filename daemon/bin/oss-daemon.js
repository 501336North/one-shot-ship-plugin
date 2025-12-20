#!/usr/bin/env node

/**
 * OSS Daemon CLI Entry Point
 */

import * as path from 'path';
import * as os from 'os';
import { DaemonCli } from '../dist/cli.js';

const ossDir = process.env.OSS_DIR || path.join(os.homedir(), '.oss');
const cli = new DaemonCli({ ossDir });

const args = process.argv.slice(2);
cli.execute(args).then(result => {
  console.log(result.output);
  process.exit(result.exitCode);
}).catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
