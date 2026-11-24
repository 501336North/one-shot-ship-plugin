export type LedgerErrorCode = 'unsafe_path' | 'ledger_too_large' | 'too_large';
export type LedgerRow = Record<string, unknown>;
export declare class LedgerError extends Error {
    readonly code: LedgerErrorCode;
    constructor(code: LedgerErrorCode, detail?: string);
}
/**
 * A `run/<phase>` row, written by `oss-notify start` (`_oss_ledger_run`): when the run started, the Claude session
 * that started it, HEAD then, and the feature resolved for the repo and branch then ("" when none).
 */
export interface RunRow {
    startedAt: string;
    session: string;
    headSha: string;
    feature: string;
}
/** A run row with every field a string; null otherwise (a row from before `feature` was recorded, for one). */
export declare function parseRunRow(row: LedgerRow | null): RunRow | null;
export interface LedgerOptions {
    getuid?: () => number;
}
export interface Ledger {
    readonly dir: string;
    appendRow(relPath: string, row: LedgerRow): void;
    readRows(relPath: string): LedgerRow[];
    lastRow(relPath: string): LedgerRow | null;
    /**
     * Visits the rows newest to oldest, reading the file backwards in chunks; stops when visit returns false or at the
     * file's start. Torn lines are skipped. Reads at most the file's cap from its end (older rows are not visited), so
     * an oversized file never throws here, as with lastRow.
     */
    scanBack(relPath: string, visit: (row: LedgerRow) => boolean): void;
    writeMarker(relPath: string, obj: LedgerRow): void;
    readMarker(relPath: string): LedgerRow | null;
    clearMarker(relPath: string): void;
    hasMarker(relPath: string): boolean;
}
/** First 16 hex of the git blob sha1 of "<toplevel>\n<absolute-git-dir>\n"; null outside a repo. */
export declare function ledgerKey(cwd: string): string | null;
/** Throws unsafe_path when cwd is not inside a git repo (no key to bind to). */
export declare function openLedger(cwd: string, opts?: LedgerOptions): Ledger;
//# sourceMappingURL=ledger.d.ts.map