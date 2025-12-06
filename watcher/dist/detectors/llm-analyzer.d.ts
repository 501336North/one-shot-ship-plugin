import { QueueManager } from '../queue/manager.js';
import { RuleEngine, RuleMatch } from './rules.js';
import { AnomalyType, Priority, TaskContext } from '../types.js';
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
export declare class LLMAnalyzer {
    private readonly queueManager;
    private readonly ruleEngine;
    private readonly apiKey;
    private readonly confidenceThreshold;
    private readonly apiUrl;
    constructor(queueManager: QueueManager, ruleEngine: RuleEngine, apiKey: string, confidenceThreshold?: number, apiUrl?: string);
    /**
     * Analyze log content - first with rules, then LLM if needed
     */
    analyze(logContent: string): Promise<LLMAnalysisResult | RuleMatch | null>;
    /**
     * Analyze with LLM and create task if anomaly detected
     */
    analyzeAndReport(logContent: string): Promise<void>;
    /**
     * Analyze using LLM API
     */
    private analyzeLLM;
}
//# sourceMappingURL=llm-analyzer.d.ts.map