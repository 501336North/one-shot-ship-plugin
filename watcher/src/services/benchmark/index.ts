/**
 * @file Benchmark Module Exports
 * @description Public API for the benchmark system
 */

// Types
export type {
  TaskCategory,
  QualityDimension,
  BenchmarkTask,
  BenchmarkResult,
  QualityScores,
} from './types.js';

// Registry
export { BenchmarkTaskRegistry, type ValidationResult } from './task-registry.js';

// Standard Tasks
export {
  CODE_REVIEW_TASK,
  BUG_FIX_TASK,
  TEST_WRITING_TASK,
  REFACTORING_TASK,
  STANDARD_TASKS,
  createStandardRegistry,
} from './standard-tasks.js';

// Runner
export {
  BenchmarkRunner,
  type ProviderConfig,
  type BenchmarkRunnerConfig,
  type BenchmarkRunOptions,
  type BenchmarkRun,
  type BenchmarkSummary,
  type ProviderSummary,
} from './runner.js';

// Evaluator
export {
  EVALUATION_PROMPT,
  LLMJudgeEvaluator,
  AutomatedEvaluator,
  CompositeEvaluator,
  type EvaluationRequest,
  type EvaluationResult,
  type Evaluator,
  type LLMJudgeConfig,
  type CompositeEvaluatorConfig,
} from './evaluator.js';

// Reporter
export {
  BenchmarkReporter,
  type BenchmarkReport,
  type ReportSummary,
  type ProviderReport,
  type TaskReport,
  type TaskProviderResult,
  type ClaimValidation,
  type ProviderClaimResult,
} from './reporter.js';

// Provider Integrations
export {
  ClaudeIntegration,
  type ClaudeIntegrationConfig,
  type ClaudeTaskResult,
} from './claude-integration.js';

export {
  OllamaIntegration,
  type OllamaIntegrationConfig,
  type OllamaTaskResult,
} from './ollama-integration.js';

export {
  OpenRouterIntegration,
  type OpenRouterIntegrationConfig,
  type OpenRouterTaskResult,
} from './openrouter-integration.js';

// Execution
export {
  BenchmarkExecutor,
  type BenchmarkExecutorConfig,
  type ExecutionResult,
  type ProviderExecutionResult,
  type ProviderSummary as ExecutorProviderSummary,
  type BenchmarkSuiteResult,
} from './execution.js';

// Analysis
export {
  BenchmarkAnalyzer,
  type AnalysisReport,
  type ProviderAnalysis,
  type ClaimVerdict,
  type ProviderClaimResult as AnalysisProviderClaimResult,
} from './analysis.js';
