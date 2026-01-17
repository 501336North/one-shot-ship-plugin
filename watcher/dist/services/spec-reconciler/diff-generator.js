/**
 * Diff Generator
 *
 * Generates diffs between spec coverage snapshots to track changes over time.
 * Detects which files belong to which features and logs coverage changes.
 *
 * @behavior Diff generator detects file changes and generates coverage diffs
 * @acceptance-criteria AC-DIFF-GEN.1 through AC-DIFF-GEN.9
 */
import * as fs from 'fs';
import * as path from 'path';
/**
 * Patterns to exclude from feature scope.
 */
const EXCLUDE_PATTERNS = [
    /node_modules/,
    /^dist\//,
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /\.d\.ts$/,
];
/**
 * Check if a file path is within the scope of a feature.
 * Files in src/ that are not in excluded patterns are considered in scope.
 *
 * @param filePath - The file path to check
 * @param _featureName - The feature name (unused, kept for API compatibility)
 * @returns true if file is in feature scope
 */
export function isFileInFeatureScope(filePath, _featureName) {
    // Check if path starts with src/
    if (!filePath.startsWith('src/')) {
        return false;
    }
    // Check against exclusion patterns
    for (const pattern of EXCLUDE_PATTERNS) {
        if (pattern.test(filePath)) {
            return false;
        }
    }
    return true;
}
/**
 * Normalize a string for comparison (lowercase, remove hyphens/underscores).
 */
function normalizeForComparison(str) {
    return str.toLowerCase().replace(/[-_]/g, '');
}
/**
 * Find which active feature a file path is related to.
 *
 * @param filePath - The file path to check
 * @param activeFeatures - List of active feature names
 * @returns The matching feature name or null
 */
export async function getRelatedFeature(filePath, activeFeatures) {
    const normalizedPath = normalizeForComparison(filePath);
    for (const feature of activeFeatures) {
        const normalizedFeature = normalizeForComparison(feature);
        // Check if the path contains the feature name
        if (normalizedPath.includes(normalizedFeature)) {
            return feature;
        }
        // Also check individual words in feature name
        const featureWords = feature.toLowerCase().split(/[-_]/);
        for (const word of featureWords) {
            if (word.length > 2 && normalizedPath.includes(word)) {
                return feature;
            }
        }
    }
    return null;
}
/**
 * Calculate average coverage ratio across all sections.
 */
function calculateAverageCoverage(coverage) {
    return (coverage.components.ratio + coverage.criteria.ratio + coverage.behaviors.ratio) / 3;
}
/**
 * Generates a unique key for a drift result.
 * Used for O(n+m) set operations.
 *
 * @param drift - The drift result to generate a key for
 * @returns A unique string key for the drift
 */
export function driftKey(drift) {
    if (drift.specItem) {
        return `${drift.type}:${drift.specItem.id}`;
    }
    if (drift.filePath) {
        return `${drift.type}:${drift.filePath}`;
    }
    return `${drift.type}:${drift.description}`;
}
/**
 * Find drifts that exist in the 'before' list but not the 'after' list.
 * Uses O(n+m) algorithm with Set for efficient lookup.
 *
 * @param before - Array of drift results before the change
 * @param after - Array of drift results after the change
 * @returns Array of drifts that were resolved (in before but not in after)
 */
export function findDriftDifference(before, after) {
    // Build a Set of keys from 'after' array - O(m)
    const afterKeys = new Set(after.map((d) => driftKey(d)));
    // Filter 'before' to find ones not in 'after' - O(n)
    return before.filter((d) => !afterKeys.has(driftKey(d)));
}
/**
 * Generate a coverage diff between two metric snapshots.
 *
 * @param before - Metrics before the change
 * @param after - Metrics after the change
 * @param trigger - What triggered the diff (file path, 'commit', or 'manual')
 * @returns The coverage diff
 */
export function generateCoverageDiff(before, after, trigger) {
    const beforeDrifts = before.drifts || [];
    const afterDrifts = after.drifts || [];
    const resolved = findDriftDifference(beforeDrifts, afterDrifts);
    const newDrifts = findDriftDifference(afterDrifts, beforeDrifts);
    const beforeAvg = calculateAverageCoverage(before.coverage);
    const afterAvg = calculateAverageCoverage(after.coverage);
    return {
        feature: before.feature,
        trigger,
        timestamp: new Date().toISOString(),
        before: {
            components: before.coverage.components,
            criteria: before.coverage.criteria,
            behaviors: before.coverage.behaviors,
            driftCount: before.drift.count,
        },
        after: {
            components: after.coverage.components,
            criteria: after.coverage.criteria,
            behaviors: after.coverage.behaviors,
            driftCount: after.drift.count,
        },
        resolved,
        new: newDrifts,
        net: {
            coverageChange: afterAvg - beforeAvg,
            driftChange: after.drift.count - before.drift.count,
        },
    };
}
/**
 * Log a coverage diff to the spec-diffs.log file.
 *
 * @param diff - The coverage diff to log
 * @param basePath - The base path of the project
 */
export async function logDiff(diff, basePath) {
    const ossDir = path.join(basePath, '.oss');
    const logPath = path.join(ossDir, 'spec-diffs.log');
    // Ensure .oss directory exists
    await fs.promises.mkdir(ossDir, { recursive: true });
    // Format log entry as JSON line with summary
    const summary = `[${diff.timestamp}] ${diff.feature} via ${diff.trigger}: coverage ${diff.net.coverageChange >= 0 ? '+' : ''}${(diff.net.coverageChange * 100).toFixed(1)}%, drift ${diff.net.driftChange >= 0 ? '+' : ''}${diff.net.driftChange}`;
    const logEntry = JSON.stringify({ ...diff, _summary: summary }) + '\n';
    // Append to log file
    await fs.promises.appendFile(logPath, logEntry, 'utf-8');
}
//# sourceMappingURL=diff-generator.js.map