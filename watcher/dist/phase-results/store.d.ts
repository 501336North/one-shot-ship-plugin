import { type Phase } from './schemas.js';
export type ReadResult = {
    ok: true;
    bytes: Buffer;
    value: unknown;
    dev: number;
    ino: number;
} | {
    ok: false;
    error: string;
};
/** What writeResult created: the file's device and inode, and the exact bytes written. */
export interface Written {
    dev: number;
    ino: number;
    bytes: Buffer;
}
/**
 * D84: the feature folder a result lives in, under `.oss/dev/`: `active/<feature>` (the default), or, for a ship re-run
 * after the archive commit, the `completed/<feature>-<date>` folder this branch added.
 */
export interface FeatureDir {
    kind: 'active' | 'completed';
    name: string;
}
export interface WriteHooks {
    /** Test seam: runs after the temp file is complete and before it is renamed over the target. */
    beforeRename?: (tmp: string) => void;
}
/**
 * Physical git toplevel of cwd (GIT_* env removed, CLAUDE_PROJECT_DIR ignored), or null outside a repo. git is the
 * fixed-path binary (gitBin, never PATH; pen N3) run with PATH=/usr/bin:/bin; no git binary gives null.
 */
export declare function resolveRepo(cwd: string): string | null;
export declare function writeResult(repo: string, feature: string, phase: Phase, obj: unknown, hooks?: WriteHooks, where?: FeatureDir): Written;
/**
 * Reads results/<phase>.json back after writeResult (round 2 race): ok only when it is still the very file written
 * (same device and inode) and holds exactly the written bytes; `result_changed` otherwise. The caller binds
 * `written.bytes`, never what a reader saw.
 */
export declare function readBack(repo: string, feature: string, phase: Phase, written: Written, where?: FeatureDir): ReadResult;
/** Removes results/<phase>.unverified.json (the Stop hook's repo marker) under the checked results/ dir; no-op if absent. */
export declare function clearUnverifiedMarker(repo: string, feature: string, phase: Phase, where?: FeatureDir): void;
export declare function readResult(repo: string, feature: string, phase: Phase, where?: FeatureDir): ReadResult;
/** A value file the model wrote: regular, not a link, at most 64 KB, written in the last 10 minutes; else null. */
export declare function readValueFile(dir: string, name: string): string | null;
//# sourceMappingURL=store.d.ts.map