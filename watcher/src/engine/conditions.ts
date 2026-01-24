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
 * Patterns to detect CLI/command-line work in design documents
 */
const CLI_PATTERNS = [
  /\bcli\b/i,
  /\bcommand\s*line/i,
  /\bsubcommand/i,
  /\bargument\s*pars/i,
  /\bflag\s*pars/i,
  /\boption\s*pars/i,
  /\b(yargs|commander|minimist|meow|oclif)\b/i,
  /bin\//,
  /\bstdout\b/i,
  /\bstderr\b/i,
  /\bterminal\b/i,
  /\bshell\b/i,
];

/**
 * Patterns to detect authentication/authorization work in design documents
 */
const AUTH_PATTERNS = [
  /\bauthentication\b/i,
  /\bauthorization\b/i,
  /\blogin\b/i,
  /\bsignup\b/i,
  /\bsign[\s-]?in\b/i,
  /\bpassword\b/i,
  /\bjwt\b/i,
  /\bsession\b/i,
  /\boauth\b/i,
  /\brbac\b/i,
  /\bpermission/i,
  /\brole[\s-]?based/i,
  /\bcredential/i,
  /\btoken\b/i,
  /\bmfa\b/i,
  /\b2fa\b/i,
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

  /**
   * Returns true if design content mentions CLI/command-line work
   */
  has_cli_work: (context: WorkflowContext) => {
    const content = context.designContent || '';
    return CLI_PATTERNS.some((pattern) => pattern.test(content));
  },

  /**
   * Returns true if design content mentions authentication/authorization work
   */
  has_auth_work: (context: WorkflowContext) => {
    const content = context.designContent || '';
    return AUTH_PATTERNS.some((pattern) => pattern.test(content));
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
