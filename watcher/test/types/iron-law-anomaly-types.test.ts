import { describe, it, expect } from 'vitest';
import { AnomalyType, CreateTaskInput, MonitorSource } from '../../src/types.js';

describe('IRON LAW Anomaly Types', () => {
  it('should accept iron_law_violation as anomaly type', () => {
    const anomalyType: AnomalyType = 'iron_law_violation';
    expect(anomalyType).toBe('iron_law_violation');
  });

  it('should accept iron_law_repeated as anomaly type', () => {
    const anomalyType: AnomalyType = 'iron_law_repeated';
    expect(anomalyType).toBe('iron_law_repeated');
  });

  it('should accept iron_law_ignored as anomaly type', () => {
    const anomalyType: AnomalyType = 'iron_law_ignored';
    expect(anomalyType).toBe('iron_law_ignored');
  });

  it('should allow creating task with iron_law_violation', () => {
    const task: CreateTaskInput = {
      priority: 'high',
      source: 'iron-law-monitor' as MonitorSource,
      anomaly_type: 'iron_law_violation',
      prompt: 'IRON LAW #4 violated',
      suggested_agent: 'debugger',
      context: {
        law: 4,
        message: 'On main branch',
      },
    };
    expect(task.anomaly_type).toBe('iron_law_violation');
    expect(task.context.law).toBe(4);
  });

  it('should allow creating task with iron_law_repeated', () => {
    const task: CreateTaskInput = {
      priority: 'high',
      source: 'iron-law-monitor' as MonitorSource,
      anomaly_type: 'iron_law_repeated',
      prompt: 'IRON LAW #4 violated 3+ times',
      suggested_agent: 'debugger',
      context: {
        law: 4,
        message: 'On main branch',
        repeat_count: 3,
      },
    };
    expect(task.anomaly_type).toBe('iron_law_repeated');
    expect(task.context.repeat_count).toBe(3);
  });
});
