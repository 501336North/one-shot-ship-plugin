/**
 * Bug Input Parser
 * Parses error messages, stack traces, and descriptions from user input
 */
export interface BugInput {
    type: 'error';
    errorType: string;
    message: string;
}
export interface StackFrame {
    function: string;
    file: string;
    line: number;
    column: number;
}
export interface BugDescription {
    component?: string;
    expected?: string;
    actual?: string;
}
export interface ParsedBug {
    type: 'error';
    errorType: string;
    message?: string;
    component?: string;
    expected?: string;
    actual?: string;
}
/**
 * Parse error message input
 */
export declare function parseInput(input: string): BugInput;
/**
 * Parse stack trace into frames
 */
export declare function parseStackTrace(trace: string): StackFrame[];
/**
 * Parse natural language description
 */
export declare function parseDescription(text: string): BugDescription;
/**
 * Merge error input with description context
 */
export declare function mergeInputs(error: BugInput, description: BugDescription): ParsedBug;
//# sourceMappingURL=bug-parser.d.ts.map