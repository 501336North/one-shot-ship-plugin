/**
 * Domain Questions Tests
 *
 * @behavior Domain-specific question banks provide deep questions for each domain
 * @acceptance-criteria AC-DOMAIN-Q.1 through AC-DOMAIN-Q.5
 * @boundary Data Layer
 */

import { describe, it, expect } from 'vitest';
import {
  getQuestionsForDomain,
  getAllDomainQuestions,
  type Domain,
  type DomainQuestionBank,
} from '../../src/data/domain-questions.js';

describe('DomainQuestions', () => {
  describe('getQuestionsForDomain', () => {
    describe('UI domain questions', () => {
      it('should return exactly 4 questions for UI domain', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions).toHaveLength(4);
      });

      it('should include accessibility requirements question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.toLowerCase().includes('accessibility'))).toBe(true);
      });

      it('should include responsive breakpoints question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.toLowerCase().includes('responsive') || q.toLowerCase().includes('breakpoint'))).toBe(true);
      });

      it('should include component library question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.toLowerCase().includes('component library') || q.toLowerCase().includes('design system'))).toBe(true);
      });

      it('should include animation/interaction question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.toLowerCase().includes('animation') || q.toLowerCase().includes('interaction'))).toBe(true);
      });
    });

    describe('API domain questions', () => {
      it('should return exactly 4 questions for API domain', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions).toHaveLength(4);
      });

      it('should include authentication method question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.toLowerCase().includes('authentication'))).toBe(true);
      });

      it('should include rate limiting question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.toLowerCase().includes('rate limit'))).toBe(true);
      });

      it('should include versioning question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.toLowerCase().includes('version'))).toBe(true);
      });

      it('should include error response format question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.toLowerCase().includes('error') && q.toLowerCase().includes('format'))).toBe(true);
      });
    });

    describe('CLI domain questions', () => {
      it('should return exactly 4 questions for CLI domain', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions).toHaveLength(4);
      });

      it('should include argument parsing question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.toLowerCase().includes('argument') || q.toLowerCase().includes('parsing'))).toBe(true);
      });

      it('should include output format question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.toLowerCase().includes('output') && q.toLowerCase().includes('format'))).toBe(true);
      });

      it('should include interactive mode question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.toLowerCase().includes('interactive'))).toBe(true);
      });

      it('should include config file question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.toLowerCase().includes('config'))).toBe(true);
      });
    });

    describe('Data domain questions', () => {
      it('should return exactly 4 questions for data domain', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions).toHaveLength(4);
      });

      it('should include data persistence question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.toLowerCase().includes('persistence') || q.toLowerCase().includes('storage'))).toBe(true);
      });

      it('should include schema migration question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.toLowerCase().includes('migration'))).toBe(true);
      });

      it('should include backup requirements question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.toLowerCase().includes('backup'))).toBe(true);
      });

      it('should include data retention question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.toLowerCase().includes('retention'))).toBe(true);
      });
    });

    describe('Auth domain questions', () => {
      it('should return exactly 4 questions for auth domain', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions).toHaveLength(4);
      });

      it('should include session vs token question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.toLowerCase().includes('session') && q.toLowerCase().includes('token'))).toBe(true);
      });

      it('should include MFA requirements question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.toLowerCase().includes('mfa') || q.toLowerCase().includes('multi-factor') || q.toLowerCase().includes('two-factor'))).toBe(true);
      });

      it('should include password policy question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.toLowerCase().includes('password') && q.toLowerCase().includes('policy'))).toBe(true);
      });

      it('should include OAuth providers question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.toLowerCase().includes('oauth') || q.toLowerCase().includes('provider'))).toBe(true);
      });
    });

    describe('question format', () => {
      const domains: Domain[] = ['ui', 'api', 'cli', 'data', 'auth'];

      it('should return questions as non-empty strings', () => {
        for (const domain of domains) {
          const questions = getQuestionsForDomain(domain);
          for (const question of questions) {
            expect(typeof question).toBe('string');
            expect(question.length).toBeGreaterThan(0);
          }
        }
      });

      it('should return questions ending with question mark', () => {
        for (const domain of domains) {
          const questions = getQuestionsForDomain(domain);
          for (const question of questions) {
            expect(question.endsWith('?')).toBe(true);
          }
        }
      });

      it('should return unique questions within each domain', () => {
        for (const domain of domains) {
          const questions = getQuestionsForDomain(domain);
          const uniqueQuestions = new Set(questions);
          expect(uniqueQuestions.size).toBe(questions.length);
        }
      });
    });
  });

  describe('getAllDomainQuestions', () => {
    it('should return question banks for all 5 domains', () => {
      const allQuestions = getAllDomainQuestions();
      expect(allQuestions).toHaveLength(5);
    });

    it('should include all domain types', () => {
      const allQuestions = getAllDomainQuestions();
      const domains = allQuestions.map((q) => q.domain);
      expect(domains).toContain('ui');
      expect(domains).toContain('api');
      expect(domains).toContain('cli');
      expect(domains).toContain('data');
      expect(domains).toContain('auth');
    });

    it('should have 4 questions per domain', () => {
      const allQuestions = getAllDomainQuestions();
      for (const bank of allQuestions) {
        expect(bank.questions).toHaveLength(4);
      }
    });

    it('should return DomainQuestionBank structure', () => {
      const allQuestions = getAllDomainQuestions();
      for (const bank of allQuestions) {
        expect(bank).toHaveProperty('domain');
        expect(bank).toHaveProperty('questions');
        expect(Array.isArray(bank.questions)).toBe(true);
      }
    });
  });

  describe('type exports', () => {
    it('should export Domain type matching expected values', () => {
      const domains: Domain[] = ['ui', 'api', 'cli', 'data', 'auth'];
      expect(domains).toHaveLength(5);
    });

    it('should export DomainQuestionBank interface', () => {
      const bank: DomainQuestionBank = {
        domain: 'ui',
        questions: ['Question 1?', 'Question 2?', 'Question 3?', 'Question 4?'],
      };
      expect(bank.domain).toBe('ui');
      expect(bank.questions).toHaveLength(4);
    });
  });
});
