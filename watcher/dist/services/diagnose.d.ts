/**
 * Diagnose Service
 *
 * Analyzes command failures and provides actionable recovery guidance.
 * Implements Stripe-style error experience with pattern matching
 * and self-service recovery suggestions.
 */
interface AnalyzeInput {
    command: string;
    exitCode: number;
    output: string;
}
interface DiagnosisResult {
    errorCode: string;
    category: string;
    message: string;
    cause: string;
    recovery: string[];
    relatedCommands: string[];
    confidence: number;
    learnMore: string;
}
export declare class DiagnoseService {
    private registry;
    private patterns;
    constructor();
    private initializePatterns;
    /**
     * Analyze command output and diagnose the error
     */
    analyze(input: AnalyzeInput): DiagnosisResult;
    private createUnknownErrorResult;
    /**
     * Format diagnosis as a readable report
     */
    formatReport(result: DiagnosisResult): string;
    /**
     * Get quick suggestion for common errors
     */
    getQuickFix(errorCode: string): string | undefined;
}
export {};
//# sourceMappingURL=diagnose.d.ts.map