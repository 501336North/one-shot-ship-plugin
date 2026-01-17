/**
 * Spec Reconciler Module
 *
 * Provides functionality for parsing specification files, matching
 * them against implementation files, and reconciling drift between
 * specs and code.
 *
 * @module spec-reconciler
 */
// Parser exports
export { parseSpecFile, parseSpecSection, parseSpecItem, extractMarkerContent, } from './parser.js';
// File matcher exports
export { findMatchingFile, findExtraFiles, normalizeComponentName, } from './file-matcher.js';
// Auto-fixer exports
export { autoFixCheckbox } from './auto-fixer.js';
// Reconciler exports
export { classifyDrift, SpecReconciler } from './reconciler.js';
// Diff generator exports
export { isFileInFeatureScope, getRelatedFeature, generateCoverageDiff, logDiff, } from './diff-generator.js';
//# sourceMappingURL=index.js.map