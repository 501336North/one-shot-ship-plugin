/**
 * Severity Inference
 * Infers bug severity from error type and context
 */
import type { ParsedBug } from './bug-parser.js';
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';
export interface SeverityResult {
    severity: SeverityLevel;
    confidence: number;
}
export interface QuestionParams {
    question: string;
    header: string;
    options: Array<{
        label: string;
        description: string;
    }>;
}
/**
 * Infer severity from bug details
 */
export declare function inferSeverity(bug: Partial<ParsedBug>): SeverityResult;
/**
 * Create override question if confidence is low
 */
export declare function createSeverityQuestion(inferred: SeverityResult): QuestionParams | null;
//# sourceMappingURL=severity.d.ts.map