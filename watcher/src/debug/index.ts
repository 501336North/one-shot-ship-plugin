/**
 * Debug Module Barrel Export
 * Exports all public functions and types from debug modules
 */

// Bug parser
export {
  parseInput,
  parseStackTrace,
  parseDescription,
  mergeInputs,
  type BugInput,
  type StackFrame,
  type BugDescription,
  type ParsedBug,
} from './bug-parser.js';

// Investigation
export {
  createInvestigationTask,
  parseInvestigationResult,
  type RootCause,
  type TaskParams,
} from './investigation.js';

// Confirmation
export {
  formatRootCauses,
  createConfirmationQuestion,
  shouldAutoConfirm,
  type QuestionParams,
} from './confirmation.js';

// Severity
export {
  inferSeverity,
  createSeverityQuestion,
  type SeverityLevel,
  type SeverityResult,
} from './severity.js';

// Reproduction
export {
  getTestPath,
  createTestTask,
  generateTestContent,
  type ConfirmedBug,
} from './reproduction.js';

// Test runner
export {
  buildTestCommand,
  parseTestResult,
  verifyTestFails,
  type TestResult,
  type VerificationResult,
} from './test-runner.js';

// Documentation
export {
  generateDebugDoc,
  type DebugData,
} from './documentation.js';

// Progress update
export {
  appendFixTasks,
  createProgressContent,
  type FixTask,
} from './progress-update.js';

// Directory
export {
  selectDirectory,
  createBugfixDirName,
  sanitizeDirName,
} from './directory.js';

// Compatibility
export {
  formatForBuild,
  getCommandChainSuggestion,
  type BuildTasks,
  type BuildPhase,
} from './compatibility.js';

// Logging
export {
  formatDebugLogEntry,
  type DebugEvent,
  type DebugPhase,
} from './logging.js';

// Notifications
export {
  createDebugNotification,
  type DebugNotificationEvent,
  type DebugNotificationParams,
} from './notifications.js';

// Plugin
export {
  validateCommandFile,
  type ValidationResult,
} from './plugin.js';
