/**
 * Investigation - Agent Delegation
 * Creates tasks for debugger agent and parses results
 */
import type { ParsedBug } from './bug-parser.js';
export interface TaskParams {
    subagent_type: string;
    prompt: string;
}
export interface RootCause {
    cause: string;
    evidence: string;
}
/**
 * Create investigation task for debugger agent
 */
export declare function createInvestigationTask(bug: ParsedBug): TaskParams;
/**
 * Parse investigation results into root causes
 */
export declare function parseInvestigationResult(output: string): RootCause[];
//# sourceMappingURL=investigation.d.ts.map