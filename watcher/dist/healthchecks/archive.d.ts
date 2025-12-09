import type { CheckResult } from '../types.js';
export interface ArchiveCheckOptions {
    devActivePath: string;
}
/**
 * @behavior Verify shipped features are being archived properly
 * @acceptance-criteria Features in "ship" or "complete" phase should be moved to dev/completed/
 * @boundary Healthcheck
 */
export declare function checkArchive(options: ArchiveCheckOptions): Promise<CheckResult>;
//# sourceMappingURL=archive.d.ts.map