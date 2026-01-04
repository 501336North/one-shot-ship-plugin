/**
 * @behavior /oss:tutorial provides interactive onboarding for new users
 * @acceptance-criteria Users learn workflow through guided practice
 * @business-rule New users should be productive within 10 minutes
 * @boundary CLI command (tutorial)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Tutorial Command', () => {
  describe('TutorialService', () => {
    /**
     * @behavior Tutorial tracks user progress through lessons
     * @acceptance-criteria Progress is saved and restored between sessions
     */
    it('should track lesson completion progress', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();

      // Initially no lessons completed
      expect(tutorial.getCompletedLessons()).toEqual([]);

      // Complete a lesson
      tutorial.completeLesson('intro');

      // Progress should be tracked
      expect(tutorial.getCompletedLessons()).toContain('intro');
    });

    /**
     * @behavior Tutorial provides structured learning path
     * @acceptance-criteria Lessons are presented in logical order
     */
    it('should provide lessons in correct order', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();
      const lessons = tutorial.getAllLessons();

      expect(lessons.length).toBeGreaterThan(0);
      expect(lessons[0].id).toBe('intro');
      expect(lessons.some(l => l.id === 'tdd-basics')).toBe(true);
      expect(lessons.some(l => l.id === 'workflow-chain')).toBe(true);
    });

    /**
     * @behavior Tutorial calculates progress percentage
     * @acceptance-criteria Users see how much they've completed
     */
    it('should calculate progress percentage', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();

      // Initially 0%
      expect(tutorial.getProgressPercentage()).toBe(0);

      // Complete first lesson
      tutorial.completeLesson('intro');

      // Progress should increase (not 0% anymore)
      expect(tutorial.getProgressPercentage()).toBeGreaterThan(0);
    });

    /**
     * @behavior Tutorial returns next uncompleted lesson
     * @acceptance-criteria Users can resume where they left off
     */
    it('should return next uncompleted lesson', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();

      // First lesson should be intro
      const next = tutorial.getNextLesson();
      expect(next?.id).toBe('intro');

      // After completing intro, next should be different
      tutorial.completeLesson('intro');
      const next2 = tutorial.getNextLesson();
      expect(next2?.id).not.toBe('intro');
    });
  });

  describe('Lesson Content', () => {
    /**
     * @behavior Each lesson has title, description, and exercises
     * @acceptance-criteria Lessons are well-structured for learning
     */
    it('should have complete lesson structure', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();
      const lessons = tutorial.getAllLessons();

      for (const lesson of lessons) {
        expect(lesson.id).toBeDefined();
        expect(lesson.title).toBeDefined();
        expect(lesson.description).toBeDefined();
        expect(lesson.exercises).toBeDefined();
        expect(lesson.exercises.length).toBeGreaterThan(0);
      }
    });

    /**
     * @behavior Exercises have clear instructions and validation
     * @acceptance-criteria Users know what to do and can verify success
     */
    it('should have exercises with instructions and expected outcomes', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();
      const lessons = tutorial.getAllLessons();

      for (const lesson of lessons) {
        for (const exercise of lesson.exercises) {
          expect(exercise.instruction).toBeDefined();
          expect(exercise.expectedOutcome).toBeDefined();
        }
      }
    });
  });

  describe('Progress Persistence', () => {
    let testDir: string;
    let originalHome: string | undefined;

    beforeEach(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-test-'));
      originalHome = process.env.HOME;
      process.env.HOME = testDir;
      fs.mkdirSync(path.join(testDir, '.oss'), { recursive: true });
    });

    afterEach(() => {
      if (originalHome) {
        process.env.HOME = originalHome;
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    /**
     * @behavior Progress is saved to disk
     * @acceptance-criteria Progress survives CLI restarts
     */
    it('should persist progress to disk', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();
      tutorial.completeLesson('intro');
      tutorial.saveProgress();

      // Create new instance
      const tutorial2 = new TutorialService();
      tutorial2.loadProgress();

      expect(tutorial2.getCompletedLessons()).toContain('intro');
    });

    /**
     * @behavior Reset clears all progress
     * @acceptance-criteria Users can start tutorial fresh
     */
    it('should reset progress when requested', async () => {
      const { TutorialService } = await import('../../src/services/tutorial');

      const tutorial = new TutorialService();
      tutorial.completeLesson('intro');
      tutorial.completeLesson('tdd-basics');
      tutorial.saveProgress();

      // Reset
      tutorial.resetProgress();

      expect(tutorial.getCompletedLessons()).toEqual([]);
      expect(tutorial.getProgressPercentage()).toBe(0);
    });
  });
});
