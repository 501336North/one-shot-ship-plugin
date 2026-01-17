/**
 * @file Benchmark Task Type Definitions
 * @description Types for model quality benchmarking system
 */

/**
 * Categories of benchmark tasks
 */
export type TaskCategory = 'code-review' | 'bug-fix' | 'test-writing' | 'refactoring';

/**
 * Dimensions for evaluating model output quality
 */
export type QualityDimension = 'correctness' | 'completeness' | 'style' | 'efficiency';

/**
 * A benchmark task used to evaluate model quality
 */
export interface BenchmarkTask {
  /** Unique identifier for the task */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category of the task */
  category: TaskCategory;
  /** The prompt to send to the model */
  prompt: string;
  /** Expected behaviors/patterns in the output */
  expectedBehavior: string[];
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * Quality scores for a benchmark result
 */
export interface QualityScores {
  /** Score for correctness (0-100) */
  correctness: number;
  /** Score for completeness (0-100) */
  completeness: number;
  /** Score for style/formatting (0-100) */
  style: number;
  /** Score for efficiency (0-100) */
  efficiency: number;
  /** Overall weighted score (0-100) */
  overall: number;
  /** Optional reasoning for each dimension */
  reasoning?: Record<QualityDimension, string>;
}

/**
 * Result of running a benchmark task against a model
 */
export interface BenchmarkResult {
  /** ID of the task that was run */
  taskId: string;
  /** Provider name (e.g., 'openai', 'anthropic') */
  provider: string;
  /** Model identifier */
  model: string;
  /** Raw output from the model */
  output: string;
  /** Number of input tokens consumed */
  inputTokens: number;
  /** Number of output tokens generated */
  outputTokens: number;
  /** Time to generate response in milliseconds */
  latencyMs: number;
  /** ISO timestamp of when the benchmark was run */
  timestamp: string;
  /** Optional quality scores */
  scores?: QualityScores;
}
