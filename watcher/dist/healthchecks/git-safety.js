import { execAsync } from '../utils/exec.js';
/**
 * Check git safety: verify agents never push directly to main (IRON LAW #4)
 */
export async function checkGitSafety() {
    try {
        // 1. Check current branch
        const { stdout: currentBranch } = await execAsync('git branch --show-current');
        const branch = currentBranch.trim() || '(detached HEAD)';
        const isProtectedBranch = branch === 'main' || branch === 'master';
        // 2. Check for agent commits on main
        const { stdout: agentCommitsOutput } = await execAsync('git log main --grep="Co-Authored-By: Claude" --oneline');
        let lastAgentMainCommit;
        if (agentCommitsOutput.trim()) {
            // Agent committed directly to main - this is a FAIL
            const firstLine = agentCommitsOutput.trim().split('\n')[0];
            const hash = firstLine.split(' ')[0];
            // Get commit details
            const { stdout: commitDetails } = await execAsync(`git log ${hash} -1 --format="%H|%ci|%s"`);
            const [fullHash, date, message] = commitDetails.trim().split('|');
            lastAgentMainCommit = {
                hash,
                date,
                message,
            };
        }
        // 3. Get last PR merge date
        const { stdout: lastMergeOutput } = await execAsync('git log main -1 --format=%ci');
        const lastPRMerge = lastMergeOutput.trim();
        const daysSinceLastMerge = Math.floor((Date.now() - new Date(lastPRMerge).getTime()) / (1000 * 60 * 60 * 24));
        // Build details
        const details = {
            currentBranch: branch,
            onProtectedBranch: isProtectedBranch,
            daysSinceAgentMain: lastAgentMainCommit ? 'detected' : 'never',
            lastPRMerge,
            daysSinceLastMerge,
        };
        if (lastAgentMainCommit) {
            details.lastAgentMainCommit = lastAgentMainCommit;
        }
        // Determine status
        if (lastAgentMainCommit) {
            return {
                status: 'fail',
                message: `IRON LAW #4 VIOLATED: Agent committed directly to main (${lastAgentMainCommit.hash})`,
                details,
            };
        }
        if (isProtectedBranch) {
            return {
                status: 'warn',
                message: 'Currently on protected branch (main/master) - create feature branch',
                details,
            };
        }
        if (branch === '(detached HEAD)') {
            return {
                status: 'warn',
                message: 'Detached HEAD state detected - checkout a feature branch',
                details,
            };
        }
        return {
            status: 'pass',
            message: 'Git safety check passed - using feature branches correctly',
            details,
        };
    }
    catch (error) {
        return {
            status: 'fail',
            message: `Failed to check git safety: ${error instanceof Error ? error.message : String(error)}`,
            details: {
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
//# sourceMappingURL=git-safety.js.map