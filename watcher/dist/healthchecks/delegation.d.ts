import type { CheckResult } from '../types.js';
interface DelegationCheckOptions {
    sessionLogPath: string;
    sessionActive?: boolean;
}
export declare function checkDelegation(options: DelegationCheckOptions): Promise<CheckResult>;
export {};
//# sourceMappingURL=delegation.d.ts.map