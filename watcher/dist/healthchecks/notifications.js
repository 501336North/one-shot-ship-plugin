import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
const RECENT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
export async function checkNotifications(options) {
    const { logPath, sessionActive = false, testPing = false } = options;
    // Check if notifier is available
    let notifierPath = null;
    let notifierAvailable = false;
    try {
        const { stdout } = await execAsync('which terminal-notifier');
        notifierPath = stdout.trim();
        notifierAvailable = !!notifierPath;
    }
    catch (error) {
        return {
            status: 'fail',
            message: 'Notification app is not available',
            details: {
                notifierAvailable: false,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
    // Test notification if requested
    if (testPing && notifierAvailable && notifierPath) {
        try {
            await execAsync(`${notifierPath} -message "Health check ping" -title "OSS Watcher" -sound default`);
        }
        catch (error) {
            // Ping failed but don't fail the check
        }
    }
    // Read last notifications from log
    let lastNotificationAge = null;
    try {
        const content = await fs.readFile(logPath, 'utf-8');
        const lines = content.trim().split('\n');
        // Parse log entries for NOTIFICATION events
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            const match = line.match(/^\[([^\]]+)\] NOTIFICATION sent/);
            if (match) {
                const timestamp = new Date(match[1]);
                lastNotificationAge = Date.now() - timestamp.getTime();
                break;
            }
        }
    }
    catch (error) {
        // Log read error
        return {
            status: 'warn',
            message: 'Could not read notification logs',
            details: {
                notifierAvailable,
                notifierPath,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
    // Build details
    const details = {
        notifierAvailable,
        notifierPath,
        lastNotificationAge,
    };
    if (testPing) {
        details.pingSuccess = true;
    }
    // Check notification recency
    if (sessionActive && lastNotificationAge !== null) {
        if (lastNotificationAge > RECENT_THRESHOLD_MS) {
            return {
                status: 'warn',
                message: 'No notifications sent recently during active session',
                details,
            };
        }
    }
    // Pass
    return {
        status: 'pass',
        message: 'Notification system is healthy',
        details,
    };
}
//# sourceMappingURL=notifications.js.map