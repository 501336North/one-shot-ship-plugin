/**
 * StatusLineService - Track TDD phase and workflow progress for status line display
 *
 * Tracks:
 * - Current TDD phase (RED/GREEN/REFACTOR)
 * - Task progress (current/total)
 * - Supervisor status (watching/intervening/idle)
 * - Context health (healthy/warning/critical based on token usage)
 *
 * State is persisted to ~/.oss/status-line.json for SwiftBar/Claude Code status line
 */
import { promises as fs } from 'fs';
import * as path from 'path';
const DEFAULT_STATE = {
    phase: null,
    task: null,
    supervisor: null,
    contextHealth: null,
};
/**
 * Calculate context health level based on usage percentage
 * @param usagePercent - Context usage as a percentage (0-100)
 * @returns ContextHealthLevel: 'healthy' (< 50%), 'warning' (50-69%), 'critical' (>= 70%)
 */
export function calculateContextHealthLevel(usagePercent) {
    if (usagePercent >= 70) {
        return 'critical';
    }
    if (usagePercent >= 50) {
        return 'warning';
    }
    return 'healthy';
}
export class StatusLineService {
    ossDir;
    stateFile;
    state = { ...DEFAULT_STATE };
    constructor(ossDir = `${process.env.HOME}/.oss`) {
        this.ossDir = ossDir;
        this.stateFile = path.join(ossDir, 'status-line.json');
    }
    /**
     * Initialize service by loading existing state (if any)
     */
    async initialize() {
        try {
            const content = await fs.readFile(this.stateFile, 'utf-8');
            this.state = JSON.parse(content);
        }
        catch {
            // No existing state file, use defaults
            this.state = { ...DEFAULT_STATE };
        }
    }
    /**
     * Get current status line state
     */
    async getState() {
        return { ...this.state };
    }
    /**
     * Set the current TDD phase
     */
    async setTDDPhase(phase) {
        this.state.phase = phase;
        await this.persist();
    }
    /**
     * Set task progress
     */
    async setTaskProgress(current, total) {
        this.state.task = `${current}/${total}`;
        await this.persist();
    }
    /**
     * Set supervisor status
     */
    async setSupervisorStatus(status) {
        this.state.supervisor = status;
        await this.persist();
    }
    /**
     * Set context health information
     */
    async setContextHealth(info) {
        this.state.contextHealth = info;
        await this.persist();
    }
    /**
     * Clear all state
     */
    async clearState() {
        this.state = { ...DEFAULT_STATE };
        await this.persist();
    }
    /**
     * Persist state to file
     */
    async persist() {
        await fs.mkdir(this.ossDir, { recursive: true });
        await fs.writeFile(this.stateFile, JSON.stringify(this.state, null, 2));
    }
}
//# sourceMappingURL=status-line.js.map