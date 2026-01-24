/**
 * Workflow Engine - Condition Evaluator
 *
 * Evaluates conditions for conditional workflow chain execution.
 *
 * @behavior Conditions are evaluated against workflow context to determine
 *           whether optional commands/agents should be executed.
 */

import { WorkflowContext, ConditionFn } from './types.js';

/**
 * Patterns to detect API-related content in design documents
 */
const API_PATTERNS = [
  /\bapi\b/i,
  /\bendpoint/i,
  /\brest\b/i,
  /\bgraphql\b/i,
  /\bget\s+\/|post\s+\/|put\s+\/|delete\s+\/|patch\s+\//i,
  /\broute/i,
  /\bhttp/i,
];

/**
 * Patterns to detect database-related content in design documents
 */
const DB_PATTERNS = [
  /\bdatabase\b/i,
  /\bschema\b/i,
  /\btable\b/i,
  /\bmodel\b/i,
  /\bprisma\b/i,
  /\bpostgresql\b/i,
  /\bpostgres\b/i,
  /\bmysql\b/i,
  /\bmongodb\b/i,
  /\bsqlite\b/i,
  /\bsql\b/i,
  /\bmigration/i,
  /\bforeign\s+key/i,
  /\borm\b/i,
];

/**
 * File extensions that indicate UI work
 */
const UI_FILE_PATTERNS = [
  /\.tsx$/,
  /\.jsx$/,
  /\.css$/,
  /\.scss$/,
  /\.sass$/,
  /\.less$/,
  /\.vue$/,
  /\.svelte$/,
  /\.html$/,
  /\/components\//,
  /\/pages\//,
  /\/views\//,
  /\/styles\//,
];

/**
 * Built-in condition functions
 */
const BUILT_IN_CONDITIONS: Record<string, ConditionFn> = {
  /**
   * Always returns true - for mandatory steps
   */
  always: () => true,

  /**
   * Always returns false - for disabled steps
   */
  never: () => false,

  /**
   * Returns true if design content mentions API/endpoint work
   */
  has_api_work: (context: WorkflowContext) => {
    const content = context.designContent || '';
    return API_PATTERNS.some((pattern) => pattern.test(content));
  },

  /**
   * Returns true if design content mentions database work
   */
  has_db_work: (context: WorkflowContext) => {
    const content = context.designContent || '';
    return DB_PATTERNS.some((pattern) => pattern.test(content));
  },

  /**
   * Returns true if changed files include UI-related files
   */
  has_ui_work: (context: WorkflowContext) => {
    const files = context.changedFiles || [];
    return files.some((file) =>
      UI_FILE_PATTERNS.some((pattern) => pattern.test(file))
    );
  },

  /**
   * Returns true if the last test run had failures
   */
  has_test_failures: (context: WorkflowContext) => {
    const result = context.lastTestResult;
    if (!result) {
      return false;
    }
    return !result.passed;
  },
};

/**
 * Evaluate a condition against the workflow context
 *
 * @param condition - The condition name to evaluate
 * @param context - The workflow context containing design content, changed files, etc.
 * @returns true if condition is met, false otherwise
 */
export function evaluateCondition(condition: string, context: WorkflowContext): boolean {
  const conditionFn = BUILT_IN_CONDITIONS[condition];
  if (!conditionFn) {
    // Unknown conditions default to false (conservative approach)
    return false;
  }
  return conditionFn(context);
}

/**
 * Get all built-in conditions
 *
 * @returns Record of condition name to condition function
 */
export function getBuiltInConditions(): Record<string, ConditionFn> {
  return { ...BUILT_IN_CONDITIONS };
}
