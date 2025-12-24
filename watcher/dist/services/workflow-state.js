/**
 * WorkflowStateService - Manages workflow state for status line display
 *
 * @behavior Manages a JSON state file that the status line script reads to display workflow progress
 */
import * as fs from 'fs';
import * as path from 'path';
// Full chain order for sequential progression
const CHAIN_ORDER = [
    // Discovery Chain
    'ideate', 'requirements', 'apiDesign', 'dataModel', 'adr',
    // Planning Chain
    'plan', 'acceptance',
    // Build Chain
    'red', 'mock', 'green', 'refactor', 'integration', 'contract',
    // Ship Chain
    'ship',
];
// Build phases for TDD cycle (acceptance is first, then TDD loop, then integration/contract)
const BUILD_PHASES = ['acceptance', 'red', 'mock', 'green', 'refactor', 'integration', 'contract'];
// TDD loop phases that reset when starting a new cycle
const TDD_LOOP_PHASES = ['red', 'mock', 'green', 'refactor'];
export class WorkflowStateService {
    stateFilePath;
    constructor(stateFilePath) {
        this.stateFilePath = stateFilePath || path.join(process.env.HOME || '~', '.oss', 'workflow-state.json');
    }
    /**
     * Creates state file with default values if it doesn't exist
     */
    async initialize() {
        const defaultState = this.getDefaultState();
        // Ensure directory exists
        const dir = path.dirname(this.stateFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Only write if file doesn't exist
        if (!fs.existsSync(this.stateFilePath)) {
            await this.writeState(defaultState);
        }
    }
    /**
     * Returns current state (or defaults if file corrupted)
     */
    async getState() {
        try {
            if (!fs.existsSync(this.stateFilePath)) {
                return this.getDefaultState();
            }
            const contents = fs.readFileSync(this.stateFilePath, 'utf-8');
            return JSON.parse(contents);
        }
        catch (error) {
            // File corrupted or doesn't exist - return defaults
            return this.getDefaultState();
        }
    }
    /**
     * Sets active step, marks previous steps as done, future steps as pending
     */
    async setActiveStep(step) {
        const state = await this.getState();
        // Clear workflowComplete when new work starts
        delete state.workflowComplete;
        // Special handling for 'build' - it's an alias for the TDD phases
        if (step === 'build') {
            state.activeStep = 'build';
            state.chainState.ideate = 'done';
            state.chainState.plan = 'done';
            state.chainState.acceptance = 'active';
            // Mark remaining build phases as pending
            state.chainState.red = 'pending';
            state.chainState.mock = 'pending';
            state.chainState.green = 'pending';
            state.chainState.refactor = 'pending';
            state.chainState.integration = 'pending';
            state.chainState.contract = 'pending';
            state.chainState.ship = 'pending';
            await this.writeState(state);
            return;
        }
        const stepIndex = CHAIN_ORDER.indexOf(step);
        // Mark all previous steps as done
        for (let i = 0; i < stepIndex; i++) {
            const prevStep = CHAIN_ORDER[i];
            state.chainState[prevStep] = 'done';
        }
        // Mark current step as active
        state.activeStep = step;
        const chainKey = step;
        state.chainState[chainKey] = 'active';
        // Mark all future steps as pending
        for (let i = stepIndex + 1; i < CHAIN_ORDER.length; i++) {
            const nextStep = CHAIN_ORDER[i];
            state.chainState[nextStep] = 'pending';
        }
        await this.writeState(state);
    }
    /**
     * Sets TDD phase within build (acceptance/red/green/refactor/integration)
     */
    async setTddPhase(phase) {
        const state = await this.getState();
        // Ideate and plan should be done
        state.chainState.ideate = 'done';
        state.chainState.plan = 'done';
        const phaseIndex = BUILD_PHASES.indexOf(phase);
        // Mark all previous build phases as done
        for (let i = 0; i < phaseIndex; i++) {
            const prevPhase = BUILD_PHASES[i];
            state.chainState[prevPhase] = 'done';
        }
        // Mark current phase as active
        const phaseKey = phase;
        state.chainState[phaseKey] = 'active';
        // Mark phases after current as pending
        for (let i = phaseIndex + 1; i < BUILD_PHASES.length; i++) {
            const nextPhase = BUILD_PHASES[i];
            state.chainState[nextPhase] = 'pending';
        }
        // Set tddPhase field for status line display (red/green/refactor only)
        if (phase === 'red' || phase === 'green' || phase === 'refactor') {
            state.tddPhase = phase;
        }
        await this.writeState(state);
    }
    /**
     * Marks step as done and sets nextCommand based on workflow progression
     */
    async completeStep(step) {
        const state = await this.getState();
        const chainKey = step;
        state.chainState[chainKey] = 'done';
        state.activeStep = null;
        // Set nextCommand based on which step was completed
        const NEXT_COMMAND_MAP = {
            ideate: 'plan',
            plan: 'build',
            build: 'ship',
            ship: null,
        };
        if (step in NEXT_COMMAND_MAP) {
            state.nextCommand = NEXT_COMMAND_MAP[step];
        }
        await this.writeState(state);
    }
    /**
     * Resets TDD loop phases (red/mock/green/refactor) for next iteration
     * Called when refactor completes and there are more tasks to do
     */
    async resetTddCycle() {
        const state = await this.getState();
        // Reset TDD loop phases to pending
        for (const phase of TDD_LOOP_PHASES) {
            const phaseKey = phase;
            state.chainState[phaseKey] = 'pending';
        }
        // Set red as active (starting the new cycle)
        state.chainState.red = 'active';
        state.activeStep = 'red';
        // Increment cycle counter
        state.tddCycle = (state.tddCycle || 1) + 1;
        await this.writeState(state);
    }
    /**
     * Marks all steps done, resets to idle
     */
    async workflowComplete() {
        const state = await this.getState();
        // Mark all steps as done
        for (const step of CHAIN_ORDER) {
            const stepKey = step;
            state.chainState[stepKey] = 'done';
        }
        // Reset to idle
        state.supervisor = 'idle';
        state.activeStep = null;
        state.tddCycle = undefined;
        state.tddPhase = undefined; // Clear TDD phase for status line
        delete state.message; // Clear message for status line
        delete state.notification; // Clear notification for status line
        await this.writeState(state);
    }
    /**
     * Updates supervisor status
     */
    async setSupervisor(status) {
        const state = await this.getState();
        state.supervisor = status;
        await this.writeState(state);
    }
    /**
     * Updates currentTask, progress, testsPass
     */
    async setProgress(info) {
        const state = await this.getState();
        if (info.currentTask !== undefined) {
            state.currentTask = info.currentTask;
        }
        if (info.progress !== undefined) {
            state.progress = info.progress;
        }
        if (info.testsPass !== undefined) {
            state.testsPass = info.testsPass;
        }
        await this.writeState(state);
    }
    /**
     * Resets to defaults
     */
    async reset() {
        await this.writeState(this.getDefaultState());
    }
    /**
     * Sets active agent for status line display
     */
    async setActiveAgent(info) {
        const state = await this.getState();
        state.activeAgent = {
            type: info.type,
            task: info.task,
            startedAt: new Date().toISOString(),
        };
        await this.writeState(state);
    }
    /**
     * Clears active agent when agent completes
     */
    async clearActiveAgent() {
        const state = await this.getState();
        delete state.activeAgent;
        await this.writeState(state);
    }
    /**
     * Sets message for status line display (workflow/session events)
     */
    async setMessage(message) {
        const state = await this.getState();
        state.message = message;
        await this.writeState(state);
    }
    /**
     * Clears message from status line
     */
    async clearMessage() {
        const state = await this.getState();
        delete state.message;
        await this.writeState(state);
    }
    /**
     * Sets currentCommand for status line display
     */
    async setCurrentCommand(command) {
        const state = await this.getState();
        state.currentCommand = command;
        await this.writeState(state);
    }
    /**
     * Clears currentCommand from state
     */
    async clearCurrentCommand() {
        const state = await this.getState();
        delete state.currentCommand;
        await this.writeState(state);
    }
    /**
     * Sets nextCommand for status line display
     */
    async setNextCommand(command) {
        const state = await this.getState();
        state.nextCommand = command;
        await this.writeState(state);
    }
    /**
     * Clears nextCommand (sets to null)
     */
    async clearNextCommand() {
        const state = await this.getState();
        state.nextCommand = null;
        await this.writeState(state);
    }
    /**
     * Determines if we should warn about archive based on workflow state
     *
     * Returns true if:
     * - Last step is 'plan' AND >24h since completion (should have been archived)
     *
     * Returns false if:
     * - Last step is 'ship' (archiving expected on next plan)
     * - No completed step yet
     * - Step completed within last 24h
     */
    async shouldWarnAboutArchive() {
        const state = await this.getState();
        // No completed step - don't warn
        if (!state.lastCompletedStep || !state.lastStepTimestamp) {
            return false;
        }
        // Ship just completed - archiving happens on next plan
        if (state.lastCompletedStep === 'ship') {
            return false;
        }
        // Check if plan completed more than 24h ago
        if (state.lastCompletedStep === 'plan') {
            const completedAt = new Date(state.lastStepTimestamp);
            const now = new Date();
            const hoursSinceComplete = (now.getTime() - completedAt.getTime()) / (1000 * 60 * 60);
            return hoursSinceComplete > 24;
        }
        return false;
    }
    /**
     * Returns default state
     * Note: version starts at 0 and gets incremented to 1 on first write
     */
    getDefaultState() {
        return {
            version: 0, // Will be incremented to 1 on first write
            supervisor: 'idle',
            activeStep: null,
            chainState: {
                // Discovery Chain
                ideate: 'pending',
                requirements: 'pending',
                apiDesign: 'pending',
                dataModel: 'pending',
                adr: 'pending',
                // Planning Chain
                plan: 'pending',
                acceptance: 'pending',
                // Build Chain (TDD Loop)
                red: 'pending',
                mock: 'pending',
                green: 'pending',
                refactor: 'pending',
                integration: 'pending',
                contract: 'pending',
                // Ship Chain
                ship: 'pending',
            },
            tddCycle: 1,
            lastUpdate: new Date().toISOString(),
        };
    }
    /**
     * Writes state to file with updated timestamp and incremented version
     */
    async writeState(state) {
        state.lastUpdate = new Date().toISOString();
        state.version = (state.version ?? 0) + 1;
        const dir = path.dirname(this.stateFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2));
    }
    /**
     * Sets notification with TTL (non-sticky, auto-expires)
     * @param message - Notification message
     * @param ttlSeconds - Time to live in seconds (default 10)
     */
    async setNotification(message, ttlSeconds = 10) {
        const state = await this.getState();
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        state.notification = { message, expiresAt };
        await this.writeState(state);
    }
    /**
     * Clears notification immediately
     */
    async clearNotification() {
        const state = await this.getState();
        delete state.notification;
        await this.writeState(state);
    }
    /**
     * Checks if notification is expired or doesn't exist
     * @returns true if expired or no notification exists
     */
    async isNotificationExpired() {
        const state = await this.getState();
        if (!state.notification) {
            return true;
        }
        const expiresAt = new Date(state.notification.expiresAt).getTime();
        return Date.now() > expiresAt;
    }
    /**
     * Sets queue summary for status line display (consolidated from queue.json)
     */
    async setQueueSummary(summary) {
        const state = await this.getState();
        state.queueSummary = summary;
        await this.writeState(state);
    }
    /**
     * Clears queue summary from state
     */
    async clearQueueSummary() {
        const state = await this.getState();
        delete state.queueSummary;
        await this.writeState(state);
    }
    /**
     * Sets health status for status line display (consolidated from iron-law-state.json)
     */
    async setHealth(health) {
        const state = await this.getState();
        state.health = health;
        await this.writeState(state);
    }
    /**
     * Clears health status from state
     */
    async clearHealth() {
        const state = await this.getState();
        delete state.health;
        await this.writeState(state);
    }
    /**
     * Clears progress, currentTask, and testsPass fields
     * Used to clear stale workflow progress on session start
     */
    async clearProgress() {
        const state = await this.getState();
        delete state.progress;
        delete state.currentTask;
        delete state.testsPass;
        await this.writeState(state);
    }
    /**
     * Prepares state for a new session by clearing stale workflow data
     * Preserves chainState for historical reference
     * Sets supervisor to 'watching' for active session
     */
    async prepareForNewSession() {
        const state = await this.getState();
        // Clear stale workflow data
        delete state.progress;
        delete state.currentTask;
        delete state.testsPass;
        delete state.message;
        delete state.notification;
        delete state.tddPhase;
        delete state.currentCommand;
        delete state.sessionId;
        state.activeStep = null;
        // Set supervisor to watching for active session
        state.supervisor = 'watching';
        // chainState is preserved for historical reference
        await this.writeState(state);
    }
    /**
     * Sets session ID for staleness detection
     * @param sessionId - Unique session identifier (typically UUID)
     */
    async setSessionId(sessionId) {
        const state = await this.getState();
        state.sessionId = sessionId;
        await this.writeState(state);
    }
    /**
     * Checks if the provided session ID matches the current session
     * @param sessionId - Session ID to check
     * @returns true if session IDs match, false otherwise
     */
    async isCurrentSession(sessionId) {
        const state = await this.getState();
        return state.sessionId === sessionId;
    }
    /**
     * Sets lastCommand for status line display (last completed command)
     * @param command - The command name (e.g., 'plan', 'build', 'ship')
     */
    async setLastCommand(command) {
        const state = await this.getState();
        state.lastCommand = command;
        await this.writeState(state);
    }
    /**
     * Clears lastCommand from state
     */
    async clearLastCommand() {
        const state = await this.getState();
        delete state.lastCommand;
        await this.writeState(state);
    }
    /**
     * Sets workflowComplete flag for status line display
     * When true, status line shows "→ DONE" instead of next command
     * @param complete - Whether the workflow is complete
     */
    async setWorkflowComplete(complete) {
        const state = await this.getState();
        if (complete) {
            state.workflowComplete = true;
        }
        else {
            delete state.workflowComplete;
        }
        await this.writeState(state);
    }
}
//# sourceMappingURL=workflow-state.js.map