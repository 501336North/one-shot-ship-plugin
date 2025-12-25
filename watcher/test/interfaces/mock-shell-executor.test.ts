/**
 * @behavior MockShellExecutor provides configurable mock responses
 * @acceptance-criteria Unit tests can mock shell execution without spawning processes
 * @business-rule Fast unit tests should never spawn real processes
 * @boundary Mock implementation of ShellExecutor
 */

import { describe, it, expect } from 'vitest';
import { MockShellExecutor } from '../../src/interfaces/shell-executor.js';

describe('MockShellExecutor', () => {
  /**
   * @behavior MockShellExecutor returns configured responses
   * @acceptance-criteria Can preset stdout, stderr, exitCode
   */
  it('should return configured response for matching command', async () => {
    // GIVEN: A mock executor with preset response
    const executor = new MockShellExecutor();
    executor.whenCalled('oss-log.sh', ['hook', 'test', 'START']).thenReturn({
      stdout: 'logged successfully',
      stderr: '',
      exitCode: 0,
    });

    // WHEN: Executing the matching command
    const result = await executor.execute('oss-log.sh', ['hook', 'test', 'START']);

    // THEN: Returns the configured response
    expect(result.stdout).toBe('logged successfully');
    expect(result.exitCode).toBe(0);
  });

  /**
   * @behavior MockShellExecutor tracks call history
   * @acceptance-criteria Can verify commands were called with expected args
   */
  it('should track all calls for verification', async () => {
    // GIVEN: A mock executor
    const executor = new MockShellExecutor();
    executor.whenCalled('echo', ['hello']).thenReturn({ stdout: 'hello', stderr: '', exitCode: 0 });
    executor.whenCalled('echo', ['world']).thenReturn({ stdout: 'world', stderr: '', exitCode: 0 });

    // WHEN: Executing multiple commands
    await executor.execute('echo', ['hello']);
    await executor.execute('echo', ['world']);

    // THEN: Can verify call history
    expect(executor.getCalls()).toHaveLength(2);
    expect(executor.wasCalled('echo', ['hello'])).toBe(true);
    expect(executor.wasCalled('echo', ['world'])).toBe(true);
    expect(executor.wasCalled('echo', ['unknown'])).toBe(false);
  });

  /**
   * @behavior MockShellExecutor returns default response for unconfigured commands
   * @acceptance-criteria Unconfigured commands return empty success by default
   */
  it('should return default response for unconfigured commands', async () => {
    // GIVEN: A mock executor without configuration
    const executor = new MockShellExecutor();

    // WHEN: Executing an unconfigured command
    const result = await executor.execute('unconfigured', ['arg']);

    // THEN: Returns default empty success
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  /**
   * @behavior MockShellExecutor can simulate failures
   * @acceptance-criteria Can configure non-zero exit codes and stderr
   */
  it('should simulate command failure', async () => {
    // GIVEN: A mock executor configured to fail
    const executor = new MockShellExecutor();
    executor.whenCalled('failing-script.sh', []).thenReturn({
      stdout: '',
      stderr: 'command not found',
      exitCode: 127,
    });

    // WHEN: Executing the failing command
    const result = await executor.execute('failing-script.sh', []);

    // THEN: Returns failure response
    expect(result.stderr).toBe('command not found');
    expect(result.exitCode).toBe(127);
  });

  /**
   * @behavior MockShellExecutor can be reset between tests
   * @acceptance-criteria Reset clears all configurations and call history
   */
  it('should reset configurations and call history', async () => {
    // GIVEN: A mock executor with configuration and calls
    const executor = new MockShellExecutor();
    executor.whenCalled('test', []).thenReturn({ stdout: 'test', stderr: '', exitCode: 0 });
    await executor.execute('test', []);

    // WHEN: Resetting the executor
    executor.reset();

    // THEN: Configuration and history are cleared
    expect(executor.getCalls()).toHaveLength(0);
    const result = await executor.execute('test', []);
    expect(result.stdout).toBe(''); // Returns default now
  });
});
