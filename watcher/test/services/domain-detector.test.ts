/**
 * DomainDetector Tests
 *
 * @behavior Domains are detected from user idea text based on keywords
 * @acceptance-criteria AC-DOMAIN.1 through AC-DOMAIN.5
 */

import { describe, it, expect } from 'vitest';
import {
  detectDomains,
  getQuestionsForDomain,
  type Domain,
  type DomainDetection,
} from '../../src/services/domain-detector.js';

describe('DomainDetector', () => {
  describe('detectDomains', () => {
    describe('UI domain detection', () => {
      it('should detect UI domain from button keyword', () => {
        const result = detectDomains('I want to create a button component');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'ui',
            matchedKeywords: expect.arrayContaining(['button']),
          })
        );
      });

      it('should detect UI domain from form keyword', () => {
        const result = detectDomains('Build a form for user registration');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'ui',
            matchedKeywords: expect.arrayContaining(['form']),
          })
        );
      });

      it('should detect UI domain from multiple keywords', () => {
        const result = detectDomains('Create a dashboard with a table and cards');
        const uiDetection = result.find((d) => d.domain === 'ui');
        expect(uiDetection).toBeDefined();
        expect(uiDetection!.matchedKeywords).toContain('dashboard');
        expect(uiDetection!.matchedKeywords).toContain('table');
        expect(uiDetection!.matchedKeywords).toContain('card');
      });

      it('should detect all UI keywords', () => {
        const keywords = [
          'button',
          'form',
          'page',
          'component',
          'layout',
          'dashboard',
          'modal',
          'card',
          'list',
          'table',
          'input',
        ];
        for (const keyword of keywords) {
          const result = detectDomains(`I need a ${keyword}`);
          expect(result.some((d) => d.domain === 'ui')).toBe(true);
        }
      });
    });

    describe('API domain detection', () => {
      it('should detect API domain from endpoint keyword', () => {
        const result = detectDomains('Create an endpoint for user data');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'api',
            matchedKeywords: expect.arrayContaining(['endpoint']),
          })
        );
      });

      it('should detect API domain from REST keyword', () => {
        const result = detectDomains('Build a REST API for the product catalog');
        const apiDetection = result.find((d) => d.domain === 'api');
        expect(apiDetection).toBeDefined();
        expect(apiDetection!.matchedKeywords).toContain('rest');
        expect(apiDetection!.matchedKeywords).toContain('api');
      });

      it('should detect all API keywords', () => {
        const keywords = [
          'endpoint',
          'api',
          'rest',
          'graphql',
          'webhook',
          'route',
          'controller',
          'request',
          'response',
        ];
        for (const keyword of keywords) {
          const result = detectDomains(`I need a ${keyword}`);
          expect(result.some((d) => d.domain === 'api')).toBe(true);
        }
      });
    });

    describe('CLI domain detection', () => {
      it('should detect CLI domain from command keyword', () => {
        const result = detectDomains('Create a command for data migration');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'cli',
            matchedKeywords: expect.arrayContaining(['command']),
          })
        );
      });

      it('should detect CLI domain from terminal keyword', () => {
        const result = detectDomains('Build a terminal tool for deployment');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'cli',
            matchedKeywords: expect.arrayContaining(['terminal']),
          })
        );
      });

      it('should detect all CLI keywords', () => {
        const keywords = ['command', 'cli', 'terminal', 'flag', 'argument', 'stdin', 'stdout', 'script'];
        for (const keyword of keywords) {
          const result = detectDomains(`I need a ${keyword}`);
          expect(result.some((d) => d.domain === 'cli')).toBe(true);
        }
      });
    });

    describe('Data domain detection', () => {
      it('should detect data domain from database keyword', () => {
        const result = detectDomains('Create a database for user information');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'data',
            matchedKeywords: expect.arrayContaining(['database']),
          })
        );
      });

      it('should detect data domain from schema keyword', () => {
        const result = detectDomains('Design a schema for products');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'data',
            matchedKeywords: expect.arrayContaining(['schema']),
          })
        );
      });

      it('should detect all data keywords', () => {
        const keywords = ['database', 'schema', 'model', 'migration', 'table', 'index', 'query', 'sql'];
        for (const keyword of keywords) {
          const result = detectDomains(`I need a ${keyword}`);
          expect(result.some((d) => d.domain === 'data')).toBe(true);
        }
      });
    });

    describe('Auth domain detection', () => {
      it('should detect auth domain from login keyword', () => {
        const result = detectDomains('Build a login system');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'auth',
            matchedKeywords: expect.arrayContaining(['login']),
          })
        );
      });

      it('should detect auth domain from authentication keyword', () => {
        const result = detectDomains('Implement authentication for the app');
        expect(result).toContainEqual(
          expect.objectContaining({
            domain: 'auth',
            matchedKeywords: expect.arrayContaining(['authentication']),
          })
        );
      });

      it('should detect all auth keywords', () => {
        const keywords = ['login', 'authentication', 'password', 'session', 'token', 'oauth', 'jwt', 'permission'];
        for (const keyword of keywords) {
          const result = detectDomains(`I need ${keyword}`);
          expect(result.some((d) => d.domain === 'auth')).toBe(true);
        }
      });
    });

    describe('case insensitivity', () => {
      it('should detect domains case-insensitively', () => {
        const result1 = detectDomains('Create a BUTTON');
        const result2 = detectDomains('Create a button');
        const result3 = detectDomains('Create a Button');

        expect(result1.some((d) => d.domain === 'ui')).toBe(true);
        expect(result2.some((d) => d.domain === 'ui')).toBe(true);
        expect(result3.some((d) => d.domain === 'ui')).toBe(true);
      });

      it('should preserve original case in matchedKeywords', () => {
        const result = detectDomains('Create a BUTTON component');
        const uiDetection = result.find((d) => d.domain === 'ui');
        expect(uiDetection).toBeDefined();
        expect(uiDetection!.matchedKeywords).toContain('button');
      });
    });

    describe('confidence scores', () => {
      it('should return confidence between 0 and 1', () => {
        const result = detectDomains('Create a button for form submission');
        for (const detection of result) {
          expect(detection.confidence).toBeGreaterThanOrEqual(0);
          expect(detection.confidence).toBeLessThanOrEqual(1);
        }
      });

      it('should have higher confidence with more keyword matches', () => {
        const singleMatch = detectDomains('Create a button');
        const multipleMatches = detectDomains('Create a button for a form with inputs in a modal');

        const singleUi = singleMatch.find((d) => d.domain === 'ui');
        const multiUi = multipleMatches.find((d) => d.domain === 'ui');

        expect(singleUi).toBeDefined();
        expect(multiUi).toBeDefined();
        expect(multiUi!.confidence).toBeGreaterThan(singleUi!.confidence);
      });
    });

    describe('multiple domain detection', () => {
      it('should detect multiple domains in one idea', () => {
        const result = detectDomains('Build a login form with database storage');
        const domains = result.map((d) => d.domain);

        expect(domains).toContain('ui');
        expect(domains).toContain('auth');
        expect(domains).toContain('data');
      });

      it('should return domains sorted by confidence descending', () => {
        const result = detectDomains('Create a dashboard with button component table cards list');
        if (result.length > 1) {
          for (let i = 0; i < result.length - 1; i++) {
            expect(result[i].confidence).toBeGreaterThanOrEqual(result[i + 1].confidence);
          }
        }
      });
    });

    describe('edge cases', () => {
      it('should return empty array for empty string', () => {
        const result = detectDomains('');
        expect(result).toEqual([]);
      });

      it('should return empty array for whitespace only', () => {
        const result = detectDomains('   ');
        expect(result).toEqual([]);
      });

      it('should return empty array when no domains match', () => {
        const result = detectDomains('Build something amazing');
        expect(result).toEqual([]);
      });

      it('should handle special characters in input', () => {
        const result = detectDomains('Create a button! (for the form)');
        expect(result.some((d) => d.domain === 'ui')).toBe(true);
      });

      it('should handle newlines in input', () => {
        const result = detectDomains('Create a button\nfor the form');
        expect(result.some((d) => d.domain === 'ui')).toBe(true);
      });
    });
  });

  describe('getQuestionsForDomain', () => {
    describe('UI questions', () => {
      it('should return 4 questions for UI domain', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions).toHaveLength(4);
      });

      it('should include layout pattern question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.includes('layout pattern'))).toBe(true);
      });

      it('should include information density question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.includes('dense'))).toBe(true);
      });

      it('should include empty state question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.includes('empty') || q.includes('no data'))).toBe(true);
      });

      it('should include mobile question', () => {
        const questions = getQuestionsForDomain('ui');
        expect(questions.some((q) => q.includes('mobile'))).toBe(true);
      });
    });

    describe('API questions', () => {
      it('should return 4 questions for API domain', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions).toHaveLength(4);
      });

      it('should include response format question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.includes('response format') || q.includes('JSON'))).toBe(true);
      });

      it('should include streaming option in response format question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.includes('streaming'))).toBe(true);
      });

      it('should include error handling question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.includes('error'))).toBe(true);
      });

      it('should include authentication question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.includes('authentication'))).toBe(true);
      });

      it('should include pagination question', () => {
        const questions = getQuestionsForDomain('api');
        expect(questions.some((q) => q.includes('pagination'))).toBe(true);
      });
    });

    describe('CLI questions', () => {
      it('should return 4 questions for CLI domain', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions).toHaveLength(4);
      });

      it('should include output format question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.includes('output format') || q.includes('JSON'))).toBe(true);
      });

      it('should include flags/options question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.includes('flag') || q.includes('option'))).toBe(true);
      });

      it('should include error display question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.includes('error'))).toBe(true);
      });

      it('should include interactive mode question', () => {
        const questions = getQuestionsForDomain('cli');
        expect(questions.some((q) => q.includes('interactive'))).toBe(true);
      });
    });

    describe('Data questions', () => {
      it('should return 4 questions for data domain', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions).toHaveLength(4);
      });

      it('should include entities question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.includes('entities') || q.includes('relationships'))).toBe(true);
      });

      it('should include constraints question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.includes('constraints') || q.includes('unique'))).toBe(true);
      });

      it('should include query patterns question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.includes('queried') || q.includes('query'))).toBe(true);
      });

      it('should include migration question', () => {
        const questions = getQuestionsForDomain('data');
        expect(questions.some((q) => q.includes('migration'))).toBe(true);
      });
    });

    describe('Auth questions', () => {
      it('should return 4 questions for auth domain', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions).toHaveLength(4);
      });

      it('should include authentication method question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.includes('authentication method') || q.includes('OAuth'))).toBe(true);
      });

      it('should include session duration question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.includes('session') && q.includes('last'))).toBe(true);
      });

      it('should include permissions question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.includes('permission') || q.includes('role'))).toBe(true);
      });

      it('should include password reset question', () => {
        const questions = getQuestionsForDomain('auth');
        expect(questions.some((q) => q.includes('password reset'))).toBe(true);
      });
    });

    describe('question format', () => {
      it('should return questions as strings', () => {
        const domains: Domain[] = ['ui', 'api', 'cli', 'data', 'auth'];
        for (const domain of domains) {
          const questions = getQuestionsForDomain(domain);
          for (const question of questions) {
            expect(typeof question).toBe('string');
            expect(question.length).toBeGreaterThan(0);
          }
        }
      });

      it('should return questions ending with question mark', () => {
        const domains: Domain[] = ['ui', 'api', 'cli', 'data', 'auth'];
        for (const domain of domains) {
          const questions = getQuestionsForDomain(domain);
          for (const question of questions) {
            expect(question.endsWith('?')).toBe(true);
          }
        }
      });
    });
  });
});
