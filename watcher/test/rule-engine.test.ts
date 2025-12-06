import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine, RuleMatch } from '../src/detectors/rules';

/**
 * @behavior Rule engine detects common anomalies instantly via pattern matching
 * @acceptance-criteria AC-005.1, AC-005.2, AC-005.3, AC-005.4, AC-005.5
 */
describe('RuleEngine', () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  // AC-005.1: Detect test failure pattern
  describe('test failure detection', () => {
    it('should detect "FAIL" in test output', () => {
      const result = engine.analyze('FAIL src/foo.test.ts');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('test_failure');
      expect(result?.priority).toBe('high');
    });

    it('should detect "Test failed" pattern', () => {
      const result = engine.analyze('Test failed: should do something');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('test_failure');
    });

    it('should detect vitest failure pattern', () => {
      const result = engine.analyze(' ❯ test/auth.test.ts  (5 tests | 1 failed)');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('test_failure');
    });

    it('should extract test file from FAIL output', () => {
      const result = engine.analyze('FAIL src/auth.test.ts');
      expect(result?.context.test_file).toBe('src/auth.test.ts');
    });

    it('should extract test file from vitest output', () => {
      const result = engine.analyze(' ❯ test/queue-manager.test.ts  (31 tests | 2 failed)');
      expect(result?.context.test_file).toBe('test/queue-manager.test.ts');
    });

    it('should suggest debugger agent for test failures', () => {
      const result = engine.analyze('FAIL src/foo.test.ts');
      expect(result?.suggested_agent).toBe('debugger');
    });
  });

  // AC-005.2: Detect loop pattern (repeated tool calls)
  describe('loop detection', () => {
    it('should detect same tool called 5+ times', () => {
      const logs = [
        'Tool: Grep pattern=foo',
        'Tool: Grep pattern=foo',
        'Tool: Grep pattern=foo',
        'Tool: Grep pattern=foo',
        'Tool: Grep pattern=foo',
      ].join('\n');

      const result = engine.analyze(logs);
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('agent_loop');
      expect(result?.priority).toBe('high');
    });

    it('should include repeat count in context', () => {
      const logs = Array(7).fill('Tool: Read file=bar.ts').join('\n');
      const result = engine.analyze(logs);
      expect(result?.context.repeat_count).toBe(7);
    });

    it('should include tool name in context', () => {
      const logs = Array(5).fill('Tool: Bash command=npm test').join('\n');
      const result = engine.analyze(logs);
      expect(result?.context.tool_name).toBe('Bash');
    });

    it('should not trigger for less than 5 repetitions', () => {
      const logs = Array(4).fill('Tool: Grep pattern=foo').join('\n');
      const result = engine.analyze(logs);
      // Should not match loop rule (might match something else or null)
      expect(result?.anomaly_type).not.toBe('agent_loop');
    });

    it('should suggest debugger agent for loops', () => {
      const logs = Array(5).fill('Tool: Read file=bar.ts').join('\n');
      const result = engine.analyze(logs);
      expect(result?.suggested_agent).toBe('debugger');
    });
  });

  // AC-005.3: Detect error patterns
  describe('error detection', () => {
    it('should detect "Error:" pattern', () => {
      const result = engine.analyze('Error: Cannot find module "foo"');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('exception');
      expect(result?.priority).toBe('medium');
    });

    it('should detect "TypeError:" pattern', () => {
      const result = engine.analyze('TypeError: foo is not a function');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('exception');
    });

    it('should detect "ReferenceError:" pattern', () => {
      const result = engine.analyze('ReferenceError: bar is not defined');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('exception');
    });

    it('should detect stack traces', () => {
      const trace = `TypeError: foo is not a function
    at bar (src/baz.ts:42:15)
    at main (src/index.ts:10:5)`;
      const result = engine.analyze(trace);
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('exception');
    });

    it('should extract file and line from stack trace', () => {
      const trace = `TypeError: foo is not a function
    at bar (src/baz.ts:42:15)`;
      const result = engine.analyze(trace);
      expect(result?.context.file).toBe('src/baz.ts');
      expect(result?.context.line).toBe(42);
    });

    it('should suggest debugger agent for exceptions', () => {
      const result = engine.analyze('Error: Something went wrong');
      expect(result?.suggested_agent).toBe('debugger');
    });

    it('should capture error excerpt in context', () => {
      const result = engine.analyze('Error: Cannot find module "missing-module"');
      expect(result?.context.log_excerpt).toContain('Cannot find module');
    });
  });

  // AC-005.4: Detect CI failure
  describe('CI detection', () => {
    it('should detect GitHub Actions failure emoji', () => {
      const result = engine.analyze('❌ CI: Build failed');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('ci_failure');
      expect(result?.priority).toBe('high');
    });

    it('should detect "CI failed" text', () => {
      const result = engine.analyze('CI failed on branch main');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('ci_failure');
    });

    it('should detect "build failed" text', () => {
      const result = engine.analyze('npm build failed with exit code 1');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('ci_failure');
    });

    it('should detect PR check failure', () => {
      const result = engine.analyze('PR check failed: tests did not pass');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('pr_check_failed');
    });

    it('should detect push rejection', () => {
      const result = engine.analyze('error: failed to push some refs');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('push_failed');
    });

    it('should suggest deployment-engineer for CI failures', () => {
      const result = engine.analyze('❌ CI: Build failed');
      expect(result?.suggested_agent).toBe('deployment-engineer');
    });
  });

  // Additional patterns
  describe('stuck agent detection', () => {
    it('should detect timeout messages', () => {
      const result = engine.analyze('Command timed out after 120000ms');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('agent_stuck');
    });

    it('should detect "no output" patterns', () => {
      const result = engine.analyze('No output received for 60 seconds');
      expect(result).not.toBeNull();
      expect(result?.anomaly_type).toBe('agent_stuck');
    });
  });

  // AC-005.5: Execute in <10ms
  describe('performance', () => {
    it('should analyze 1000 lines in under 10ms', () => {
      const bigLog = Array(1000).fill('Normal log line without any issues').join('\n');
      const start = Date.now();
      engine.analyze(bigLog);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(10);
    });

    it('should analyze mixed content quickly', () => {
      const mixedLog = Array(500)
        .fill('')
        .map((_, i) => (i % 10 === 0 ? 'Tool: Read file=foo.ts' : 'Normal log'))
        .join('\n');
      const start = Date.now();
      engine.analyze(mixedLog);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(10);
    });
  });

  // Return null for normal output
  describe('normal output handling', () => {
    it('should return null for normal log lines', () => {
      const result = engine.analyze('Building project...');
      expect(result).toBeNull();
    });

    it('should return null for success messages', () => {
      const result = engine.analyze('✓ All tests passed (42 tests)');
      expect(result).toBeNull();
    });

    it('should return null for empty input', () => {
      const result = engine.analyze('');
      expect(result).toBeNull();
    });

    it('should return null for whitespace only', () => {
      const result = engine.analyze('   \n\n   ');
      expect(result).toBeNull();
    });
  });

  // Generate prompt text
  describe('prompt generation', () => {
    it('should generate actionable prompt for test failure', () => {
      const result = engine.analyze('FAIL src/auth.test.ts');
      expect(result?.prompt).toContain('test');
      expect(result?.prompt).toContain('src/auth.test.ts');
    });

    it('should generate actionable prompt for loop', () => {
      const logs = Array(6).fill('Tool: Grep pattern=findMe').join('\n');
      const result = engine.analyze(logs);
      expect(result?.prompt).toContain('loop');
    });

    it('should generate actionable prompt for exception', () => {
      const result = engine.analyze('TypeError: Cannot read property "foo" of undefined');
      expect(result?.prompt).toContain('error');
    });
  });
});
