/**
 * Bug Input Parser
 * Parses error messages, stack traces, and descriptions from user input
 */
/**
 * Parse error message input
 */
export function parseInput(input) {
    const match = input.match(/^(\w+Error):\s*(.+)$/);
    if (!match) {
        throw new Error('Invalid error format');
    }
    return {
        type: 'error',
        errorType: match[1],
        message: match[2],
    };
}
/**
 * Parse stack trace into frames
 */
export function parseStackTrace(trace) {
    const lines = trace.split('\n');
    const frames = [];
    for (const line of lines) {
        const match = line.match(/at\s+(\w+)\s+\(([^:]+):(\d+):(\d+)\)/);
        if (match) {
            frames.push({
                function: match[1],
                file: match[2],
                line: parseInt(match[3], 10),
                column: parseInt(match[4], 10),
            });
        }
    }
    return frames;
}
/**
 * Parse natural language description
 */
export function parseDescription(text) {
    const result = {};
    // Extract component (simple keyword matching)
    const componentMatch = text.match(/\b(login|auth|payment|user|form|dashboard|api)\b/i);
    if (componentMatch) {
        result.component = componentMatch[1].toLowerCase();
    }
    // Extract expected vs actual
    const behaviorMatch = text.match(/show\s+(.+?)\s+but\s+shows\s+(.+)/i);
    if (behaviorMatch) {
        result.expected = behaviorMatch[1].trim();
        result.actual = behaviorMatch[2].trim();
    }
    return result;
}
/**
 * Merge error input with description context
 */
export function mergeInputs(error, description) {
    return {
        type: error.type,
        errorType: error.errorType,
        message: error.message,
        component: description.component,
        expected: description.expected,
        actual: description.actual,
    };
}
//# sourceMappingURL=bug-parser.js.map