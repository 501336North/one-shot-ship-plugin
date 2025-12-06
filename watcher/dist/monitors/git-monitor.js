/**
 * Git Monitor - Monitors git operations and CI status
 *
 * Implements AC-004.1 through AC-004.5 from REQUIREMENTS.md
 */
export class GitMonitor {
    queueManager;
    constructor(queueManager) {
        this.queueManager = queueManager;
    }
    /**
     * Analyze CI status
     */
    async analyzeCIStatus(status) {
        return {
            hasFailure: status.status === 'failure',
            isPending: status.status === 'pending',
            details: `Workflow: ${status.workflow}, Branch: ${status.branch}`,
        };
    }
    /**
     * Analyze PR check result
     */
    async analyzePRCheck(check) {
        return {
            hasFailure: !check.passed,
            details: check.errorMessage,
        };
    }
    /**
     * Analyze git push output
     */
    async analyzePushOutput(output) {
        // Check for success indicators
        if (output.includes('->') && !output.includes('error') && !output.includes('failed')) {
            return { hasFailure: false };
        }
        // Check for rejection
        if (output.includes('failed to push some refs') || output.includes('rejected')) {
            return {
                hasFailure: true,
                failureType: 'rejected',
                details: 'Push was rejected - remote has changes not present locally',
            };
        }
        // Check for permission issues
        if (output.includes('Permission denied') || output.includes('Could not read from remote')) {
            return {
                hasFailure: true,
                failureType: 'permission',
                details: 'Permission denied - check SSH keys or access rights',
            };
        }
        // Check for network issues
        if (output.includes('Could not resolve host') || output.includes('Connection refused')) {
            return {
                hasFailure: true,
                failureType: 'network',
                details: 'Network error - check internet connection',
            };
        }
        // Unknown failure
        if (output.includes('error') || output.includes('fatal')) {
            return {
                hasFailure: true,
                failureType: 'unknown',
                details: output.slice(0, 200),
            };
        }
        return { hasFailure: false };
    }
    /**
     * Report CI failure
     */
    async reportCIFailure(status) {
        const task = {
            priority: 'high',
            source: 'git-monitor',
            anomaly_type: 'ci_failure',
            prompt: `CI workflow "${status.workflow}" failed on branch ${status.branch}. Investigate the failure and fix the underlying issue.`,
            suggested_agent: 'deployment-engineer',
            context: {
                branch: status.branch,
                commit: status.commit,
                ci_url: status.url,
            },
        };
        await this.queueManager.addTask(task);
    }
    /**
     * Report PR check failure
     */
    async reportPRCheckFailure(check) {
        const task = {
            priority: 'high',
            source: 'git-monitor',
            anomaly_type: 'pr_check_failed',
            prompt: `PR #${check.prNumber} check "${check.checkName}" failed on branch ${check.branch}. Fix the failing check: ${check.errorMessage || 'Unknown error'}`,
            suggested_agent: 'deployment-engineer',
            context: {
                branch: check.branch,
                pr_number: check.prNumber,
                last_error: check.errorMessage,
            },
        };
        await this.queueManager.addTask(task);
    }
    /**
     * Report push failure
     */
    async reportPushFailure(errorMessage, failureType, branch) {
        let prompt;
        let suggestedAgent = 'deployment-engineer';
        switch (failureType) {
            case 'rejected':
                prompt = `Git push to ${branch} was rejected. Pull remote changes and resolve any conflicts before pushing again.`;
                break;
            case 'permission':
                prompt = `Git push to ${branch} failed due to permission issues. Check SSH keys and repository access rights.`;
                break;
            case 'network':
                prompt = `Git push to ${branch} failed due to network issues. Check internet connection and try again.`;
                break;
            default:
                prompt = `Git push to ${branch} failed: ${errorMessage}. Investigate and resolve the issue.`;
        }
        const task = {
            priority: 'high',
            source: 'git-monitor',
            anomaly_type: 'push_failed',
            prompt,
            suggested_agent: suggestedAgent,
            context: {
                branch,
                log_excerpt: errorMessage.slice(0, 300),
            },
        };
        await this.queueManager.addTask(task);
    }
    /**
     * Parse gh CLI status output
     */
    async parseGHStatus(output) {
        if (!output || !output.trim()) {
            return {
                status: 'unknown',
                workflow: 'Unknown',
                branch: 'unknown',
                commit: 'unknown',
            };
        }
        try {
            const data = JSON.parse(output);
            const state = data.state?.toLowerCase() || 'unknown';
            return {
                status: state === 'failure' ? 'failure' : state === 'success' ? 'success' : state === 'pending' ? 'pending' : 'unknown',
                workflow: data.statuses?.[0]?.context || 'CI',
                branch: data.branch || 'unknown',
                commit: data.sha || 'unknown',
                url: data.statuses?.[0]?.targetUrl,
            };
        }
        catch {
            return {
                status: 'unknown',
                workflow: 'Unknown',
                branch: 'unknown',
                commit: 'unknown',
            };
        }
    }
}
//# sourceMappingURL=git-monitor.js.map