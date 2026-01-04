/**
 * @behavior Command suggester recommends next action based on workflow state
 * @acceptance-criteria Suggestions follow ideate → plan → build → ship chain
 * @business-rule Users should always know what to do next
 * @boundary Service (CommandSuggester)
 */

import { describe, it, expect } from 'vitest';

describe('Command Suggester Service', () => {
  describe('workflow chain suggestions', () => {
    /**
     * @behavior After ideate, suggest plan
     * @acceptance-criteria ideate → plan is the standard flow
     */
    it('should suggest plan after ideate', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'ideate',
        lastStatus: 'complete',
      });

      expect(suggestion.command).toBe('plan');
      expect(suggestion.reason).toContain('plan');
    });

    /**
     * @behavior After plan, suggest build
     * @acceptance-criteria plan → build follows TDD approach
     */
    it('should suggest build after plan', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'plan',
        lastStatus: 'complete',
      });

      expect(suggestion.command).toBe('build');
    });

    /**
     * @behavior After build, suggest ship
     * @acceptance-criteria build → ship completes the workflow
     */
    it('should suggest ship after build', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'build',
        lastStatus: 'complete',
      });

      expect(suggestion.command).toBe('ship');
    });

    /**
     * @behavior After ship, suggest ideate for next feature
     * @acceptance-criteria Workflow is cyclical
     */
    it('should suggest ideate after ship', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'ship',
        lastStatus: 'complete',
      });

      expect(suggestion.command).toBe('ideate');
      expect(suggestion.reason).toContain('next feature');
    });
  });

  describe('failure recovery suggestions', () => {
    /**
     * @behavior After test failure, suggest debug
     * @acceptance-criteria Failed tests trigger debug suggestion
     */
    it('should suggest debug after test failure', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'build',
        lastStatus: 'failed',
        failureType: 'test',
      });

      expect(suggestion.command).toBe('debug');
    });

    /**
     * @behavior After build failure, suggest reviewing the plan
     * @acceptance-criteria Build failures may need plan adjustment
     */
    it('should suggest review after build failure', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'build',
        lastStatus: 'failed',
        failureType: 'build',
      });

      expect(suggestion.command).toBe('review');
    });
  });

  describe('TDD phase suggestions', () => {
    /**
     * @behavior In RED phase, suggest writing minimal code
     * @acceptance-criteria RED → GREEN is the TDD flow
     */
    it('should suggest green after red', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'red',
        lastStatus: 'complete',
        tddPhase: 'red',
      });

      expect(suggestion.command).toBe('green');
    });

    /**
     * @behavior In GREEN phase, suggest refactor
     * @acceptance-criteria GREEN → REFACTOR maintains quality
     */
    it('should suggest refactor after green', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'green',
        lastStatus: 'complete',
        tddPhase: 'green',
      });

      expect(suggestion.command).toBe('refactor');
    });

    /**
     * @behavior After refactor, suggest next red (new test)
     * @acceptance-criteria REFACTOR → RED continues cycle
     */
    it('should suggest red after refactor', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'refactor',
        lastStatus: 'complete',
        tddPhase: 'refactor',
      });

      expect(suggestion.command).toBe('red');
    });
  });

  describe('context-aware suggestions', () => {
    /**
     * @behavior With uncommitted changes, suggest ship
     * @acceptance-criteria Don't let work go unshipped
     */
    it('should suggest ship when there are uncommitted changes', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'build',
        lastStatus: 'complete',
        hasUncommittedChanges: true,
      });

      expect(suggestion.command).toBe('ship');
    });

    /**
     * @behavior No previous command suggests ideate
     * @acceptance-criteria New sessions start with ideation
     */
    it('should suggest ideate for fresh session', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({});

      expect(suggestion.command).toBe('ideate');
    });
  });

  describe('suggestion formatting', () => {
    /**
     * @behavior Suggestions include reason and confidence
     * @acceptance-criteria Users understand why suggestion was made
     */
    it('should include reason and confidence', async () => {
      const { CommandSuggester } = await import('../../src/services/command-suggester');

      const suggester = new CommandSuggester();
      const suggestion = suggester.suggestNext({
        lastCommand: 'plan',
        lastStatus: 'complete',
      });

      expect(suggestion.reason).toBeDefined();
      expect(suggestion.confidence).toBeGreaterThan(0);
      expect(suggestion.confidence).toBeLessThanOrEqual(1);
    });
  });
});
