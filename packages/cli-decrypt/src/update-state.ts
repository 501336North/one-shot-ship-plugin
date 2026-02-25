/**
 * Update state management for tracking plugin/prompt changes across sessions.
 * Stores cached versions, manifest hashes, and prompt signatures.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface UpdateState {
  lastPluginVersion: string;
  lastCheckedAt: string;
  manifestVersion: number;
  manifestHashes: Record<string, string>;
  promptSignatures: Record<string, string>;
}

function defaultState(): UpdateState {
  return {
    lastPluginVersion: '',
    lastCheckedAt: '',
    manifestVersion: 0,
    manifestHashes: {},
    promptSignatures: {},
  };
}

export function readUpdateState(filePath: string): UpdateState {
  if (!existsSync(filePath)) {
    return defaultState();
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    return {
      lastPluginVersion: parsed.lastPluginVersion ?? '',
      lastCheckedAt: parsed.lastCheckedAt ?? '',
      manifestVersion: parsed.manifestVersion ?? 0,
      manifestHashes: parsed.manifestHashes ?? {},
      promptSignatures: parsed.promptSignatures ?? {},
    };
  } catch {
    return defaultState();
  }
}

export function writeUpdateState(filePath: string, state: UpdateState): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}
