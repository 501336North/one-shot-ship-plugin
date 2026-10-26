import { QueueManager } from '../queue/manager.js';
import { RuleEngine, RuleMatch } from './rules.js';
import { AnomalyType, Priority, CreateTaskInput, TaskContext } from '../types.js';
import { readApiCredentials } from '../api/api-credentials.js';

/**
 * LLM Analysis response
 */
interface LLMResponse {
  anomaly_detected: boolean;
  anomaly_type?: AnomalyType;
  priority?: Priority;
  analysis?: string;
  confidence?: number;
  suggested_agent?: string;
  prompt?: string;
}

/**
 * LLM Analysis result
 */
export interface LLMAnalysisResult {
  anomaly_type: AnomalyType;
  priority: Priority;
  context: Partial<TaskContext>;
  suggested_agent: string;
  prompt: string;
}

/**
 * LLM Analyzer - Fallback analysis for anomalies rules miss
 *
 * Implements AC-006.1 through AC-006.5 from REQUIREMENTS.md
 */
export class LLMAnalyzer {
  private readonly queueManager: QueueManager;
  private readonly ruleEngine: RuleEngine;
  private readonly confidenceThreshold: number;

  constructor(queueManager: QueueManager, ruleEngine: RuleEngine, confidenceThreshold: number = 0.7) {
    this.queueManager = queueManager;
    this.ruleEngine = ruleEngine;
    this.confidenceThreshold = confidenceThreshold;
  }

  /**
   * Analyze log content - first with rules, then LLM if needed
   */
  async analyze(logContent: string): Promise<LLMAnalysisResult | RuleMatch | null> {
    // First try rule engine (fast path)
    const ruleMatch = this.ruleEngine.analyze(logContent);
    if (ruleMatch) {
      return ruleMatch;
    }

    // Fall back to LLM analysis
    return this.analyzeLLM(logContent);
  }

  /**
   * Analyze with LLM and create task if anomaly detected
   */
  async analyzeAndReport(logContent: string): Promise<void> {
    const result = await this.analyze(logContent);
    if (result) {
      const task: CreateTaskInput = {
        priority: result.priority,
        source: 'log-monitor',
        anomaly_type: result.anomaly_type,
        prompt: result.prompt,
        suggested_agent: result.suggested_agent,
        context: result.context,
      };

      await this.queueManager.addTask(task);
    }
  }

  /**
   * Analyze using LLM API
   */
  private async analyzeLLM(logContent: string): Promise<LLMAnalysisResult | null> {
    // The key and the API it may go to, from the OSS config; nothing is sent when it is refused
    const credentials = readApiCredentials();
    if (!credentials) return null;

    try {
      const response = await fetch(`${credentials.apiUrl}/api/v1/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${credentials.apiKey}`,
        },
        body: JSON.stringify({
          log_content: logContent,
        }),
        // never replay the Bearer key to a redirect target
        redirect: 'error',
        // a server that never answers must not hang the analyzer (FR14; as custom-command-executor)
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        // Graceful fallback - return null on error
        return null;
      }

      const data = await response.json() as LLMResponse;

      // No anomaly detected
      if (!data.anomaly_detected) {
        return null;
      }

      // Validate response has required fields
      if (!data.anomaly_type || !data.priority || !data.suggested_agent || !data.prompt) {
        return null;
      }

      // Filter low confidence results
      const confidence = data.confidence ?? 0;
      if (confidence < this.confidenceThreshold) {
        return null;
      }

      return {
        anomaly_type: data.anomaly_type,
        priority: data.priority,
        context: {
          analysis: data.analysis,
          confidence: data.confidence,
          log_excerpt: logContent.slice(0, 300),
        },
        suggested_agent: data.suggested_agent,
        prompt: data.prompt,
      };
    } catch {
      // Graceful fallback - return null on any error
      return null;
    }
  }
}
