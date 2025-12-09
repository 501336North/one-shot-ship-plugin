import type { CheckResult } from '../types.js';
interface LoggingCheckOptions {
    sessionLogPath: string;
    sessionActive?: boolean;
}
export declare function checkLogging(options: LoggingCheckOptions): Promise<CheckResult>;
export {};
//# sourceMappingURL=logging.d.ts.map