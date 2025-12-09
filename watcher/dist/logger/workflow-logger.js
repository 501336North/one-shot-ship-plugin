/**
 * WorkflowLogger - Structured logging for OSS workflow chain
 *
 * Logs entries in hybrid format: JSON line + human-readable summary
 * Includes IRON LAW compliance checklist for every command/agent completion
 */
import * as fs from 'fs';
import * as path from 'path';
export class WorkflowLogger {
    logPath;
    writeQueue = Promise.resolve();
    constructor(ossDir) {
        this.logPath = path.join(ossDir, 'workflow.log');
    }
    /**
     * Log a workflow entry
     * Writes atomically: JSON line + human summary
     */
    async log(entry) {
        // Queue writes to ensure atomicity
        this.writeQueue = this.writeQueue.then(() => this.doLog(entry));
        return this.writeQueue;
    }
    async doLog(entry) {
        const timestamp = new Date().toISOString();
        const storedEntry = {
            ts: timestamp,
            cmd: entry.cmd,
            event: entry.event,
            data: entry.data,
        };
        if (entry.phase) {
            storedEntry.phase = entry.phase;
        }
        if (entry.agent) {
            storedEntry.agent = entry.agent;
        }
        if (entry.ironLaws) {
            storedEntry.ironLaws = entry.ironLaws;
        }
        const jsonLine = JSON.stringify(storedEntry);
        const humanLine = this.formatHumanSummary(storedEntry);
        let content = `${jsonLine}\n${humanLine}\n`;
        // Add IRON LAW checklist for COMPLETE and AGENT_COMPLETE events
        if ((entry.event === 'COMPLETE' || entry.event === 'AGENT_COMPLETE') && entry.ironLaws) {
            content += this.formatIronLawChecklist(entry.ironLaws);
        }
        // Atomic append
        fs.appendFileSync(this.logPath, content);
    }
    /**
     * Format IRON LAW compliance checklist for logging
     */
    formatIronLawChecklist(checklist) {
        const lines = [
            '# IRON LAW COMPLIANCE:',
            `#   [${checklist.law1_tdd ? '✓' : '✗'}] LAW #1: TDD - Tests written first`,
            `#   [${checklist.law2_behavior_tests ? '✓' : '✗'}] LAW #2: Behavior tests (not implementation)`,
            `#   [${checklist.law3_no_loops ? '✓' : '✗'}] LAW #3: No loops detected`,
            `#   [${checklist.law4_feature_branch ? '✓' : '✗'}] LAW #4: On feature branch`,
            `#   [${checklist.law5_delegation ? '✓' : '✗'}] LAW #5: Agent delegation used`,
            `#   [${checklist.law6_docs_synced ? '✓' : '✗'}] LAW #6: Dev docs synced`,
        ];
        const passCount = Object.values(checklist).filter(Boolean).length;
        const totalCount = Object.keys(checklist).length;
        lines.push(`#   Result: ${passCount}/${totalCount} laws observed`);
        lines.push('#');
        return lines.join('\n') + '\n';
    }
    /**
     * Format human-readable summary line
     */
    formatHumanSummary(entry) {
        const parts = ['#'];
        // Command (uppercase)
        parts.push(entry.cmd.toUpperCase());
        // Phase if present
        if (entry.phase) {
            parts[parts.length - 1] += `:${entry.phase}`;
        }
        // Event
        parts[parts.length - 1] += `:${entry.event}`;
        // Description based on event type and data
        const description = this.getDescription(entry);
        if (description) {
            parts.push('-');
            parts.push(description);
        }
        return parts.join(' ');
    }
    getDescription(entry) {
        const data = entry.data;
        // Agent events
        if (entry.agent || entry.event === 'AGENT_SPAWN' || entry.event === 'AGENT_COMPLETE') {
            const agentType = entry.agent?.type || data.agent_type;
            const task = data.task;
            if (task) {
                return `${agentType}: ${task}`;
            }
            return `${agentType}`;
        }
        // COMPLETE with summary
        if (entry.event === 'COMPLETE' && data.summary) {
            return data.summary;
        }
        // FAILED with error
        if (entry.event === 'FAILED' && data.error) {
            return data.error;
        }
        // START with args
        if (entry.event === 'START' && data.args) {
            const args = data.args;
            return args.join(' ');
        }
        // MILESTONE with description
        if (entry.event === 'MILESTONE' && data.description) {
            return data.description;
        }
        return '';
    }
}
//# sourceMappingURL=workflow-logger.js.map