import type { CreateTaskInput } from '../types.js';
export interface IronLawResult {
    law: number;
    message: string;
    passed: boolean;
}
export interface IronLawViolationRecord {
    law: number;
    message: string;
    correction?: string;
    timestamp: string;
}
export declare class IronLawLogParser {
    private violations;
    private history;
    isIronLawCheck(line: string): boolean;
    isIronLawCheckPassed(line: string): boolean;
    parseViolation(line: string): IronLawResult | null;
    parsePass(line: string): IronLawResult | null;
    extractCorrectionHint(line: string): string | null;
    recordViolation(law: number, message: string, correction?: string): void;
    getViolationCount(law: number): number;
    recordPass(law: number): void;
    getViolationHistory(law: number): IronLawViolationRecord[];
    reset(): void;
    createInterventionTask(law: number, message: string, correction?: string): CreateTaskInput | null;
}
//# sourceMappingURL=iron-law-log-parser.d.ts.map