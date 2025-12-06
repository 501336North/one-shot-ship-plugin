import { QueueManager } from '../queue/manager.js';
import { RuleEngine, RuleMatch } from './rules.js';
import { AnomalyType, Priority, CreateTaskInput, TaskContext } from '../types.js';

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
  private readonly apiKey: string;
  private readonly confidenceThreshold: number;
  private readonly apiUrl: string;

  constructor(
    queueManager: QueueManager,
    ruleEngine: RuleEngine,
    apiKey: string,
    confidenceThreshold: number = 0.7,
    apiUrl: string = 'https://one-shot-ship-api.onrender.com/api/v1/analyze'
  ) {
    this.queueManager = queueManager;
    this.ruleEngine = ruleEngine;
    this.apiKey = apiKey;
    this.confidenceThreshold = confidenceThreshold;
    this.apiUrl = apiUrl;
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
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          log_content: logContent,
        }),
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
