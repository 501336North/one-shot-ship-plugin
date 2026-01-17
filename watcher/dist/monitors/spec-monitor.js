/**
 * Spec Monitor
 *
 * Monitors spec files for drift between specifications and implementation.
 * Follows the existing monitor pattern (log-monitor.ts, test-monitor.ts).
 *
 * @behavior SpecMonitor detects drift between spec files and implementation
 * @acceptance-criteria AC-SPEC-MONITOR.1 through AC-SPEC-MONITOR.20
 */
import * as fs from 'fs';
import * as path from 'path';
import { findMatchingFile, findExtraFiles } from '../services/spec-reconciler/file-matcher.js';
import { parseSpecFile } from '../services/spec-reconciler/parser.js';
/**
 * SpecMonitor - Monitors spec files for drift detection
 */
export class SpecMonitor {
    queueManager;
    config;
    specCache;
    lastScanTime;
    processedSignatures;
    constructor(queueManager, config) {
        this.queueManager = queueManager;
        this.config = {
            basePath: config?.basePath ?? process.cwd(),
            scanIntervalMs: config?.scanIntervalMs ?? 300000,
        };
        this.specCache = new Map();
        this.lastScanTime = 0;
        this.processedSignatures = new Set();
    }
    /**
     * Scan for active features in .oss/dev/active/
     */
    async scanActiveFeatures() {
        const activeDir = path.join(this.config.basePath, '.oss', 'dev', 'active');
        if (!fs.existsSync(activeDir)) {
            return [];
        }
        const entries = await fs.promises.readdir(activeDir, { withFileTypes: true });
        const features = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                features.push(entry.name);
            }
        }
        return features;
    }
    /**
     * Get the spec file path for a feature
     */
    getSpecPath(feature) {
        return path.join(this.config.basePath, '.oss', 'dev', 'active', feature, 'DESIGN.md');
    }
    /**
     * Reset monitor state
     */
    reset() {
        this.specCache.clear();
        this.lastScanTime = 0;
        this.processedSignatures.clear();
    }
    /**
     * Detect structural drift between spec components and implementation files.
     *
     * @param spec - The parsed specification
     * @param searchPaths - Directories to search for implementation files
     * @returns Array of drift results
     */
    async detectStructuralDrift(spec, searchPaths) {
        const drifts = [];
        const components = spec.components.items;
        // Check for missing implementations (component in spec but no file)
        for (const component of components) {
            const matchingFile = await findMatchingFile(component.id, searchPaths);
            if (!matchingFile) {
                drifts.push({
                    type: 'structural_missing',
                    confidence: 1.0,
                    description: `Component "${component.id}" is in spec but has no matching implementation file`,
                    specItem: component,
                });
            }
        }
        // Check for extra files (file exists but not in spec)
        const extraFiles = await findExtraFiles(components, searchPaths);
        for (const filePath of extraFiles) {
            drifts.push({
                type: 'structural_extra',
                confidence: 1.0,
                description: `File "${path.basename(filePath)}" exists but is not in the spec`,
                filePath,
            });
        }
        return drifts;
    }
    /**
     * Detect criteria drift between spec criteria and test coverage.
     *
     * @param spec - The parsed specification
     * @param testSearchPaths - Directories to search for test files
     * @returns Array of drift results
     */
    async detectCriteriaDrift(spec, testSearchPaths) {
        const drifts = [];
        const criteria = spec.criteria.items;
        // Check for unchecked criteria without test coverage
        for (const criterion of criteria) {
            // Skip checked criteria - they're already marked as complete
            if (criterion.status === 'checked') {
                continue;
            }
            // Check if there's a test file referencing this criterion
            const hasTestCoverage = await this.findCriterionInTests(criterion.id, testSearchPaths);
            if (!hasTestCoverage) {
                drifts.push({
                    type: 'criteria_incomplete',
                    confidence: 0.8,
                    description: `Criterion "${criterion.id}" is unchecked and has no test coverage`,
                    specItem: criterion,
                });
            }
        }
        return drifts;
    }
    /**
     * Search test files for references to a criterion ID.
     *
     * @param criterionId - The criterion ID to search for (e.g., "SC-001")
     * @param testSearchPaths - Directories to search
     * @returns True if the criterion is referenced in a test file
     */
    async findCriterionInTests(criterionId, testSearchPaths) {
        for (const searchPath of testSearchPaths) {
            if (!fs.existsSync(searchPath)) {
                continue;
            }
            const found = await this.searchDirectoryForCriterion(searchPath, criterionId);
            if (found) {
                return true;
            }
        }
        return false;
    }
    /**
     * Recursively search a directory for test files containing a criterion reference.
     */
    async searchDirectoryForCriterion(dir, criterionId) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = await this.searchDirectoryForCriterion(fullPath, criterionId);
                if (found) {
                    return true;
                }
            }
            else if (entry.isFile() && /\.test\.[jt]sx?$/.test(entry.name)) {
                // Read the test file and check for criterion reference
                const content = await fs.promises.readFile(fullPath, 'utf-8');
                // Look for patterns like @criteria SC-001 or @acceptance-criteria SC-001
                if (content.includes(criterionId)) {
                    return true;
                }
            }
        }
        return false;
    }
    /**
     * Calculate coverage for a spec section.
     *
     * @param section - The spec section to calculate coverage for
     * @returns Coverage statistics
     */
    calculateCoverage(section) {
        const total = section.items.length;
        const implemented = section.items.filter((item) => item.status === 'checked').length;
        const ratio = total > 0 ? implemented / total : 0;
        return {
            total,
            implemented,
            ratio,
        };
    }
    /**
     * Get metrics for a feature including coverage across all sections.
     *
     * @param feature - The feature name
     * @returns Feature metrics including coverage and drift count
     */
    async getFeatureMetrics(feature) {
        const specPath = this.getSpecPath(feature);
        // Read and parse the spec file
        let spec;
        if (fs.existsSync(specPath)) {
            const content = await fs.promises.readFile(specPath, 'utf-8');
            spec = parseSpecFile(content, feature);
        }
        else {
            // Return empty metrics if no spec file exists
            spec = {
                feature,
                components: { marker: 'components', items: [], raw: '' },
                criteria: { marker: 'criteria', items: [], raw: '' },
                behaviors: { marker: 'behaviors', items: [], raw: '' },
            };
        }
        // Calculate coverage for each section
        const componentsCoverage = this.calculateCoverage(spec.components);
        const criteriaCoverage = this.calculateCoverage(spec.criteria);
        const behaviorsCoverage = this.calculateCoverage(spec.behaviors);
        return {
            feature,
            specPath,
            coverage: {
                components: componentsCoverage,
                criteria: criteriaCoverage,
                behaviors: behaviorsCoverage,
            },
            drift: {
                count: 0, // Will be populated when drift detection is run
                types: [],
            },
        };
    }
    /**
     * Emit a drift anomaly to the task queue.
     *
     * @param drift - The drift result to emit
     * @param feature - The feature name for context
     */
    async emitDriftAnomaly(drift, feature) {
        // Determine priority based on drift type
        const priority = drift.type.startsWith('structural_') ? 'high' : 'medium';
        // Determine anomaly type
        const anomalyType = drift.type.startsWith('structural_')
            ? 'spec_drift_structural'
            : 'spec_drift_criteria';
        // Build the task prompt
        const prompt = this.buildDriftPrompt(drift, feature);
        const task = {
            priority,
            source: 'spec-monitor',
            anomaly_type: anomalyType,
            prompt,
            suggested_agent: 'code-reviewer',
            context: {
                drift_type: drift.type,
                spec_item_id: drift.specItem?.id,
                spec_item_description: drift.specItem?.description,
                feature,
                spec_path: this.getSpecPath(feature),
                confidence: drift.confidence,
                file: drift.filePath,
            },
        };
        await this.queueManager.addTask(task);
    }
    /**
     * Build a descriptive prompt for the drift anomaly.
     */
    buildDriftPrompt(drift, feature) {
        switch (drift.type) {
            case 'structural_missing':
                return `Spec drift detected in feature "${feature}": ${drift.description}. Either implement the component or update the spec.`;
            case 'structural_extra':
                return `Spec drift detected in feature "${feature}": ${drift.description}. Either add this component to the spec or determine if it should be removed.`;
            case 'criteria_incomplete':
                return `Spec drift detected in feature "${feature}": ${drift.description}. Add test coverage for this criterion or mark it as complete in the spec.`;
            default:
                return `Spec drift detected in feature "${feature}": ${drift.description}.`;
        }
    }
}
//# sourceMappingURL=spec-monitor.js.map