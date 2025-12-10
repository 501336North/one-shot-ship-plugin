import type { CheckResult } from '../types.js';
/**
 * Check git safety: verify agents are using feature branches (IRON LAW #4)
 *
 * This check verifies:
 * 1. Not currently on main/master branch
 * 2. Agent commits are going through PRs (merged commits are OK)
 *
 * Note: Agent commits on main that came through PR merges are ALLOWED.
 * Only direct pushes to main (non-merge commits) are violations.
 */
export declare function checkGitSafety(): Promise<CheckResult>;
//# sourceMappingURL=git-safety.d.ts.map