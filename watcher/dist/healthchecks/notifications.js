import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { join } from 'path';
const execAsync = promisify(exec);
const RECENT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
/**
 * Check status line health (replaces terminal-notifier check)
 * The status line is now the primary notification mechanism in Claude Code
 */
export async function checkNotifications(options) {
    const { logPath, sessionActive = false, testStatusLine = false, projectDir } = options;
    const home = homedir();
    const statusLineScript = join(home, '.oss', 'oss-statusline.sh');
    // Check if status line script exists
    let statusLineAvailable = false;
    let statusLinePath = null;
    try {
        await fs.access(statusLineScript);
        statusLineAvailable = true;
        statusLinePath = statusLineScript;
    }
    catch {
        // Status line script not found - check if workflow state can still be written
        // Status line may be configured differently
    }
    // Check if workflow state file is writable
    let workflowStateWritable = false;
    const projectOssDir = projectDir ? join(projectDir, '.oss') : null;
    const globalWorkflowState = join(home, '.oss', 'workflow-state.json');
    const projectWorkflowState = projectOssDir ? join(projectOssDir, 'workflow-state.json') : null;
    try {
        // Try project-local first, then global
        const workflowStatePath = projectWorkflowState || globalWorkflowState;
        // Check if parent directory exists and is writable
        const parentDir = projectOssDir || join(home, '.oss');
        await fs.access(parentDir);
        workflowStateWritable = true;
    }
    catch {
        // Directory doesn't exist or isn't writable
    }
    // Test status line output if requested
    let statusLineOutput = null;
    if (testStatusLine && statusLineAvailable && statusLinePath) {
        try {
            const { stdout } = await execAsync(`echo '{}' | bash "${statusLinePath}"`);
            statusLineOutput = stdout.trim();
        }
        catch {
            // Status line execution failed but don't fail the check
        }
    }
    // Read last workflow state updates from log
    let lastStateUpdateAge = null;
    try {
        const content = await fs.readFile(logPath, 'utf-8');
        const lines = content.trim().split('\n');
        // Parse log entries for workflow state updates (new format)
        // or NOTIFICATION events (legacy format)
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            // Match new workflow log format: [timestamp] [command] [event]
            const workflowMatch = line.match(/^\[([^\]]+)\] \[(\w+)\] \[(\w+)\]/);
            // Also match legacy format: [timestamp] NOTIFICATION sent
            const legacyMatch = line.match(/^\[([^\]]+)\] NOTIFICATION sent/);
            const match = workflowMatch || legacyMatch;
            if (match) {
                const timestamp = new Date(match[1]);
                lastStateUpdateAge = Date.now() - timestamp.getTime();
                break;
            }
        }
    }
    catch (error) {
        // Log read error
        return {
            status: 'warn',
            message: 'Could not read workflow logs',
            details: {
                statusLineAvailable,
                statusLinePath,
                workflowStateWritable,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
    // Build details
    const details = {
        statusLineAvailable,
        statusLinePath,
        workflowStateWritable,
        lastStateUpdateAge,
        // Legacy compatibility fields
        notifierAvailable: statusLineAvailable,
        notifierPath: statusLinePath,
        lastNotificationAge: lastStateUpdateAge,
    };
    if (testStatusLine && statusLineOutput !== null) {
        details.statusLineOutput = statusLineOutput;
        details.pingSuccess = true;
    }
    // If neither status line script nor workflow state is available, fail
    if (!statusLineAvailable && !workflowStateWritable) {
        return {
            status: 'fail',
            message: 'Status line system is not available',
            details: {
                ...details,
                notifierAvailable: false,
            },
        };
    }
    // Check state update recency during active session
    if (sessionActive && lastStateUpdateAge !== null) {
        if (lastStateUpdateAge > RECENT_THRESHOLD_MS) {
            return {
                status: 'warn',
                message: 'No workflow state updates recently during active session',
                details,
            };
        }
    }
    // Pass
    return {
        status: 'pass',
        message: 'Status line system is healthy',
        details,
    };
}
//# sourceMappingURL=notifications.js.map