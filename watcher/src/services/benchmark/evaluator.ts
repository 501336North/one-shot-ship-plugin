/**
 * @file Quality Evaluator
 * @description Scores model outputs using LLM-as-judge and automated metrics
 *
 * @behavior QualityEvaluator provides multiple evaluation strategies for benchmark outputs
 * @acceptance-criteria AC-EVAL.1 through AC-EVAL.4
 */

import type { BenchmarkTask, QualityScores, QualityDimension } from './types.js';

/**
 * Evaluation prompt template for LLM-as-Judge
 */
export const EVALUATION_PROMPT = `You are a code quality evaluator. Compare the CANDIDATE output against the REFERENCE.

TASK: {task.name}
PROMPT: {task.prompt}

REFERENCE OUTPUT (baseline):
{referenceOutput}

CANDIDATE OUTPUT ({provider}):
{candidateOutput}

EXPECTED BEHAVIORS:
{expectedBehaviors}

Score the candidate on these dimensions (0-100 each):
1. Correctness: Does it solve the problem correctly?
2. Completeness: Does it address all aspects?
3. Style: Is it well-formatted and clear?
4. Efficiency: Is the solution efficient?

Respond ONLY with valid JSON:
{
  "correctness": { "score": 0-100, "reasoning": "..." },
  "completeness": { "score": 0-100, "reasoning": "..." },
  "style": { "score": 0-100, "reasoning": "..." },
  "efficiency": { "score": 0-100, "reasoning": "..." },
  "overall": 0-100
}`;

/**
 * Request for evaluating a model output
 */
export interface EvaluationRequest {
  /** The benchmark task that was executed */
  task: BenchmarkTask;
  /** Reference output (Claude baseline) */
  referenceOutput: string;
  /** Candidate output to evaluate */
  candidateOutput: string;
  /** Provider name */
  provider: string;
}

/**
 * Result of an evaluation
 */
export interface EvaluationResult {
  /** ID of the evaluated task */
  taskId: string;
  /** Provider that produced the candidate output */
  provider: string;
  /** Quality scores */
  scores: QualityScores;
  /** ISO timestamp of evaluation */
  evaluatedAt: string;
  /** Type of evaluator used */
  evaluatorType: 'llm' | 'automated' | 'composite';
}

/**
 * Common interface for all evaluators
 */
export interface Evaluator {
  evaluate(request: EvaluationRequest): Promise<EvaluationResult>;
}

/**
 * Configuration for LLMJudgeEvaluator
 */
export interface LLMJudgeConfig {
  /** Endpoint URL for the judge LLM */
  judgeEndpoint: string;
  /** Optional API key */
  apiKey?: string;
  /** Model to use for judging (default: claude-3-haiku) */
  judgeModel?: string;
}

/**
 * Parsed response from LLM judge
 */
interface JudgeResponse {
  correctness: { score: number; reasoning: string };
  completeness: { score: number; reasoning: string };
  style: { score: number; reasoning: string };
  efficiency: { score: number; reasoning: string };
  overall: number;
}

/**
 * LLM-as-Judge Evaluator
 * Uses an LLM to compare candidate output against reference
 */
export class LLMJudgeEvaluator implements Evaluator {
  private judgeEndpoint: string;
  private apiKey?: string;
  private judgeModel: string;

  constructor(config: LLMJudgeConfig) {
    this.judgeEndpoint = config.judgeEndpoint;
    this.apiKey = config.apiKey;
    this.judgeModel = config.judgeModel ?? 'claude-3-haiku-20240307';
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
    const { task, referenceOutput, candidateOutput, provider } = request;

    try {
      // Format the evaluation prompt
      const prompt = this.formatPrompt(task, referenceOutput, candidateOutput, provider);

      // Call the judge API
      const response = await fetch(this.judgeEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.judgeModel,
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        return this.createFailureResult(task.id, provider);
      }

      const data = (await response.json()) as {
        content?: Array<{ text?: string }>;
      };
      const outputText = data.content?.[0]?.text ?? '';

      // Parse the JSON response
      const judgeResult = this.parseJudgeResponse(outputText);

      return {
        taskId: task.id,
        provider,
        scores: {
          correctness: judgeResult.correctness.score,
          completeness: judgeResult.completeness.score,
          style: judgeResult.style.score,
          efficiency: judgeResult.efficiency.score,
          overall: judgeResult.overall,
          reasoning: {
            correctness: judgeResult.correctness.reasoning,
            completeness: judgeResult.completeness.reasoning,
            style: judgeResult.style.reasoning,
            efficiency: judgeResult.efficiency.reasoning,
          },
        },
        evaluatedAt: new Date().toISOString(),
        evaluatorType: 'llm',
      };
    } catch {
      return this.createFailureResult(task.id, provider);
    }
  }

  private formatPrompt(
    task: BenchmarkTask,
    referenceOutput: string,
    candidateOutput: string,
    provider: string
  ): string {
    return EVALUATION_PROMPT.replace('{task.name}', task.name)
      .replace('{task.prompt}', task.prompt)
      .replace('{referenceOutput}', referenceOutput)
      .replace('{candidateOutput}', candidateOutput)
      .replace('{provider}', provider)
      .replace('{expectedBehaviors}', task.expectedBehavior.join('\n'));
  }

