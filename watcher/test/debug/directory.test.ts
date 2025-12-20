/**
 * Directory Selection Tests
 *
 * @behavior Selects correct directory for debug docs
 * @acceptance-criteria AC-DBG-009, AC-DBG-010
 * @business-rule Use existing feature dir or create bugfix dir
 * @boundary Filesystem
 */

import { describe, it, expect } from 'vitest';
import {
  selectDirectory,
  createBugfixDirName,
  sanitizeDirName,
} from '../../src/debug/directory.js';
import type { ParsedBug } from '../../src/debug/bug-parser.js';

describe('selectDirectory', () => {
  /**
   * @behavior Uses existing feature dir if bug relates to active feature
   * @acceptance-criteria AC-DBG-009
   */
  it('should use existing feature dir if bug relates to active feature', () => {
    const bug: ParsedBug = {
      type: 'error',
      errorType: 'TypeError',
      message: 'Auth error',
      component: 'auth',
    };

    const activeFeatures = ['auth-feature', 'payment-feature'];

    const result = selectDirectory(bug, activeFeatures);

    expect(result).toBe('auth-feature');
  });

  /**
   * @behavior Returns null for standalone bugs
   * @acceptance-criteria AC-DBG-010
   */
  it('should return null for standalone bugs', () => {
    const bug: ParsedBug = {
      type: 'error',
      errorType: 'TypeError',
      message: 'Login error',
      component: 'login',
    };

    const activeFeatures = ['auth-feature', 'payment-feature'];

    const result = selectDirectory(bug, activeFeatures);

    expect(result).toBeNull();
  });
});

describe('createBugfixDirName', () => {
  /**
   * @behavior Creates bugfix dir name for standalone bugs
   * @acceptance-criteria AC-DBG-010
   */
  it('should create bugfix dir for standalone bugs', () => {
    const result = createBugfixDirName('login shows wrong error');

    expect(result).toBe('bugfix-login-shows-wrong-error');
  });

  /**
   * @behavior Limits directory name length
   * @acceptance-criteria AC-DBG-010
   */
  it('should limit directory name to 30 characters', () => {
    const result = createBugfixDirName(
      'this is a very long bug description that exceeds the limit'
    );

    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toContain('bugfix-');
  });
});

describe('sanitizeDirName', () => {
  /**
   * @behavior Sanitizes directory names
   * @acceptance-criteria AC-DBG-010
   */
  it('should sanitize directory names', () => {
    const result = sanitizeDirName('Bug: Special/Chars!');

    expect(result).toBe('bug-specialchars');
  });

  /**
   * @behavior Converts to lowercase
   * @acceptance-criteria AC-DBG-010
   */
  it('should convert to lowercase', () => {
    const result = sanitizeDirName('MyBugFix');

    expect(result).toBe('mybugfix');
  });

  /**
   * @behavior Replaces spaces with hyphens
   * @acceptance-criteria AC-DBG-010
   */
  it('should replace spaces with hyphens', () => {
    const result = sanitizeDirName('bug fix here');

    expect(result).toBe('bug-fix-here');
  });
});
