/**
 * GitMonitor - Monitor git branch for IRON LAW #4 violations
 *
 * Detects when the current branch is main/master, which violates
 * the rule that agents must never push to protected branches.
 */

import { execSync } from 'child_process';
import { Issue } from './state-manager.js';

export interface GitBranchResult {
  branch: string;
  isProtected: boolean;
}

const PROTECTED_BRANCHES = ['main', 'master'];

export class GitMonitor {
  /**
   * Get current git branch name
   */
  async getCurrentBranch(): Promise<string> {
    const output = execSync('git branch --show-current', {
      encoding: 'utf-8',
      timeout: 5000
    });
    return output.trim();
  }

  /**
   * Check if on a protected branch and return issue if so
   */
  async checkBranch(): Promise<Issue | null> {
    try {
      const branch = await this.getCurrentBranch();

      if (PROTECTED_BRANCHES.includes(branch)) {
        return {
          type: 'branch_violation',
          message: `On ${branch} branch - IRON LAW #4 violation`,
          severity: 'error'
        };
      }

      return null;
    } catch {
      // Git not available or not in a repo
      return null;
    }
  }
}
