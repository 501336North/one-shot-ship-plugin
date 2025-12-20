/**
 * Reproduction Test Generator
 * Generates failing test that proves bug exists (TDD RED phase)
 */
import type { ParsedBug } from './bug-parser.js';
import type { RootCause } from './investigation.js';
import type { SeverityLevel } from './severity.js';
import type { TaskParams } from './investigation.js';
export interface ConfirmedBug extends ParsedBug {
    rootCause: RootCause;
    severity: SeverityLevel;
    file?: string;
}
/**
 * Generate test file path based on bug location
 */
export declare function getTestPath(bug: {
    file?: string;
}): string;
/**
 * Generate test content that encodes expected behavior
 */
export declare function generateTestContent(bug: ConfirmedBug): string;
/**
 * Create test-engineer task for writing reproduction test
 */
export declare function createTestTask(bug: ConfirmedBug): TaskParams;
//# sourceMappingURL=reproduction.d.ts.map