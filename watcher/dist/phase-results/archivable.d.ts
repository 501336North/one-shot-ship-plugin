export type ArchiveVerdict = {
    ok: true;
} | {
    ok: false;
    reason: string;
};
/** Throws LedgerError or a store error (`bad_feature: ...`) for the caller to report. */
export declare function shipArchivable(repo: string, feature: string, pluginRoot: string): ArchiveVerdict;
//# sourceMappingURL=archivable.d.ts.map