export type LedgerErrorCode = 'unsafe_path' | 'ledger_too_large' | 'too_large';
export type LedgerRow = Record<string, unknown>;
export declare class LedgerError extends Error {
    readonly code: LedgerErrorCode;
    constructor(code: LedgerErrorCode, detail?: string);
}
export interface LedgerOptions {
    getuid?: () => number;
}
export interface Ledger {
    readonly dir: string;
    appendRow(relPath: string, row: LedgerRow): void;
    readRows(relPath: string): LedgerRow[];
    lastRow(relPath: string): LedgerRow | null;
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