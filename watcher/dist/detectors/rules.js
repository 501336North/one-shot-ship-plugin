/**
 * Hardcoded rules for fast anomaly detection
 *
 * Implements AC-005.1 through AC-005.5 from REQUIREMENTS.md
 */
const RULES = [
    // Test failure - FAIL pattern
    {
        name: 'test_failure_fail',
        pattern: /FAIL\s+(\S+\.test\.[tj]sx?)/i,
        anomaly_type: 'test_failure',
        priority: 'high',
        suggested_agent: 'debugger',
        extractContext: (match) => ({
            test_file: match[1],
            log_excerpt: match[0],
        }),
        generatePrompt: (ctx) => `Fix the failing test in ${ctx.test_file}. Analyze the test failure and implement the necessary fix.`,
    },
    // Test failure - vitest pattern
    {
        name: 'test_failure_vitest',
        pattern: /❯\s+(\S+\.test\.[tj]sx?)\s+\([^)]*\d+\s+failed/,
        anomaly_type: 'test_failure',
        priority: 'high',
        suggested_agent: 'debugger',
        extractContext: (match) => ({
            test_file: match[1],
            log_excerpt: match[0],
        }),
        generatePrompt: (ctx) => `Fix the failing test in ${ctx.test_file}. Analyze the test failure and implement the necessary fix.`,
    },
    // Test failure - generic
    {
        name: 'test_failure_generic',
        pattern: /Test failed:?\s*(.+)/i,
        anomaly_type: 'test_failure',
        priority: 'high',
        suggested_agent: 'debugger',
        extractContext: (match) => ({
            test_name: match[1],
            log_excerpt: match[0],
        }),
        generatePrompt: (ctx) => `Fix the failing test: "${ctx.test_name}". Analyze the test failure and implement the necessary fix.`,
    },
    // Agent stuck - timeout
    {
        name: 'agent_stuck_timeout',
        pattern: /(?:Command\s+)?timed?\s*out\s+(?:after\s+)?(\d+)/i,
        anomaly_type: 'agent_stuck',
        priority: 'high',
        suggested_agent: 'debugger',
        extractContext: (match) => ({
            log_excerpt: match[0],
        }),
        generatePrompt: () => `Investigate the command timeout. Check if the process is hung or if there's an infinite loop.`,
    },
    // Agent stuck - no output
    {
        name: 'agent_stuck_no_output',
        pattern: /no\s+output\s+(?:received\s+)?(?:for\s+)?(\d+)\s*(?:seconds?|s)/i,
        anomaly_type: 'agent_stuck',
        priority: 'high',
        suggested_agent: 'debugger',
        extractContext: (match) => ({
            log_excerpt: match[0],
        }),
        generatePrompt: () => `Investigate why there's no output. The process may be stuck or waiting for input.`,
    },
    // CI failure - emoji
    {
        name: 'ci_failure_emoji',
        pattern: /❌\s*(?:CI|Build|Pipeline)[:\s]+(.+)/i,
        anomaly_type: 'ci_failure',
        priority: 'high',
        suggested_agent: 'deployment-engineer',
        extractContext: (match) => ({
            log_excerpt: match[0],
        }),
        generatePrompt: (ctx) => `CI pipeline failed. Investigate the failure: ${ctx.log_excerpt}`,
    },
    // CI failure - text
    {
        name: 'ci_failure_text',
        pattern: /(?:CI|build)\s+failed/i,
        anomaly_type: 'ci_failure',
        priority: 'high',
        suggested_agent: 'deployment-engineer',
        extractContext: (match) => ({
            log_excerpt: match[0],
        }),
        generatePrompt: () => `CI/Build failed. Investigate the failure and fix the underlying issue.`,
    },
    // PR check failed
    {
        name: 'pr_check_failed',
        pattern: /PR\s+check\s+failed/i,
        anomaly_type: 'pr_check_failed',
        priority: 'high',
        suggested_agent: 'deployment-engineer',
        extractContext: (match) => ({
            log_excerpt: match[0],
        }),
        generatePrompt: () => `PR check failed. Review the check failure and address the issues.`,
    },
    // Push failed
    {
        name: 'push_failed',
        pattern: /(?:error:\s*)?failed\s+to\s+push/i,
        anomaly_type: 'push_failed',
        priority: 'high',
        suggested_agent: 'deployment-engineer',
        extractContext: (match) => ({
            log_excerpt: match[0],
        }),
        generatePrompt: () => `Git push failed. Check for remote conflicts or permission issues.`,
    },
    // Exception with stack trace (has "at" line)
    {
        name: 'exception_with_stack',
        pattern: /(?:TypeError|ReferenceError|SyntaxError|RangeError):\s*(.+?)(?:\n\s+at\s+\S+\s+\(([^:]+):(\d+))/,
        anomaly_type: 'exception',
        priority: 'medium',
        suggested_agent: 'debugger',
        extractContext: (match, fullText) => {
            const ctx = {
                log_excerpt: match[0].slice(0, 200),
            };
            // Try to extract file and line from stack trace
            const stackMatch = fullText.match(/at\s+\S+\s+\(([^:]+):(\d+)/);
            if (stackMatch) {
                ctx.file = stackMatch[1];
                ctx.line = parseInt(stackMatch[2], 10);
            }
            else if (match[2] && match[3]) {
                ctx.file = match[2];
                ctx.line = parseInt(match[3], 10);
            }
            return ctx;
        },
        generatePrompt: (ctx) => {
            let prompt = `Fix the error: ${ctx.log_excerpt}`;
            if (ctx.file) {
                prompt += ` in ${ctx.file}`;
                if (ctx.line) {
                    prompt += `:${ctx.line}`;
                }
            }
            return prompt;
        },
    },
    // Generic Error: pattern (no stack trace)
    {
        name: 'error_generic',
        pattern: /(?:TypeError|ReferenceError|SyntaxError|RangeError|Error):\s*(.+)/i,
        anomaly_type: 'exception',
        priority: 'medium',
        suggested_agent: 'debugger',
        extractContext: (match) => ({
            log_excerpt: match[0].slice(0, 300),
        }),
        generatePrompt: (ctx) => `Investigate and fix the error: ${ctx.log_excerpt}`,
    },
];
/**
 * Rule Engine - Fast pattern-based anomaly detection
 *
 * Detects common issues in <10ms via hardcoded regex rules.
 * Falls back to LLM analysis for subtle issues (separate component).
 */
export class RuleEngine {
    loopThreshold;
    constructor(loopThreshold = 5) {
        this.loopThreshold = loopThreshold;
    }
    /**
     * Analyze log text for anomalies
     * @returns RuleMatch if anomaly detected, null otherwise
     */
    analyze(log) {
        if (!log || !log.trim()) {
            return null;
        }
        // Check for loop pattern first (requires counting)
        const loopMatch = this.detectLoop(log);
        if (loopMatch) {
            return loopMatch;
        }
        // Check each rule
        for (const rule of RULES) {
            const match = log.match(rule.pattern);
            if (match) {
                const context = rule.extractContext(match, log);
                return {
                    anomaly_type: rule.anomaly_type,
                    priority: rule.priority,
                    context,
                    suggested_agent: rule.suggested_agent,
                    prompt: rule.generatePrompt(context, match),
                };
            }
        }
        return null;
    }
    /**
     * Detect agent loop pattern (same tool called repeatedly)
     */
    detectLoop(log) {
        // Pattern: Tool: <ToolName> ...
        const toolPattern = /Tool:\s*(\w+)/g;
        const toolCalls = {};
        let match;
        while ((match = toolPattern.exec(log)) !== null) {
            const toolName = match[1];
            toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
        }
        // Find tool with most repetitions
        let maxTool = '';
        let maxCount = 0;
        for (const [tool, count] of Object.entries(toolCalls)) {
            if (count > maxCount) {
                maxCount = count;
                maxTool = tool;
            }
        }
        if (maxCount >= this.loopThreshold) {
            return {
                anomaly_type: 'agent_loop',
                priority: 'high',
                context: {
                    tool_name: maxTool,
                    repeat_count: maxCount,
                    log_excerpt: `Tool ${maxTool} called ${maxCount} times`,
                },
                suggested_agent: 'debugger',
                prompt: `Detected agent loop: ${maxTool} was called ${maxCount} times. Investigate and break the loop.`,
            };
        }
        return null;
    }
}
//# sourceMappingURL=rules.js.map