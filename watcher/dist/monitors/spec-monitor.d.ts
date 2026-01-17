/**
 * Spec Monitor
 *
 * Monitors spec files for drift between specifications and implementation.
 * Follows the existing monitor pattern (log-monitor.ts, test-monitor.ts).
 *
 * @behavior SpecMonitor detects drift between spec files and implementation
 * @acceptance-criteria AC-SPEC-MONITOR.1 through AC-SPEC-MONITOR.20
 */
import { QueueManager } from '../queue/manager.js';
import { ParsedSpec, DriftResult, SpecCoverage, FeatureMetrics, SpecSection } from '../services/spec-reconciler/types.js';
/**
 * Configuration for the SpecMonitor
 */
export interface SpecMonitorConfig {
    /** Base path for the project. Default: process.cwd() */
    basePath?: string;
    /** Scan interval in milliseconds. Default: 300000 (5 minutes) */
    scanIntervalMs?: number;
}
/**
 * SpecMonitor - Monitors spec files for drift detection
 */
export declare class SpecMonitor {
    private readonly queueManager;
    private readonly config;
    private specCache;
    private lastScanTime;
    private processedSignatures;
    constructor(queueManager: QueueManager, config?: SpecMonitorConfig);
    /**
     * Scan for active features in .oss/dev/active/
     */
    scanActiveFeatures(): Promise<string[]>;
    /**
     * Get the spec file path for a feature
     */
    getSpecPath(feature: string): string;
    /**
     * Reset monitor state
     */
    reset(): void;
    /**
     * Add a processed signature and manage memory bounds.
     * Clears oldest half when exceeding MAX_PROCESSED_SIGNATURES.
     *
     * @param signature - The signature to add
     */
    addProcessedSignature(signature: string): Promise<void>;
    /**
     * Get the count of processed signatures.
     *
     * @returns The number of processed signatures
     */
    getProcessedSignaturesCount(): number;
    /**
     * Detect structural drift between spec components and implementation files.
     *
     * @param spec - The parsed specification
     * @param searchPaths - Directories to search for implementation files
     * @returns Array of drift results
     */
    detectStructuralDrift(spec: ParsedSpec, searchPaths: string[]): Promise<DriftResult[]>;
    /**
     * Detect criteria drift between spec criteria and test coverage.
     *
     * @param spec - The parsed specification
     * @param testSearchPaths - Directories to search for test files
     * @returns Array of drift results
     */
    detectCriteriaDrift(spec: ParsedSpec, testSearchPaths: string[]): Promise<DriftResult[]>;
    /**
     * Search test files for references to a criterion ID.
     *
     * @param criterionId - The criterion ID to search for (e.g., "SC-001")
     * @param testSearchPaths - Directories to search
     * @returns True if the criterion is referenced in a test file
     */
    private findCriterionInTests;
    /**
     * Recursively search a directory for test files containing a criterion reference.
     */
    private searchDirectoryForCriterion;
    /**
     * Calculate coverage for a spec section.
     *
     * @param section - The spec section to calculate coverage for
     * @returns Coverage statistics
     */
    calculateCoverage(section: SpecSection): SpecCoverage;
    /**
     * Get metrics for a feature including coverage across all sections.
     * Uses specCache first before parsing the file.
     *
     * @param feature - The feature name
     * @returns Feature metrics including coverage and drift count
     */
    getFeatureMetrics(feature: string): Promise<FeatureMetrics>;
    /**
     * Emit a drift anomaly to the task queue.
     *
     * @param drift - The drift result to emit
     * @param feature - The feature name for context
     */
    emitDriftAnomaly(drift: DriftResult, feature: string): Promise<void>;
    /**
     * Build a descriptive prompt for the drift anomaly.
     */
    private buildDriftPrompt;
}
//# sourceMappingURL=spec-monitor.d.ts.map