/**
 * Spec Reconciler Module
 *
 * Provides functionality for parsing specification files, matching
 * them against implementation files, and reconciling drift between
 * specs and code.
 *
 * @module spec-reconciler
 */
export type { SpecItem, SpecSection, ParsedSpec, DriftType, DriftResult, SpecCoverage, FeatureMetrics, AutoFixResult, ReconciliationEntry, ReconciliationReport, HistoryEntry, VelocityMetrics, SpecMetricsFile, CoverageDiff, } from './types.js';
export { parseSpecFile, parseSpecSection, parseSpecItem, extractMarkerContent, } from './parser.js';
export { findMatchingFile, findExtraFiles, normalizeComponentName, } from './file-matcher.js';
export { autoFixCheckbox } from './auto-fixer.js';
export { classifyDrift, SpecReconciler } from './reconciler.js';
export { isFileInFeatureScope, getRelatedFeature, generateCoverageDiff, logDiff, } from './diff-generator.js';
//# sourceMappingURL=index.d.ts.map