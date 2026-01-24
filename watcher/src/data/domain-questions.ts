/**
 * Domain-specific Question Banks
 *
 * @behavior Provides deep questions for each domain to gather requirements
 * @acceptance-criteria AC-DOMAIN-Q.1 through AC-DOMAIN-Q.5
 */

/**
 * All supported domain types
 */
export const ALL_DOMAINS = ['ui', 'api', 'cli', 'data', 'auth'] as const;

/**
 * Supported domain types
 */
export type Domain = (typeof ALL_DOMAINS)[number];

/**
 * Question bank for a specific domain
 */
export interface DomainQuestionBank {
  domain: Domain;
  questions: readonly string[];
}

/**
 * Domain-specific questions (4 per domain)
 * These are deep questions to gather requirements for each domain.
 */
const DOMAIN_QUESTIONS: Readonly<Record<Domain, readonly string[]>> = {
  ui: [
    'What are the accessibility requirements (WCAG level, screen reader support)?',
    'What responsive breakpoints should be supported (mobile, tablet, desktop)?',
    'Which component library or design system will be used?',
    'Are there animation or interaction requirements for this component?',
  ],
  api: [
    'What authentication method is required (API key, OAuth, JWT)?',
    'What rate limiting strategy should be applied?',
    'What versioning approach will be used (URL, header, query param)?',
    'What error response format should be returned (RFC 7807, custom)?',
  ],
  cli: [
    'What argument parsing style is preferred (POSIX, GNU, custom)?',
    'What output format should be supported (text, JSON, table)?',
    'Is interactive mode needed for this command?',
    'Where should the config file be located?',
  ],
  data: [
    'What data persistence/storage solution will be used?',
    'What schema migration strategy should be followed?',
    'What backup requirements exist for this data?',
    'What is the data retention policy?',
  ],
  auth: [
    'Should this use session-based or token-based authentication?',
    'Are MFA/multi-factor authentication requirements needed?',
    'What password policy should be enforced?',
    'Which OAuth providers should be supported?',
  ],
};

/**
 * Get questions for a specific domain
 *
 * @param domain - The domain to get questions for
 * @returns Array of questions for the domain
 */
export function getQuestionsForDomain(domain: Domain): string[] {
  return [...DOMAIN_QUESTIONS[domain]];
}

/**
 * Get all domain question banks
 *
 * @returns Array of all domain question banks
 */
export function getAllDomainQuestions(): DomainQuestionBank[] {
  return ALL_DOMAINS.map((domain) => ({
    domain,
    questions: DOMAIN_QUESTIONS[domain],
  }));
}
