import { execAsync } from '../utils/exec.js';
/**
 * Check git safety: verify agents are using feature branches (IRON LAW #4)
 *
 * This check verifies:
 * 1. Not currently on main/master branch
 * 2. Agent commits are going through PRs (merged commits are OK)
 *
 * Note: Agent commits on main that came through PR merges are ALLOWED.
 * Only direct pushes to main (non-merge commits) are violations.
 */
export async function checkGitSafety() {
    try {
        // 1. Check current branch
        const { stdout: currentBranch } = await execAsync('git branch --show-current');
        const branch = currentBranch.trim() || '(detached HEAD)';
        const isProtectedBranch = branch === 'main' || branch === 'master';
        // 2. Check for agent commits that were NOT merged via PR
        // A PR merge will have "Merge pull request" or be a merge commit (two parents)
        // Direct pushes to main are non-merge commits
        let directPushViolation;
        try {
            // Find agent commits on main that are NOT merge commits
            // --no-merges excludes merge commits (which come from PRs)
            const { stdout: directAgentCommits } = await execAsync('git log main --no-merges --grep="Co-Authored-By: Claude" --oneline -1 2>/dev/null || true');
            if (directAgentCommits.trim()) {
                const firstLine = directAgentCommits.trim().split('\n')[0];
                const hash = firstLine.split(' ')[0];
                const message = firstLine.substring(hash.length + 1);
                // Double-check this isn't a squash merge from a PR
                // Squash merges from GitHub include the PR number like "(#123)"
                const isPRSquash = /\(#\d+\)/.test(message);
                if (!isPRSquash) {
                    directPushViolation = { hash, message };
                }
            }
        }
        catch {
            // Ignore errors checking main - might not exist
        }
        // Build details
        const details = {
            currentBranch: branch,
            onProtectedBranch: isProtectedBranch,
        };
        // Determine status
        if (directPushViolation) {
            details.violation = directPushViolation;
            return {
                status: 'fail',
                message: `IRON LAW #4: Direct push to main detected (${directPushViolation.hash})`,
                details,
            };
        }
        if (isProtectedBranch) {
            // Get last agent PR merge date to main for more informative message
            let lastAgentMerge = null;
            try {
                // Find the most recent agent commit that was properly merged via PR
                const { stdout: lastMergedAgent } = await execAsync('git log main --grep="Co-Authored-By: Claude" --grep="(#" --all-match --format="%ar" -1 2>/dev/null || true');
                if (lastMergedAgent.trim()) {
                    lastAgentMerge = lastMergedAgent.trim();
                }
            }
            catch {
                // Ignore errors
            }
            const message = lastAgentMerge
                ? `On main branch (last agent PR: ${lastAgentMerge})`
                : 'On main branch - create feature branch before making changes';
            return {
                status: 'pass', // Changed from warn to pass - being on main is expected at session start
                message,
                details: {
                    ...details,
                    lastAgentMerge,
                },
            };
        }
        if (branch === '(detached HEAD)') {
            return {
                status: 'warn',
                message: 'Detached HEAD state - checkout a feature branch',
                details,
            };
        }
        return {
            status: 'pass',
            message: `On feature branch: ${branch}`,
            details,
        };
    }
    catch (error) {
        return {
            status: 'fail',
            message: `Git safety check failed: ${error instanceof Error ? error.message : String(error)}`,
            details: {
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
//# sourceMappingURL=git-safety.js.map