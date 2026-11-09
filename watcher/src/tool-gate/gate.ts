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

export interface GitReader {
  currentBranch(dir: string): string | null;
}

export interface GateDeps {
  gitReader?: GitReader;
}

export async function runToolGate(req: GateRequest, deps: GateDeps = {}): Promise<GateResult> {
  throw new Error('not implemented');
}
