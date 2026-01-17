/**
 * Diff Generator
 *
 * Generates diffs between spec coverage snapshots to track changes over time.
 * Detects which files belong to which features and logs coverage changes.
 *
 * @behavior Diff generator detects file changes and generates coverage diffs
 * @acceptance-criteria AC-DIFF-GEN.1 through AC-DIFF-GEN.9
 */
import type { CoverageDiff, DriftResult, FeatureMetrics } from './types.js';
/**
 * Check if a file path is within the scope of a feature.
 * Files in src/ that are not in excluded patterns are considered in scope.
 *
 * @param filePath - The file path to check
 * @param _featureName - The feature name (unused, kept for API compatibility)
 * @returns true if file is in feature scope
 */
export declare function isFileInFeatureScope(filePath: string, _featureName: string): boolean;
/**
 * Find which active feature a file path is related to.
 *
 * @param filePath - The file path to check
 * @param activeFeatures - List of active feature names
 * @returns The matching feature name or null
 */
export declare function getRelatedFeature(filePath: string, activeFeatures: string[]): Promise<string | null>;
/**
 * Extended metrics type that includes drift details.
 */
interface MetricsWithDrifts extends FeatureMetrics {
    drifts?: DriftResult[];
}
/**
 * Generate a coverage diff between two metric snapshots.
 *
 * @param before - Metrics before the change
 * @param after - Metrics after the change
 * @param trigger - What triggered the diff (file path, 'commit', or 'manual')
 * @returns The coverage diff
 */
export declare function generateCoverageDiff(before: MetricsWithDrifts, after: MetricsWithDrifts, trigger: string): CoverageDiff;
/**
 * Log a coverage diff to the spec-diffs.log file.
 *
 * @param diff - The coverage diff to log
 * @param basePath - The base path of the project
 */
export declare function logDiff(diff: CoverageDiff, basePath: string): Promise<void>;
export {};
//# sourceMappingURL=diff-generator.d.ts.map