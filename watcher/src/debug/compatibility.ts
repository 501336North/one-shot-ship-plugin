/**
 * Build Compatibility
 * Ensures debug output is compatible with /oss:build
 */

import type { FixTask } from './progress-update.js';

export interface BuildPhase {
  name: string;
  tasks: FixTask[];
}

export interface BuildTasks {
  phases: BuildPhase[];
}

/**
 * Format fix tasks for /oss:build compatibility
 */
export function formatForBuild(tasks: FixTask[]): BuildTasks {
  const phases: BuildPhase[] = [];

  // Group by phase
  const greenTasks = tasks.filter((t) => t.phase === 'green');
  const refactorTasks = tasks.filter((t) => t.phase === 'refactor');
  const regressionTasks = tasks.filter((t) => t.phase === 'regression');

  if (greenTasks.length > 0) {
    phases.push({ name: 'green', tasks: greenTasks });
  }

  if (refactorTasks.length > 0) {
    phases.push({ name: 'refactor', tasks: refactorTasks });
  }

  if (regressionTasks.length > 0) {
    phases.push({ name: 'regression', tasks: regressionTasks });
  }

  return { phases };
}

/**
 * Get command chain suggestion
 */
export function getCommandChainSuggestion(): string {
  return 'Run /oss:build when ready to execute the fix plan';
}
