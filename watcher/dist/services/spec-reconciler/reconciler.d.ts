/**
 * Spec Reconciler
 *
 * Orchestrates drift reconciliation by classifying drifts as simple or complex,
 * auto-fixing simple cases, and queuing complex cases for manual review.
 *
 * @behavior SpecReconciler classifies drift and orchestrates reconciliation
 * @acceptance-criteria AC-RECONCILER.1 through AC-RECONCILER.12
 */
import { QueueManager } from '../../queue/manager.js';
import { DriftResult, ReconciliationReport } from './types.js';
/**
 * Classify drift as 'simple' (can be auto-fixed) or 'complex' (needs manual review).
 *
 * A drift is classified as 'simple' if:
 * - It's structural_missing and the file actually exists (just unchecked in spec)
 * - Or confidence > 0.9 for structural_extra
 *
 * A drift is classified as 'complex' if:
 * - It's behavioral_mismatch
 * - Or it's structural_missing and file truly doesn't exist
 * - Or it's criteria_incomplete
 * - Or confidence <= 0.9 (uncertainty)
 *
 * @param drift - The drift result to classify
 * @param searchPaths - Directories to search for implementation files
 * @returns 'simple' or 'complex'
 */
export declare function classifyDrift(drift: DriftResult, searchPaths: string[]): Promise<'simple' | 'complex'>;
/**
 * SpecReconciler - Orchestrates drift reconciliation
 */
export declare class SpecReconciler {
    private readonly queueManager;
    constructor(queueManager: QueueManager);
    /**
     * Queue a drift task for manual review.
     *
     * @param drift - The drift result to queue
     * @param feature - The feature name for context
     * @param specPath - Path to the spec file
     */
    queueDriftTask(drift: DriftResult, feature: string, specPath: string): Promise<void>;
    /**
     * Build a descriptive prompt for the drift anomaly.
     */
    private buildDriftPrompt;
    /**
     * Reconcile a list of drifts for a feature.
     *
     * For each drift:
     * - Classify as simple or complex
     * - If simple: auto-fix
     * - If complex: queue task
     * - Log result
     *
     * @param drifts - List of drift results to reconcile
     * @param feature - The feature name
     * @param specPath - Path to the spec file
     * @param searchPaths - Directories to search for implementation files
     * @returns Reconciliation report
     */
    reconcile(drifts: DriftResult[], feature: string, specPath: string, searchPaths: string[]): Promise<ReconciliationReport>;
    /**
     * Attempt to auto-fix a simple drift.
     *
     * @param drift - The drift to fix
     * @param specPath - Path to the spec file
     * @returns Result of the auto-fix attempt
     */
    private attemptAutoFix;
}
//# sourceMappingURL=reconciler.d.ts.map