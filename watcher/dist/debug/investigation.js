/**
 * Investigation - Agent Delegation
 * Creates tasks for debugger agent and parses results
 */
/**
 * Create investigation task for debugger agent
 */
export function createInvestigationTask(bug) {
    let prompt = `Investigate the following bug:\n\n`;
    prompt += `Error Type: ${bug.errorType}\n`;
    if (bug.message) {
        prompt += `Message: ${bug.message}\n`;
    }
    if (bug.component) {
        prompt += `Component: ${bug.component}\n`;
    }
    return {
        subagent_type: 'debugger',
        prompt,
    };
}
/**
 * Parse investigation results into root causes
 */
export function parseInvestigationResult(output) {
    const causes = [];
    const lines = output.split('\n');
    let currentCause = null;
    for (const line of lines) {
        const causeMatch = line.match(/^Root Cause \d+:\s*(.+)/);
        if (causeMatch) {
            currentCause = causeMatch[1];
            continue;
        }
        const evidenceMatch = line.match(/^Evidence:\s*(.+)/);
        if (evidenceMatch && currentCause) {
            causes.push({
                cause: currentCause,
                evidence: evidenceMatch[1],
            });
            currentCause = null;
        }
    }
    return causes;
}
//# sourceMappingURL=investigation.js.map