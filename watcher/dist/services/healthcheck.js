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
import { checkLogging as checkSessionLogging } from '../healthchecks/logging.js';
import { checkDevDocs as checkFeatureDevDocs } from '../healthchecks/dev-docs.js';
import { checkDelegation as checkAgentDelegation } from '../healthchecks/delegation.js';
import { checkArchive as checkFeatureArchive } from '../healthchecks/archive.js';
import { checkGitSafety as checkGitSafetyImpl } from '../healthchecks/git-safety.js';
import { execSync } from 'child_process';
export class HealthcheckService {
    logReader;
    queueManager;
    fileSystem;
    sessionLogPath;
    sessionActive;
    featurePath;
    devActivePath;
    constructor(deps) {
        this.logReader = deps.logReader;
        this.queueManager = deps.queueManager;
        this.fileSystem = deps.fileSystem;
        this.sessionLogPath = deps.sessionLogPath || '/tmp/oss/session.log';
        this.sessionActive = deps.sessionActive || false;
        this.featurePath = deps.featurePath || '';
        this.devActivePath = deps.devActivePath || 'dev/active';
    }
    /**
     * Run all 8 checks and return aggregated report
     */
    async runChecks() {
        // Execute all 8 checks in parallel
        const [logging, devDocs, delegation, queue, archive, qualityGates, notifications, gitSafety,] = await Promise.all([
            this.checkLogging(),
            this.checkDevDocs(),
            this.checkDelegation(),
            this.checkQueue(),
            this.checkArchive(),
            this.checkQualityGates(),
            this.checkNotifications(),
            this.checkGitSafety(),
        ]);
        // Build checks object
        const checks = {
            logging,
            dev_docs: devDocs,
            delegation,
            queue,
            archive,
            quality_gates: qualityGates,
            notifications,
            git_safety: gitSafety,
        };
        // Determine overall status
        const overall_status = this.aggregateStatus(checks);
        const report = {
            timestamp: new Date().toISOString(),
            overall_status,
            checks,
        };
        // Log health check results via oss-log.sh
        this.logHealthCheckResults(report);
        return report;
    }
    /**
     * Check 1: Logging - Workflow events are logged
     * Uses real implementation from healthchecks/logging.ts
     */
    async checkLogging() {
        return checkSessionLogging({
            sessionLogPath: this.sessionLogPath,
            sessionActive: this.sessionActive,
        });
    }
    /**
     * Check 2: Dev Docs - Progress tracked in dev/active
     * Uses real implementation from healthchecks/dev-docs.ts
     */
    async checkDevDocs() {
        if (!this.featurePath) {
            return {
                status: 'pass',
                message: 'No active feature to check',
            };
        }
        return checkFeatureDevDocs({
            featurePath: this.featurePath,
            sessionActive: this.sessionActive,
        });
    }
    /**
     * Check 3: Delegation - Agents used for specialized work
     * Uses real implementation from healthchecks/delegation.ts
     */
    async checkDelegation() {
        return checkAgentDelegation({
            sessionLogPath: this.sessionLogPath,
            sessionActive: this.sessionActive,
        });
    }
    /**
     * Check 4: Queue - Tasks processed correctly
     */
    async checkQueue() {
        try {
            const queue = await this.queueManager.getQueue();
            return {
                status: 'pass',
                message: 'Queue is operational',
                details: { taskCount: queue.tasks.length },
            };
        }
        catch (error) {
            return {
                status: 'fail',
                message: `Queue check failed: ${error.message}`,
            };
        }
    }
    /**
     * Check 5: Archive - Completed features archived
     * Uses real implementation from healthchecks/archive.ts
     */
    async checkArchive() {
        return checkFeatureArchive({
            devActivePath: this.devActivePath,
        });
    }
    /**
     * Check 6: Quality Gates - TDD enforced
     */
    async checkQualityGates() {
        // Placeholder implementation (will be implemented in Task 2.6)
        return {
            status: 'pass',
            message: 'Quality gates check placeholder',
        };
    }
    /**
     * Check 7: Notifications - User notified appropriately
     */
    async checkNotifications() {
        // Placeholder implementation (will be implemented in Task 2.7)
        return {
            status: 'pass',
            message: 'Notifications check placeholder',
        };
    }
    /**
     * Check 8: Git Safety - Branch verification active
     * Uses real implementation from healthchecks/git-safety.ts
     */
    async checkGitSafety() {
        return checkGitSafetyImpl();
    }
    /**
     * Aggregate individual check statuses into overall status
     * Priority: critical > warning > healthy
     */
    aggregateStatus(checks) {
        const statuses = Object.values(checks).map((check) => check.status);
        // If any check failed, overall is critical
        if (statuses.includes('fail')) {
            return 'critical';
        }
        // If any check has warning, overall is warning
        if (statuses.includes('warn')) {
            return 'warning';
        }
        // All checks passed
        return 'healthy';
    }
    /**
     * Log health check results to session log via oss-log.sh
     */
    logHealthCheckResults(report) {
        try {
            const ossLogPath = this.getOssLogPath();
            const checkStatuses = this.extractCheckStatuses(report.checks);
            const detailsJson = this.escapeJsonForShell(checkStatuses);
            const cmd = `${ossLogPath} health ${report.overall_status} "${detailsJson}"`;
            execSync(cmd);
        }
        catch (error) {
            // Log errors but don't fail the health check
            console.error('Failed to log health check results:', error.message);
        }
    }
    /**
     * Get path to oss-log.sh script
     */
    getOssLogPath() {
        const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ||
            `${process.env.HOME}/.claude/plugins/cache/one-shot-ship-plugin`;
        return `${pluginRoot}/hooks/oss-log.sh`;
    }
    /**
     * Extract check statuses from full check results
     */
    extractCheckStatuses(checks) {
        return Object.entries(checks).reduce((acc, [key, check]) => {
            acc[key] = check.status;
            return acc;
        }, {});
    }
    /**
     * Escape JSON string for safe use in shell command
     */
    escapeJsonForShell(data) {
        return JSON.stringify(data).replace(/"/g, '\\"');
    }
}
//# sourceMappingURL=healthcheck.js.map