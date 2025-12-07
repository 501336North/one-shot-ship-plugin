/**
 * IronLawMonitor - Continuous IRON LAW compliance monitoring
 *
 * @behavior Monitors git state, file changes, and tool usage for IRON LAW violations
 * @acceptance-criteria AC-IRON.1 through AC-IRON.12
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
// =============================================================================
// Service
// =============================================================================
export class IronLawMonitor {
    projectDir;
    stateFile;
    state;
    activeFeature = null;
    pendingSourceFiles = new Set();
    constructor(options) {
        this.projectDir = options.projectDir;
        this.stateFile = options.stateFile || path.join(process.env.HOME || '~', '.oss', 'iron-law-state.json');
        // Load previous state or initialize
        this.state = this.loadState();
    }
    /**
     * Run all IRON LAW checks and return violations
     */
    async check() {
        const violations = [];
        const now = new Date().toISOString();
        // IRON LAW #4: Git Branch Check
        const branchViolation = this.checkGitBranch();
        if (branchViolation) {
            violations.push(branchViolation);
        }
        // IRON LAW #1: TDD Check
        const tddViolations = this.checkTdd();
        violations.push(...tddViolations);
        // IRON LAW #6: Dev Docs Check
        const docViolation = this.checkDevDocs();
        if (docViolation) {
            violations.push(docViolation);
        }
        // Update state - mark resolved violations
        this.updateViolationState(violations);
        // Save state
        this.state.lastCheck = now;
        this.saveState();
        return violations;
    }
    /**
     * Track a file change for TDD monitoring
     */
    trackFileChange(filePath, action) {
        const change = {
            path: filePath,
            action,
            timestamp: new Date().toISOString(),
        };
        this.state.recentFileChanges.push(change);
        // Track source files that need tests
        if (this.isSourceFile(filePath) && !this.isTestFile(filePath)) {
            if (action === 'created') {
                this.pendingSourceFiles.add(filePath);
            }
        }
        // If a test file is created, clear the corresponding source from pending
        if (this.isTestFile(filePath) && action === 'created') {
            const sourceFile = this.getSourceFileForTest(filePath);
            this.pendingSourceFiles.delete(sourceFile);
        }
        // Keep only last 100 changes
        if (this.state.recentFileChanges.length > 100) {
            this.state.recentFileChanges = this.state.recentFileChanges.slice(-100);
        }
    }
    /**
     * Track a tool call for TDD order verification
     */
    trackToolCall(tool, filePath) {
        const call = {
            tool,
            path: filePath,
            timestamp: new Date().toISOString(),
        };
        this.state.recentToolCalls.push(call);
        // Track Write tool calls for TDD order
        if (tool === 'Write') {
            if (this.isSourceFile(filePath) && !this.isTestFile(filePath)) {
                // Source file written - check if test was written first
                const testFile = this.getTestFileForSource(filePath);
                const testWritten = this.state.recentToolCalls.some(c => c.tool === 'Write' && c.path === testFile);
                if (!testWritten) {
                    this.pendingSourceFiles.add(filePath);
                }
            }
            else if (this.isTestFile(filePath)) {
                // Test file written - mark source as covered
                const sourceFile = this.getSourceFileForTest(filePath);
                this.pendingSourceFiles.delete(sourceFile);
            }
        }
        // Keep only last 100 calls
        if (this.state.recentToolCalls.length > 100) {
            this.state.recentToolCalls = this.state.recentToolCalls.slice(-100);
        }
    }
    /**
     * Set the active feature being worked on
     */
    setActiveFeature(featureName) {
        this.activeFeature = featureName;
    }
    /**
     * Get current state
     */
    getState() {
        return this.state;
    }
    // ===========================================================================
    // Check Methods
    // ===========================================================================
    checkGitBranch() {
        try {
            const branch = execSync('git branch --show-current', {
                cwd: this.projectDir,
                encoding: 'utf-8',
            }).trim();
            if (branch === 'main' || branch === 'master') {
                return {
                    law: 4,
                    type: 'iron_law_branch',
                    message: `On ${branch} branch - create a feature branch first`,
                    detected: new Date().toISOString(),
                    resolved: null,
                    correctiveAction: `git checkout -b feat/your-feature-name`,
                };
            }
            return null;
        }
        catch {
            // Not a git repo or git error - no violation
            return null;
        }
    }
    checkTdd() {
        const violations = [];
        for (const sourceFile of this.pendingSourceFiles) {
            const fileName = path.basename(sourceFile);
            violations.push({
                law: 1,
                type: 'iron_law_tdd',
                message: `${fileName} written without test - write test first`,
                detected: new Date().toISOString(),
                resolved: null,
                correctiveAction: `Write test for ${fileName} before implementing`,
            });
        }
        return violations;
    }
    checkDevDocs() {
        if (!this.activeFeature) {
            return null;
        }
        const progressPath = path.join(this.projectDir, 'dev', 'active', this.activeFeature, 'PROGRESS.md');
        try {
            if (!fs.existsSync(progressPath)) {
                return {
                    law: 6,
                    type: 'iron_law_docs',
                    message: `Missing PROGRESS.md for ${this.activeFeature}`,
                    detected: new Date().toISOString(),
                    resolved: null,
                    correctiveAction: `Create dev/active/${this.activeFeature}/PROGRESS.md`,
                };
            }
        }
        catch {
            // Can't check - no violation
        }
        return null;
    }
    // ===========================================================================
    // Helper Methods
    // ===========================================================================
    isSourceFile(filePath) {
        return filePath.endsWith('.ts') || filePath.endsWith('.js');
    }
    isTestFile(filePath) {
        return filePath.includes('.test.') || filePath.includes('.spec.');
    }
    getTestFileForSource(sourceFile) {
        const ext = path.extname(sourceFile);
        const base = sourceFile.slice(0, -ext.length);
        return `${base}.test${ext}`;
    }
    getSourceFileForTest(testFile) {
        return testFile.replace('.test.', '.').replace('.spec.', '.');
    }
    updateViolationState(currentViolations) {
        const now = new Date().toISOString();
        const currentTypes = new Set(currentViolations.map(v => v.type));
        // Mark existing violations as resolved if no longer detected
        for (const violation of this.state.violations) {
            if (!violation.resolved && !currentTypes.has(violation.type)) {
                violation.resolved = now;
            }
        }
        // Add new violations
        for (const violation of currentViolations) {
            const existing = this.state.violations.find(v => v.type === violation.type && !v.resolved);
            if (!existing) {
                this.state.violations.push(violation);
            }
        }
        // Keep only last 100 violations
        if (this.state.violations.length > 100) {
            this.state.violations = this.state.violations.slice(-100);
        }
    }
    // ===========================================================================
    // Persistence
    // ===========================================================================
    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const content = fs.readFileSync(this.stateFile, 'utf-8');
                return JSON.parse(content);
            }
        }
        catch {
            // Ignore errors, return default state
        }
        return {
            lastCheck: new Date().toISOString(),
            violations: [],
            recentFileChanges: [],
            recentToolCalls: [],
        };
    }
    saveState() {
        try {
            const dir = path.dirname(this.stateFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf-8');
        }
        catch {
            // Ignore save errors
        }
    }
}
//# sourceMappingURL=iron-law-monitor.js.map