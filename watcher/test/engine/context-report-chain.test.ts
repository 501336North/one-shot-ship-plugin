import { describe, test, expect } from 'vitest';
import { DEFAULT_WORKFLOW_CONFIGS } from '../../src/engine/types.js';

describe('build workflow chains_to context-report', () => {
  test('should include context-report in build chains_to', () => {
    const buildConfig = DEFAULT_WORKFLOW_CONFIGS.build;
    expect(buildConfig.chains_to).toBeDefined();
    expect(buildConfig.chains_to).toContainEqual({
      command: 'context-report',
      always: true,
    });
  });

  test('should preserve existing build config fields', () => {
    const buildConfig = DEFAULT_WORKFLOW_CONFIGS.build;
    expect(buildConfig.task_loop).toEqual(['red', 'green', 'refactor']);
    expect(buildConfig.agents).toBeDefined();
    expect(buildConfig.checkpoint).toBe('auto');
  });
});
