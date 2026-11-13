export type Phase = 'ideate' | 'plan' | 'build' | 'ship';
export type ReadResult = {
    ok: true;
    bytes: Buffer;
    value: unknown;
} | {
    ok: false;
    error: string;
};
export interface WriteHooks {
    /** Test seam: runs after the temp file is complete and before it is renamed over the target. */
    beforeRename?: (tmp: string) => void;
}
/** Physical git toplevel of cwd (GIT_* env removed, CLAUDE_PROJECT_DIR ignored), or null outside a repo. */
export declare function resolveRepo(cwd: string): string | null;
export declare function writeResult(repo: string, feature: string, phase: Phase, obj: unknown, hooks?: WriteHooks): void;
export declare function readResult(repo: string, feature: string, phase: Phase): ReadResult;
/** A value file the model wrote: regular, not a link, at most 64 KB, written in the last 10 minutes; else null. */
export declare function readValueFile(dir: string, name: string): string | null;
//# sourceMappingURL=store.d.ts.map