import type { CheckResult } from '../types.js';
/**
 * Check git safety: verify agents never push directly to main (IRON LAW #4)
 */
export declare function checkGitSafety(): Promise<CheckResult>;
//# sourceMappingURL=git-safety.d.ts.map