  private parseJudgeResponse(text: string): JudgeResponse {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      return JSON.parse(jsonMatch[0]) as JudgeResponse;
    } catch {
      // Return default failure response
      return {
        correctness: { score: 0, reasoning: 'Failed to parse response' },
        completeness: { score: 0, reasoning: 'Failed to parse response' },
        style: { score: 0, reasoning: 'Failed to parse response' },
        efficiency: { score: 0, reasoning: 'Failed to parse response' },
        overall: 0,
      };
    }
  }

  private createFailureResult(taskId: string, provider: string): EvaluationResult {
    return {
      taskId,
      provider,
      scores: {
        correctness: 0,
        completeness: 0,
        style: 0,
        efficiency: 0,
        overall: 0,
      },
      evaluatedAt: new Date().toISOString(),
      evaluatorType: 'llm',
    };
  }
}

/**
 * Automated Evaluator
 * Uses pattern matching to score outputs based on expected behaviors
 */
export class AutomatedEvaluator implements Evaluator {
  async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
    const { task, candidateOutput, provider } = request;

    // Handle empty or null outputs
    if (!candidateOutput || candidateOutput.trim() === '') {
      return {
        taskId: task.id,
        provider,
        scores: {
          correctness: 0,
          completeness: 0,
          style: 0,
          efficiency: 0,
          overall: 0,
        },
        evaluatedAt: new Date().toISOString(),
        evaluatorType: 'automated',
      };
    }

    // Calculate pattern match score
    const score = this.calculatePatternScore(task.expectedBehavior, candidateOutput);

    return {
      taskId: task.id,
      provider,
      scores: {
        // For automated evaluation, we use the pattern score for all dimensions
        correctness: score,
        completeness: score,
        style: score,
        efficiency: score,
        overall: score,
      },
      evaluatedAt: new Date().toISOString(),
      evaluatorType: 'automated',
    };
  }

  private calculatePatternScore(patterns: string[], output: string): number {
    if (patterns.length === 0) {
      return 100; // No patterns to match = full score
    }

    const lowerOutput = output.toLowerCase();
    let matches = 0;

    for (const pattern of patterns) {
      if (lowerOutput.includes(pattern.toLowerCase())) {
        matches++;
      }
    }

    return Math.round((matches / patterns.length) * 100);
  }
}

/**
 * Configuration for CompositeEvaluator
 */
export interface CompositeEvaluatorConfig {
  /** Weight for LLM judge score (default: 0.7) */
  llmWeight?: number;
  /** Weight for automated metrics (default: 0.3) */
  automatedWeight?: number;
  /** Optional pre-configured LLM evaluator */
  llmEvaluator?: LLMJudgeEvaluator;
}

/**
 * Composite Evaluator
 * Combines LLM-as-judge with automated metrics
 */
export class CompositeEvaluator implements Evaluator {
  private llmWeight: number;
  private automatedWeight: number;
  private llmEvaluator?: LLMJudgeEvaluator;
  private automatedEvaluator: AutomatedEvaluator;

  constructor(config: CompositeEvaluatorConfig = {}) {
    this.llmWeight = config.llmWeight ?? 0.7;
    this.automatedWeight = config.automatedWeight ?? 0.3;
    this.llmEvaluator = config.llmEvaluator;
    this.automatedEvaluator = new AutomatedEvaluator();
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
    // Get automated score first (always available)
    const automatedResult = await this.automatedEvaluator.evaluate(request);

    // Get LLM judge score if evaluator is configured
    let llmResult: EvaluationResult | undefined;
    if (this.llmEvaluator) {
      llmResult = await this.llmEvaluator.evaluate(request);
    }

    // Combine scores
    const llmScore = llmResult?.scores.overall ?? 0;
    const autoScore = automatedResult.scores.overall;

    const combinedOverall = Math.round(llmScore * this.llmWeight + autoScore * this.automatedWeight);

    // Combine dimension scores
    const llmScores = llmResult?.scores ?? {
      correctness: 0,
      completeness: 0,
      style: 0,
      efficiency: 0,
      overall: 0,
    };

    return {
      taskId: request.task.id,
      provider: request.provider,
      scores: {
        correctness: Math.round(
          llmScores.correctness * this.llmWeight + automatedResult.scores.correctness * this.automatedWeight
        ),
        completeness: Math.round(
          llmScores.completeness * this.llmWeight + automatedResult.scores.completeness * this.automatedWeight
        ),
        style: Math.round(llmScores.style * this.llmWeight + automatedResult.scores.style * this.automatedWeight),
        efficiency: Math.round(
          llmScores.efficiency * this.llmWeight + automatedResult.scores.efficiency * this.automatedWeight
        ),
        overall: combinedOverall,
        reasoning: llmResult?.scores.reasoning,
      },
      evaluatedAt: new Date().toISOString(),
      evaluatorType: 'composite',
    };
  }
}
