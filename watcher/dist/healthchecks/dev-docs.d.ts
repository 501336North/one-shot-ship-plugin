/**
 * Dev Docs Health Check
 *
 * Verifies dev docs are being updated:
 * - PROGRESS.md freshness (<1 hour during active work)
 * - Required docs exist (PLAN.md, PROGRESS.md)
 * - Optional docs tracked (DESIGN.md, TESTING.md)
 */
import { CheckResult } from '../types.js';
interface DevDocsCheckOptions {
    featurePath: string;
    sessionActive?: boolean;
}
/**
 * Check dev docs health for a feature
 */
export declare function checkDevDocs(options: DevDocsCheckOptions): Promise<CheckResult>;
export {};
//# sourceMappingURL=dev-docs.d.ts.map