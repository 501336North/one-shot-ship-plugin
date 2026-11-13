import type { CheckResult } from '../types.js';
export interface ArchiveCheckOptions {
    devActivePath: string;
}
/**
 * @behavior Verify shipped features are being archived properly
 * @acceptance-criteria A feature whose ship phase result passes the archive rule (phase-results/archivable.ts:
 *   valid, bound, verified, ready_to_merge) should be moved to dev/completed/. PROGRESS.md prose never decides
 *   (R-257 AC-006.1).
 * @boundary Healthcheck
 */
export declare function checkArchive(options: ArchiveCheckOptions): Promise<CheckResult>;
//# sourceMappingURL=archive.d.ts.map