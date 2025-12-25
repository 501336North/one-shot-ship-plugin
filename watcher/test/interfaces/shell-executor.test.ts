/**
 * @behavior RealShellExecutor executes shell scripts via child_process
 * @acceptance-criteria Can execute scripts and return stdout, stderr, exitCode
 * @business-rule Used in production - MockShellExecutor for unit tests
 * @boundary Shell execution abstraction
 */

import { describe, it, expect } from 'vitest';
import { RealShellExecutor } from '../../src/interfaces/shell-executor.js';

describe('RealShellExecutor', () => {
  /**
   * @behavior RealShellExecutor.execute runs a script and returns result
   * @acceptance-criteria Returns stdout, stderr, exitCode
   */
  it('should execute a simple echo command and return stdout', async () => {
    // GIVEN: A RealShellExecutor instance
    const executor = new RealShellExecutor();

    // WHEN: Executing echo
    const result = await executor.execute('echo', ['hello']);

    // THEN: Returns stdout with output
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  /**
   * @behavior RealShellExecutor captures stderr
   * @acceptance-criteria stderr is captured separately from stdout
   */
  it('should capture stderr from command', async () => {
    // GIVEN: A RealShellExecutor instance
    const executor = new RealShellExecutor();

    // WHEN: Running a command that writes to stderr
    const result = await executor.execute('bash', ['-c', 'echo error >&2']);

    // THEN: stderr is captured
    expect(result.stderr.trim()).toBe('error');
  });

  /**
   * @behavior RealShellExecutor returns non-zero exit code on failure
   * @acceptance-criteria exitCode reflects actual command exit status
   */
  it('should return non-zero exit code on command failure', async () => {
    // GIVEN: A RealShellExecutor instance
    const executor = new RealShellExecutor();

    // WHEN: Running a command that exits with error
    const result = await executor.execute('bash', ['-c', 'exit 42']);

    // THEN: exitCode is 42
    expect(result.exitCode).toBe(42);
  });

  /**
   * @behavior RealShellExecutor accepts options for cwd and env
   * @acceptance-criteria Options are passed to child_process
   */
  it('should execute in specified working directory', async () => {
    // GIVEN: A RealShellExecutor with cwd option
    const executor = new RealShellExecutor();

    // WHEN: Running pwd in /tmp
    const result = await executor.execute('pwd', [], { cwd: '/tmp' });

    // THEN: Output shows /tmp (or /private/tmp on macOS)
    expect(result.stdout.trim()).toMatch(/\/(private\/)?tmp$/);
  });

  /**
   * @behavior RealShellExecutor passes environment variables
   * @acceptance-criteria Custom env vars are available to script
   */
  it('should pass custom environment variables', async () => {
    // GIVEN: A RealShellExecutor with env option
    const executor = new RealShellExecutor();

    // WHEN: Running a command that reads the env var
    const result = await executor.execute('bash', ['-c', 'echo $TEST_VAR'], {
      env: { ...process.env, TEST_VAR: 'test_value' },
    });

    // THEN: The env var is available
    expect(result.stdout.trim()).toBe('test_value');
  });
});
