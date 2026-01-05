/**
 * @behavior Learning system provides interactive tutorials and skill progression
 * @acceptance-criteria Users learn OSS workflows progressively
 * @business-rule Reduce learning curve, increase adoption
 * @boundary Service (LearningSystem)
 */

import { describe, it, expect } from 'vitest';

describe('Learning System Service', () => {
  describe('tutorials', () => {
    /**
     * @behavior Can list available tutorials
     * @acceptance-criteria Returns tutorials with difficulty levels
     */
    it('should list available tutorials', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const tutorials = system.listTutorials();

      expect(tutorials.length).toBeGreaterThan(0);
      expect(tutorials[0]).toHaveProperty('id');
      expect(tutorials[0]).toHaveProperty('title');
      expect(tutorials[0]).toHaveProperty('difficulty');
    });

    /**
     * @behavior Tutorials have content and steps
     * @acceptance-criteria Each tutorial has structured content
     */
    it('should get tutorial by id', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const tutorial = system.getTutorial('tdd-basics');

      expect(tutorial).toBeDefined();
      expect(tutorial?.steps.length).toBeGreaterThan(0);
      expect(tutorial?.steps[0]).toHaveProperty('title');
      expect(tutorial?.steps[0]).toHaveProperty('content');
    });

    /**
     * @behavior Returns undefined for unknown tutorials
     * @acceptance-criteria Graceful handling of unknown IDs
     */
    it('should return undefined for unknown tutorial', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const tutorial = system.getTutorial('nonexistent');

      expect(tutorial).toBeUndefined();
    });
  });

  describe('concepts', () => {
    /**
     * @behavior Can explain OSS concepts
     * @acceptance-criteria Returns clear explanations
     */
    it('should explain concept', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const explanation = system.explainConcept('tdd');

      expect(explanation).toBeDefined();
      expect(explanation?.title).toBe('Test-Driven Development (TDD)');
      expect(explanation?.summary).toBeDefined();
      expect(explanation?.examples).toBeDefined();
    });

    /**
     * @behavior Can list all concepts
     * @acceptance-criteria Returns all available concepts
     */
    it('should list all concepts', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const concepts = system.listConcepts();

      expect(concepts.length).toBeGreaterThan(0);
      expect(concepts).toContain('tdd');
      expect(concepts).toContain('london-tdd');
      expect(concepts).toContain('iron-laws');
    });

    /**
     * @behavior Concepts have related commands
     * @acceptance-criteria Each concept links to relevant commands
     */
    it('should include related commands in concept', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const explanation = system.explainConcept('tdd');

      expect(explanation?.relatedCommands).toContain('/oss:red');
      expect(explanation?.relatedCommands).toContain('/oss:green');
    });
  });

  describe('skill progression', () => {
    /**
     * @behavior Tracks user skill level
     * @acceptance-criteria Can get and set skill level
     */
    it('should track skill level', async () => {
      const { LearningSystem, SkillLevel } = await import('../../src/services/learning-system');

      const system = new LearningSystem();

      expect(system.getSkillLevel()).toBe(SkillLevel.BEGINNER);

      system.setSkillLevel(SkillLevel.INTERMEDIATE);
      expect(system.getSkillLevel()).toBe(SkillLevel.INTERMEDIATE);
    });

    /**
     * @behavior Recommends next learning based on skill
     * @acceptance-criteria Recommendations match skill level
     */
    it('should recommend next learning', async () => {
      const { LearningSystem, SkillLevel } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      system.setSkillLevel(SkillLevel.BEGINNER);

      const recommendations = system.getRecommendations();

      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations[0]).toHaveProperty('type');
      expect(recommendations[0]).toHaveProperty('id');
      expect(recommendations[0]).toHaveProperty('reason');
    });

    /**
     * @behavior Can mark tutorial as completed
     * @acceptance-criteria Completed tutorials are tracked
     */
    it('should mark tutorial completed', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();

      system.completeTutorial('tdd-basics');
      const progress = system.getProgress();

      expect(progress.completedTutorials).toContain('tdd-basics');
    });
  });

  describe('skill tree', () => {
    /**
     * @behavior Skill tree shows progression path
     * @acceptance-criteria Shows unlocked and locked skills
     */
    it('should get skill tree', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const tree = system.getSkillTree();

      expect(tree.beginner).toBeDefined();
      expect(tree.intermediate).toBeDefined();
      expect(tree.advanced).toBeDefined();
      expect(tree.expert).toBeDefined();
    });

    /**
     * @behavior Beginner skills are unlocked by default
     * @acceptance-criteria New users can access beginner content
     */
    it('should have beginner skills unlocked', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const tree = system.getSkillTree();

      expect(tree.beginner.unlocked).toBe(true);
      expect(tree.beginner.skills.length).toBeGreaterThan(0);
    });
  });

  describe('quickstart', () => {
    /**
     * @behavior Quickstart provides step-by-step guide
     * @acceptance-criteria Guide has clear steps
     */
    it('should get quickstart guide', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();
      const guide = system.getQuickstartGuide();

      expect(guide.title).toBeDefined();
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.estimatedTime).toBeDefined();
    });

    /**
     * @behavior Quickstart tracks current step
     * @acceptance-criteria Can advance through steps
     */
    it('should track quickstart progress', async () => {
      const { LearningSystem } = await import('../../src/services/learning-system');

      const system = new LearningSystem();

      expect(system.getQuickstartStep()).toBe(0);

      system.advanceQuickstart();
      expect(system.getQuickstartStep()).toBe(1);
    });
  });
});
