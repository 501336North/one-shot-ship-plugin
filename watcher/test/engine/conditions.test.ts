/**
 * Workflow Engine - Condition Evaluator Tests
 *
 * @behavior Conditions are evaluated against workflow context
 * @acceptance-criteria AC-WF-COND.1 through AC-WF-COND.7
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  getBuiltInConditions,
} from '../../src/engine/conditions.js';
import { WorkflowContext } from '../../src/engine/types.js';

describe('ConditionEvaluator', () => {
  describe('evaluateCondition', () => {
    it('should evaluate has_api_work based on design content', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # Feature Design

          ## API Endpoints
          - POST /api/v1/users
          - GET /api/v1/users/:id

          ## Implementation Details
          REST API for user management.
        `,
      };

      // Act
      const result = evaluateCondition('has_api_work', context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for has_api_work when no API mentioned', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # Feature Design

          ## UI Components
          - Button component
          - Modal dialog

          ## Implementation Details
          Frontend-only feature.
        `,
      };

      // Act
      const result = evaluateCondition('has_api_work', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should evaluate has_db_work based on design content', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # Feature Design

          ## Database Schema
          - Users table
          - Posts table with foreign key

          ## Implementation Details
          PostgreSQL database with Prisma ORM.
        `,
      };

      // Act
      const result = evaluateCondition('has_db_work', context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for has_db_work when no database mentioned', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # Feature Design

          ## API Endpoints
          - GET /api/health

          ## Implementation Details
          Stateless health check endpoint.
        `,
      };

      // Act
      const result = evaluateCondition('has_db_work', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should evaluate has_ui_work based on files changed', () => {
      // Arrange
      const context: WorkflowContext = {
        changedFiles: [
          'src/components/Button.tsx',
          'src/styles/button.css',
          'src/utils/helpers.ts',
        ],
      };

      // Act
      const result = evaluateCondition('has_ui_work', context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for has_ui_work when no UI files changed', () => {
      // Arrange
      const context: WorkflowContext = {
        changedFiles: [
          'src/api/routes.ts',
          'src/services/user.service.ts',
          'prisma/schema.prisma',
        ],
      };

      // Act
      const result = evaluateCondition('has_ui_work', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should evaluate has_test_failures based on last test run', () => {
      // Arrange
      const context: WorkflowContext = {
        lastTestResult: {
          passed: false,
          failures: ['UserService.test.ts: should create user'],
        },
      };

      // Act
      const result = evaluateCondition('has_test_failures', context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for has_test_failures when tests pass', () => {
      // Arrange
      const context: WorkflowContext = {
        lastTestResult: {
          passed: true,
          failures: [],
        },
      };

      // Act
      const result = evaluateCondition('has_test_failures', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true for always condition', () => {
      // Arrange
      const context: WorkflowContext = {};

      // Act
      const result = evaluateCondition('always', context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for never condition', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: 'Some design with API and database work',
        changedFiles: ['src/components/Button.tsx'],
        lastTestResult: { passed: false, failures: ['test failed'] },
      };

      // Act
      const result = evaluateCondition('never', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle unknown conditions gracefully', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: 'Some design',
      };

      // Act
      const result = evaluateCondition('unknown_condition', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle empty context gracefully', () => {
      // Arrange
      const context: WorkflowContext = {};

      // Act & Assert - Should not throw
      expect(evaluateCondition('has_api_work', context)).toBe(false);
      expect(evaluateCondition('has_db_work', context)).toBe(false);
      expect(evaluateCondition('has_ui_work', context)).toBe(false);
      expect(evaluateCondition('has_test_failures', context)).toBe(false);
      expect(evaluateCondition('has_cli_work', context)).toBe(false);
      expect(evaluateCondition('has_auth_work', context)).toBe(false);
    });

    /**
     * @behavior has_cli_work detects CLI/command-line work in design content
     * @acceptance-criteria AC-WF-COND.8
     */
    it('should evaluate has_cli_work based on design content', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # CLI Tool Design

          ## Commands
          - parse arguments using yargs
          - output to stdout in JSON format

          ## Implementation Details
          Command line interface for data processing.
        `,
      };

      // Act
      const result = evaluateCondition('has_cli_work', context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for has_cli_work when no CLI mentioned', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # Web Application Design

          ## Components
          - Dashboard page
          - User profile modal

          ## Implementation Details
          Browser-based web application.
        `,
      };

      // Act
      const result = evaluateCondition('has_cli_work', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should detect CLI work with various patterns', () => {
      // Arrange - Test different CLI-related terms
      const testCases = [
        { content: 'Build a CLI tool', expected: true },
        { content: 'Command line argument parsing', expected: true },
        { content: 'Parse subcommands for the tool', expected: true },
        { content: 'Use commander.js for options', expected: true },
        { content: 'Output to terminal', expected: true },
        { content: 'Write to stdout', expected: true },
        { content: 'Check bin/ directory', expected: true },
        { content: 'Shell script integration', expected: true },
      ];

      testCases.forEach(({ content, expected }) => {
        const context: WorkflowContext = { designContent: content };
        const result = evaluateCondition('has_cli_work', context);
        expect(result).toBe(expected);
      });
    });

    /**
     * @behavior has_auth_work detects authentication/authorization work in design content
     * @acceptance-criteria AC-WF-COND.9
     */
    it('should evaluate has_auth_work based on design content', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # Authentication System Design

          ## Features
          - User login with JWT tokens
          - OAuth provider integration
          - Role-based access control

          ## Implementation Details
          Secure authentication with MFA support.
        `,
      };

      // Act
      const result = evaluateCondition('has_auth_work', context);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for has_auth_work when no auth mentioned', () => {
      // Arrange
      const context: WorkflowContext = {
        designContent: `
          # Data Processing Feature

          ## Components
          - CSV parser
          - Data transformer

          ## Implementation Details
          Batch data processing pipeline.
        `,
      };

      // Act
      const result = evaluateCondition('has_auth_work', context);

      // Assert
      expect(result).toBe(false);
    });

    it('should detect auth work with various patterns', () => {
      // Arrange - Test different auth-related terms
      const testCases = [
        { content: 'Implement authentication flow', expected: true },
        { content: 'Add authorization checks', expected: true },
        { content: 'User login functionality', expected: true },
        { content: 'Password hashing implementation', expected: true },
        { content: 'JWT token validation', expected: true },
        { content: 'Session management', expected: true },
        { content: 'OAuth 2.0 integration', expected: true },
        { content: 'RBAC permissions system', expected: true },
        { content: 'Store user credentials', expected: true },
        { content: 'Enable 2FA for users', expected: true },
        { content: 'MFA requirement for admin', expected: true },
      ];

      testCases.forEach(({ content, expected }) => {
        const context: WorkflowContext = { designContent: content };
        const result = evaluateCondition('has_auth_work', context);
        expect(result).toBe(expected);
      });
    });
  });

  describe('getBuiltInConditions', () => {
    it('should return all built-in conditions', () => {
      // Act
      const conditions = getBuiltInConditions();

      // Assert
      expect(conditions).toHaveProperty('always');
      expect(conditions).toHaveProperty('never');
      expect(conditions).toHaveProperty('has_api_work');
      expect(conditions).toHaveProperty('has_db_work');
      expect(conditions).toHaveProperty('has_ui_work');
      expect(conditions).toHaveProperty('has_cli_work');
      expect(conditions).toHaveProperty('has_auth_work');
      expect(conditions).toHaveProperty('has_test_failures');
    });

    it('should return functions for all conditions', () => {
      // Act
      const conditions = getBuiltInConditions();

      // Assert
      Object.values(conditions).forEach((fn) => {
        expect(typeof fn).toBe('function');
      });
    });
  });
});
