import { promises as fs } from 'fs';
const NO_DELEGATION_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
// Map file extensions to suggested agent types
const FILE_TYPE_TO_AGENT = {
    '.ts': 'typescript-pro',
    '.tsx': 'typescript-pro',
    '.py': 'python-pro',
    '.go': 'golang-pro',
    '.java': 'java-pro',
    '.swift': 'ios-developer',
    '.dart': 'flutter-expert',
};
export async function checkDelegation(options) {
    const { sessionLogPath, sessionActive = false } = options;
    try {
        // Read log file
        const logContent = await fs.readFile(sessionLogPath, 'utf-8');
        const lines = logContent.split('\n');
        // Parse AGENT entries
        const agentEntries = [];
        const agentTypes = new Set();
        for (const line of lines) {
            // Match pattern: [timestamp] AGENT agent-name "task description"
            const match = line.match(/\[([^\]]+)\]\s+AGENT\s+(\S+)\s+"([^"]+)"/);
            if (match) {
                const [, timestamp, agent, task] = match;
                agentEntries.push({
                    timestamp: new Date(timestamp),
                    agent,
                    task,
                });
                agentTypes.add(agent);
            }
        }
        // Parse TOOL entries to detect specialized work
        const toolEntries = [];
        for (const line of lines) {
            // Match pattern: [timestamp] TOOL action path
            const match = line.match(/\[([^\]]+)\]\s+TOOL\s+(\w+)\s+(.+)/);
            if (match) {
                const [, , action, path] = match;
                toolEntries.push({ action, path });
            }
        }
        // Check if delegation is happening
        const hasDelegation = agentEntries.length > 0;
        // If no delegation during active session, check if we should warn
        if (!hasDelegation && sessionActive) {
            // Check if specialized work is being done without delegation
            const suggestedAgents = new Set();
            for (const tool of toolEntries) {
                // Extract file extension
                const ext = tool.path.match(/(\.\w+)$/)?.[1];
                if (ext && FILE_TYPE_TO_AGENT[ext]) {
                    suggestedAgents.add(FILE_TYPE_TO_AGENT[ext]);
                }
            }
            // Count tool operations (indicates work is happening)
            const workIsHappening = toolEntries.length > 0;
            if (workIsHappening) {
                return {
                    status: 'warn',
                    message: 'No agent delegation detected during active session with specialized work',
                    details: {
                        agentCount: 0,
                        agentTypes: [],
                        suggestedAgents: Array.from(suggestedAgents),
                        toolOperations: toolEntries.length,
                    },
                };
            }
        }
        // If delegation is happening, report it
        if (hasDelegation) {
            return {
                status: 'pass',
                message: 'Agent delegation is active',
                details: {
                    agentCount: agentEntries.length,
                    agentTypes: Array.from(agentTypes),
                    recentDelegations: agentEntries.slice(-3).map((e) => ({
                        agent: e.agent,
                        task: e.task,
                    })),
                },
            };
        }
        // No delegation but session is inactive - pass
        return {
            status: 'pass',
            message: 'No delegation detected (session inactive)',
            details: {
                agentCount: 0,
                agentTypes: [],
            },
        };
    }
    catch (error) {
        // Fail if file is missing
        return {
            status: 'fail',
            message: `Session log is missing: ${sessionLogPath}`,
            details: {
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}
//# sourceMappingURL=delegation.js.map