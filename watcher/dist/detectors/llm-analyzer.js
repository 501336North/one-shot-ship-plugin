import { readApiCredentials } from '../api/api-credentials.js';
import { withDeadline } from '../api/with-deadline.js';
/** How long an analyze request, body included, may take before it is abandoned (FR14) */
export const LLM_ANALYZE_TIMEOUT_MS = 10_000;
/**
 * LLM Analyzer - Fallback analysis for anomalies rules miss
 *
 * Implements AC-006.1 through AC-006.5 from REQUIREMENTS.md
 */
export class LLMAnalyzer {
    queueManager;
    ruleEngine;
    confidenceThreshold;
    requestTimeoutMs;
    constructor(queueManager, ruleEngine, confidenceThreshold = 0.7, requestTimeoutMs = LLM_ANALYZE_TIMEOUT_MS) {
        this.queueManager = queueManager;
        this.ruleEngine = ruleEngine;
        this.confidenceThreshold = confidenceThreshold;
        this.requestTimeoutMs = requestTimeoutMs;
    }
    /**
     * Analyze log content - first with rules, then LLM if needed
     */
    async analyze(logContent) {
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
    async analyzeAndReport(logContent) {
        const result = await this.analyze(logContent);
        if (result) {
            const task = {
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
    async analyzeLLM(logContent) {
        // The key and the API it may go to, from the OSS config; nothing is sent when it is refused
        const credentials = readApiCredentials();
        if (!credentials)
            return null;
        try {
            // a server that never answers, or stalls mid-body, must not hang the analyzer (FR14, SR10)
            const data = await withDeadline(this.requestTimeoutMs, async (signal) => {
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
                    signal,
                });
                // Graceful fallback - null on an error status
                return response.ok ? (await response.json()) : null;
            });
            if (data === null) {
                return null;
            }
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
        }
        catch {
            // Graceful fallback - return null on any error
            return null;
        }
    }
}
//# sourceMappingURL=llm-analyzer.js.map