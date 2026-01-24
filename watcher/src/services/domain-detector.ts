/**
 * DomainDetector - Detect domains from user idea text
 *
 * @behavior Domains are detected from user idea text based on keywords
 * @acceptance-criteria AC-DOMAIN.1 through AC-DOMAIN.5
 */

/**
 * Supported domain types
 */
export type Domain = 'ui' | 'api' | 'cli' | 'data' | 'auth';

/**
 * Result of domain detection including confidence score
 */
export interface DomainDetection {
  domain: Domain;
  confidence: number; // 0-1
  matchedKeywords: string[];
}

/**
 * Questions for a specific domain
 */
export interface DomainQuestions {
  domain: Domain;
  questions: string[];
}

/**
 * Keywords for each domain (lowercase for matching)
 */
const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  ui: ['button', 'form', 'page', 'component', 'layout', 'dashboard', 'modal', 'card', 'list', 'table', 'input'],
  api: ['endpoint', 'api', 'rest', 'graphql', 'webhook', 'route', 'controller', 'request', 'response'],
  cli: ['command', 'cli', 'terminal', 'flag', 'argument', 'stdin', 'stdout', 'script'],
  data: ['database', 'schema', 'model', 'migration', 'table', 'index', 'query', 'sql'],
  auth: ['login', 'authentication', 'password', 'session', 'token', 'oauth', 'jwt', 'permission'],
};

/**
 * Questions for each domain
 */
const DOMAIN_QUESTIONS: Record<Domain, string[]> = {
  ui: [
    'What layout pattern should this use (list, grid, cards, table)?',
    'How dense should the information be?',
    "What happens when there's no data (empty state)?",
    'How should it adapt on mobile devices?',
  ],
  api: [
    'What response format (JSON, XML, streaming)?',
    'How should errors be returned?',
    'What authentication is required?',
    'Is pagination needed for list endpoints?',
  ],
  cli: [
    'What output format (plain text, JSON, table)?',
    'What flags/options should it support?',
    'How should errors be displayed?',
    'Should it support interactive mode?',
  ],
  data: [
    'What are the key entities and relationships?',
    'What constraints are needed (unique, required, etc.)?',
    'How will data be queried most often?',
    'Are there migration considerations?',
  ],
  auth: [
    'What authentication method (password, OAuth, API key)?',
    'How long should sessions last?',
    'What permissions/roles are needed?',
    'How should password reset work?',
  ],
};

/**
 * Detect domains from user idea text
 *
 * @param ideaText - The user's idea text to analyze
 * @returns Array of detected domains with confidence scores, sorted by confidence descending
 */
export function detectDomains(ideaText: string): DomainDetection[] {
  // Handle empty or whitespace-only input
  if (!ideaText || ideaText.trim().length === 0) {
    return [];
  }

  const lowerText = ideaText.toLowerCase();
  const detections: DomainDetection[] = [];

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [Domain, string[]][]) {
    const matchedKeywords: string[] = [];

    for (const keyword of keywords) {
      // Use word boundary matching to avoid partial matches
      const regex = new RegExp(`\\b${escapeRegExp(keyword)}s?\\b`, 'gi');
      if (regex.test(lowerText)) {
        // Store the keyword in lowercase (normalized form)
        matchedKeywords.push(keyword);
      }
    }

    if (matchedKeywords.length > 0) {
      // Calculate confidence based on number of matches
      // More matches = higher confidence, capped at 1.0
      const confidence = Math.min(matchedKeywords.length / keywords.length + 0.1, 1.0);

      detections.push({
        domain,
        confidence,
        matchedKeywords,
      });
    }
  }

  // Sort by confidence descending
  detections.sort((a, b) => b.confidence - a.confidence);

  return detections;
}

/**
 * Get questions for a specific domain
 *
 * @param domain - The domain to get questions for
 * @returns Array of questions for the domain
 */
export function getQuestionsForDomain(domain: Domain): string[] {
  return DOMAIN_QUESTIONS[domain] || [];
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
