import type { GitReader } from './git-reader.js';

export type { GitReader };

export type GateMode = 'pre' | 'post';

export interface GateRequest {
  mode: GateMode;
  input: string;
  env: { HOME: string; CLAUDE_PLUGIN_ROOT: string };
}

export interface GateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface GateDeps {
  gitReader?: GitReader;
}

export async function runToolGate(req: GateRequest, deps: GateDeps = {}): Promise<GateResult> {
  throw new Error('not implemented');
}
