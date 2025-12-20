/**
 * StateManager - Manage workflow state for status line display
 *
 * Reads and writes issues to workflow-state.json for daemon/status line
 * communication.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
export class StateManager {
    stateFile;
    constructor(config) {
        this.stateFile = path.join(config.ossDir, 'workflow-state.json');
    }
    /**
     * Read current workflow state
     */
    async readState() {
        try {
            const content = await fs.readFile(this.stateFile, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return {};
        }
    }
    /**
     * Write workflow state
     */
    async writeState(state) {
        await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
    }
    /**
     * Report an issue to workflow state
     */
    async reportIssue(issue) {
        const state = await this.readState();
        state.issue = issue;
        await this.writeState(state);
    }
    /**
     * Clear current issue
     */
    async clearIssue() {
        const state = await this.readState();
        state.issue = null;
        await this.writeState(state);
    }
    /**
     * Get current issue if any
     */
    async getCurrentIssue() {
        const state = await this.readState();
        return state.issue || null;
    }
}
//# sourceMappingURL=state-manager.js.map