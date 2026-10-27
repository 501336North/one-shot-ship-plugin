/**
 * Update state management for tracking plugin/prompt changes across sessions.
 * Stores cached versions, manifest hashes, and prompt signatures.
 */
import { existsSync, readFileSync } from 'fs';
import { writeFileNoFollow } from './safe-write.js';

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

/**
 * Save the update state (writeFileNoFollow, owner-only). Best effort: it only feeds "prompt updated" notices, so a
 * state file that cannot be written safely (e.g. a symlinked directory) is skipped and never blocks prompt delivery.
 */
export function writeUpdateState(filePath: string, state: UpdateState): void {
  try {
    writeFileNoFollow(filePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch {
    // skipped: see above
  }
}
