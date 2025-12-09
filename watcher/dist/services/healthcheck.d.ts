/**
 * HealthcheckService - Supervisor Healthcheck System
 *
 * Runs 8 checks to verify workflow correctness:
 * 1. Logging - Workflow events are logged
 * 2. Dev Docs - Progress tracked in dev/active
 * 3. Delegation - Agents used for specialized work
 * 4. Queue - Tasks processed correctly
 * 5. Archive - Completed features archived
 * 6. Quality Gates - TDD enforced
 * 7. Notifications - User notified appropriately
 * 8. Git Safety - Branch verification active
 */
import { HealthReport } from '../types.js';
interface HealthcheckDependencies {
    logReader: any;
    queueManager: any;
    fileSystem: any;
    sessionLogPath?: string;
    sessionActive?: boolean;
    featurePath?: string;
    devActivePath?: string;
}
export declare class HealthcheckService {
    private logReader;
    private queueManager;
    private fileSystem;
    private sessionLogPath;
    private sessionActive;
    private featurePath;
    private devActivePath;
    constructor(deps: HealthcheckDependencies);
    /**
     * Run all 8 checks and return aggregated report
     */
    runChecks(): Promise<HealthReport>;
    /**
     * Check 1: Logging - Workflow events are logged
     * Uses real implementation from healthchecks/logging.ts
     */
    private checkLogging;
    /**
     * Check 2: Dev Docs - Progress tracked in dev/active
     * Uses real implementation from healthchecks/dev-docs.ts
     */
    private checkDevDocs;
    /**
     * Check 3: Delegation - Agents used for specialized work
     * Uses real implementation from healthchecks/delegation.ts
     */
    private checkDelegation;
    /**
     * Check 4: Queue - Tasks processed correctly
     */
    private checkQueue;
    /**
     * Check 5: Archive - Completed features archived
     * Uses real implementation from healthchecks/archive.ts
     */
    private checkArchive;
    /**
     * Check 6: Quality Gates - TDD enforced
     */
    private checkQualityGates;
    /**
     * Check 7: Notifications - User notified appropriately
     */
    private checkNotifications;
    /**
     * Check 8: Git Safety - Branch verification active
     * Uses real implementation from healthchecks/git-safety.ts
     */
    private checkGitSafety;
    /**
     * Aggregate individual check statuses into overall status
     * Priority: critical > warning > healthy
     */
    private aggregateStatus;
    /**
     * Log health check results to session log via oss-log.sh
     */
    private logHealthCheckResults;
    /**
     * Get path to oss-log.sh script
     */
    private getOssLogPath;
    /**
     * Extract check statuses from full check results
     */
    private extractCheckStatuses;
    /**
     * Escape JSON string for safe use in shell command
     */
    private escapeJsonForShell;
}
export {};
//# sourceMappingURL=healthcheck.d.ts.map