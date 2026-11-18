/**
 * Anti-rollback floor for the signed manifest (R-273 D11, ADR-007).
 *
 * `~/.oss/manifest-floor.json` maps apiUrl → the highest manifest version accepted from that API.
 * Only oss-decrypt writes it (temp file in the same directory, then rename). A missing, unreadable,
 * torn or non-object file means the compiled-in floor, never 0. Call this only AFTER the manifest
 * signature has verified.
 */

import { readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getConfigDir } from './config.js';

/** The live manifest's version when this binary was built. */
export const MIN_MANIFEST_VERSION = 1794940034;

export type FloorVerdict = 'accepted' | 'older' | 'invalid';

function floorPath(): string {
  return join(getConfigDir(), 'manifest-floor.json');
}

function readFloors(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(floorPath(), 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // missing or torn: the compiled floor applies
  }
  return {};
}

function floorFrom(floors: Record<string, unknown>, apiUrl: string): number {
  const stored = Object.hasOwn(floors, apiUrl) ? floors[apiUrl] : undefined;
  return Number.isSafeInteger(stored) ? Math.max(MIN_MANIFEST_VERSION, stored as number) : MIN_MANIFEST_VERSION;
}

/** The highest manifest version accepted from `apiUrl` (at least MIN_MANIFEST_VERSION). */
export function readManifestFloor(apiUrl: string): number {
  return floorFrom(readFloors(), apiUrl);
}

/**
 * Check a signature-verified manifest version against the floor for `apiUrl`, and raise the floor
 * when the version is newer. Writes only when the floor changes.
 */
export function checkAndRecordManifestVersion(apiUrl: string, version: unknown): FloorVerdict {
  if (!Number.isSafeInteger(version)) return 'invalid';
  const v = version as number;
  const floors = readFloors();
  const floor = floorFrom(floors, apiUrl);
  if (v < floor) return 'older';
  if (v > floor) {
    const tmp = `${floorPath()}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...floors, [apiUrl]: v }), { mode: 0o600 });
    renameSync(tmp, floorPath());
  }
  return 'accepted';
}
