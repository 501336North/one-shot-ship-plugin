import { AnomalyType, Priority, TaskContext } from '../types.js';
/**
 * Result of a rule match
 */
export interface RuleMatch {
    anomaly_type: AnomalyType;
    priority: Priority;
    context: Partial<TaskContext>;
    suggested_agent: string;
    prompt: string;
}
/**
 * Rule Engine - Fast pattern-based anomaly detection
 *
 * Detects common issues in <10ms via hardcoded regex rules.
 * Falls back to LLM analysis for subtle issues (separate component).
 */
export declare class RuleEngine {
    private readonly loopThreshold;
    constructor(loopThreshold?: number);
    /**
     * Analyze log text for anomalies
     * @returns RuleMatch if anomaly detected, null otherwise
     */
    analyze(log: string): RuleMatch | null;
    /**
     * Detect agent loop pattern (same tool called repeatedly)
     */
    private detectLoop;
}
//# sourceMappingURL=rules.d.ts.map