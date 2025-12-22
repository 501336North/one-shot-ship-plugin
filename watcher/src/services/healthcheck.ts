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

import { HealthReport, CheckResult, OverallStatus } from '../types.js';
import { checkLogging as checkSessionLogging } from '../healthchecks/logging.js';
import { checkDevDocs as checkFeatureDevDocs } from '../healthchecks/dev-docs.js';
import { checkDelegation as checkAgentDelegation } from '../healthchecks/delegation.js';
import { checkArchive as checkFeatureArchive } from '../healthchecks/archive.js';
import { checkGitSafety as checkGitSafetyImpl } from '../healthchecks/git-safety.js';
import { WorkflowStateService } from './workflow-state.js';
import { execSync } from 'child_process';

/** Task with status for queue checks */
interface QueueTask {
  status: string;
}

/** Queue manager interface for healthcheck dependency injection */
interface QueueManagerInterface {
  getTasks(): Promise<QueueTask[]>;
}

/** Log reader interface (reserved for future use) */
interface LogReaderInterface {
  read?(): Promise<string[]>;
}

/** File system interface (reserved for future use) */
interface FileSystemInterface {
  exists?(path: string): boolean;
  read?(path: string): string;
}

interface HealthcheckDependencies {
  logReader?: LogReaderInterface | null;
  queueManager?: QueueManagerInterface | null;
  fileSystem?: FileSystemInterface | null;
  sessionLogPath?: string;
  sessionActive?: boolean;
  featurePath?: string;
  devActivePath?: string;
  workflowState?: WorkflowStateService;
}

export class HealthcheckService {
  private logReader?: LogReaderInterface | null;
  private queueManager?: QueueManagerInterface | null;
  private fileSystem?: FileSystemInterface | null;
  private sessionLogPath: string;
  private sessionActive: boolean;
  private featurePath: string;
  private devActivePath: string;
  private workflowState?: WorkflowStateService;

  constructor(deps: HealthcheckDependencies) {
    this.logReader = deps.logReader;
    this.queueManager = deps.queueManager;
    this.fileSystem = deps.fileSystem;
    this.sessionLogPath = deps.sessionLogPath || '/tmp/oss/session.log';
    this.sessionActive = deps.sessionActive || false;
    this.featurePath = deps.featurePath || '';
    this.devActivePath = deps.devActivePath || 'dev/active';
    this.workflowState = deps.workflowState;
  }

  /**
   * Run all 8 checks and return aggregated report
   */
  async runChecks(): Promise<HealthReport> {
    // Execute all 8 checks in parallel
    const [
      logging,
      devDocs,
      delegation,
      queue,
      archive,
      qualityGates,
      notifications,
      gitSafety,
    ] = await Promise.all([
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

    const report: HealthReport = {
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
  private async checkLogging(): Promise<CheckResult> {
    return checkSessionLogging({
      sessionLogPath: this.sessionLogPath,
      sessionActive: this.sessionActive,
    });
  }

  /**
   * Check 2: Dev Docs - Progress tracked in dev/active
   * Uses real implementation from healthchecks/dev-docs.ts
   */
  private async checkDevDocs(): Promise<CheckResult> {
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
  private async checkDelegation(): Promise<CheckResult> {
    return checkAgentDelegation({
      sessionLogPath: this.sessionLogPath,
      sessionActive: this.sessionActive,
    });
  }

  /**
   * Check 4: Queue - Tasks processed correctly
   */
  private async checkQueue(): Promise<CheckResult> {
    try {
      // QueueManager may not be provided in all contexts
      if (!this.queueManager || typeof this.queueManager.getTasks !== 'function') {
        return {
          status: 'pass',
          message: 'Queue check skipped (no queue manager)',
        };
      }

      const tasks = await this.queueManager.getTasks();
      const pendingCount = tasks.filter((t) => t.status === 'pending').length;

      return {
        status: 'pass',
        message: `Queue operational (${pendingCount} pending)`,
        details: { taskCount: tasks.length, pendingCount },
      };
    } catch (error) {
      return {
        status: 'fail',
        message: `Queue check failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Check 5: Archive - Completed features archived
   * Uses real implementation from healthchecks/archive.ts
   *
   * Only warns if workflow state indicates archiving should have happened:
   * - Last step is 'plan' AND >24h since completion
   * - If last step is 'ship', archiving is expected on next plan (no warning)
   */
  private async checkArchive(): Promise<CheckResult> {
    // If workflow state says we shouldn't warn, return pass early
    if (this.workflowState) {
      const shouldWarn = await this.workflowState.shouldWarnAboutArchive();
      if (!shouldWarn) {
        return {
          status: 'pass',
          message: 'Archive check skipped (workflow state indicates archiving not expected yet)',
          details: {
            reason: 'Workflow state indicates ship just completed or plan not yet stale',
          },
        };
      }
    }

    return checkFeatureArchive({
      devActivePath: this.devActivePath,
    });
  }

  /**
   * Check 6: Quality Gates - TDD enforced
   */
  private async checkQualityGates(): Promise<CheckResult> {
    // Placeholder implementation (will be implemented in Task 2.6)
    return {
      status: 'pass',
      message: 'Quality gates check placeholder',
    };
  }

  /**
   * Check 7: Notifications - User notified appropriately
   */
  private async checkNotifications(): Promise<CheckResult> {
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
  private async checkGitSafety(): Promise<CheckResult> {
    return checkGitSafetyImpl();
  }

  /**
   * Aggregate individual check statuses into overall status
   * Priority: critical > warning > healthy
   */
  private aggregateStatus(checks: Record<string, CheckResult>): OverallStatus {
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
  private logHealthCheckResults(report: HealthReport): void {
    try {
      const ossLogPath = this.getOssLogPath();
      const checkStatuses = this.extractCheckStatuses(report.checks);
      const detailsJson = this.escapeJsonForShell(checkStatuses);
      const cmd = `${ossLogPath} health ${report.overall_status} "${detailsJson}"`;

      execSync(cmd);
    } catch (error) {
      // Log errors but don't fail the health check
      console.error('Failed to log health check results:', (error as Error).message);
    }
  }

  /**
   * Get path to oss-log.sh script
   */
  private getOssLogPath(): string {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ||
                      `${process.env.HOME}/.claude/plugins/cache/one-shot-ship-plugin`;
    return `${pluginRoot}/hooks/oss-log.sh`;
  }

  /**
   * Extract check statuses from full check results
   */
  private extractCheckStatuses(checks: Record<string, CheckResult>): Record<string, string> {
    return Object.entries(checks).reduce((acc, [key, check]) => {
      acc[key] = check.status;
      return acc;
    }, {} as Record<string, string>);
  }

  /**
   * Escape JSON string for safe use in shell command
   */
  private escapeJsonForShell(data: Record<string, string>): string {
    return JSON.stringify(data).replace(/"/g, '\\"');
  }
}
