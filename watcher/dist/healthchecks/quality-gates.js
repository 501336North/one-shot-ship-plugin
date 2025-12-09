import { promises as fs } from 'fs';
async function readLogEntries(logPath) {
    try {
        const content = await fs.readFile(logPath, 'utf-8');
        const lines = content.trim().split('\n');
        const entries = [];
        for (const line of lines) {
            // Parse format: [YYYY-MM-DDTHH:MM:SS] LEVEL message
            const match = line.match(/^\[([^\]]+)\]\s+(\w+)\s+(.+)$/);
            if (match) {
                const [, timestamp, level, message] = match;
                entries.push({ timestamp, level: level.toLowerCase(), message });
            }
        }
        return entries;
    }
    catch (error) {
        return [];
    }
}
const REQUIRED_GATES = ['code-review', 'performance', 'security'];
const PARALLEL_THRESHOLD_MS = 1000;
export async function checkQualityGates(options) {
    const { sessionLogPath } = options;
    // Read all log entries
    const entries = await readLogEntries(sessionLogPath);
    // Filter to quality gate entries
    const gateEntries = entries.filter((entry) => entry.message.includes('QUALITY_GATE'));
    // If no gates found, fail
    if (gateEntries.length === 0) {
        return {
            status: 'fail',
            message: 'No quality gates found in last ship',
            details: {
                gatesRun: []
            }
        };
    }
    // Parse gate information
    const gatesRun = [];
    const failedGates = [];
    const failures = [];
    const timestamps = [];
    for (const entry of gateEntries) {
        // Parse message: "QUALITY_GATE <gate> <status> [: <reason>]"
        const match = entry.message.match(/QUALITY_GATE\s+(\S+)\s+(\w+)(?::\s+(.+))?/);
        if (match) {
            const [, gate, status, reason] = match;
            gatesRun.push(gate);
            timestamps.push(new Date(entry.timestamp));
            if (status === 'failed') {
                failedGates.push(gate);
                failures.push({ gate, reason: reason || 'Unknown failure' });
            }
        }
    }
    // Check if all required gates ran
    const missingGates = REQUIRED_GATES.filter((gate) => !gatesRun.includes(gate));
    // Check if gates ran in parallel (within 1 second)
    let ranInParallel = false;
    if (timestamps.length > 1) {
        const minTime = Math.min(...timestamps.map((t) => t.getTime()));
        const maxTime = Math.max(...timestamps.map((t) => t.getTime()));
        ranInParallel = maxTime - minTime <= PARALLEL_THRESHOLD_MS;
    }
    // Determine status
    if (failedGates.length > 0) {
        return {
            status: 'fail',
            message: 'Quality gate failures detected',
            details: {
                gatesRun,
                failedGates,
                failures,
                ranInParallel
            }
        };
    }
    if (missingGates.length > 0) {
        return {
            status: 'warn',
            message: 'Not all quality gates ran',
            details: {
                gatesRun,
                missingGates,
                ranInParallel
            }
        };
    }
    if (!ranInParallel && gatesRun.length === REQUIRED_GATES.length) {
        return {
            status: 'warn',
            message: 'All quality gates passed but not running in parallel',
            details: {
                gatesRun,
                ranInParallel
            }
        };
    }
    return {
        status: 'pass',
        message: 'All quality gates passed',
        details: {
            gatesRun,
            ranInParallel
        }
    };
}
//# sourceMappingURL=quality-gates.js.map