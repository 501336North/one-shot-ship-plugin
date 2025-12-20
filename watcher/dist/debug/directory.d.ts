/**
 * Directory Strategy Selection
 * Selects directory for debug documentation
 */
import type { ParsedBug } from './bug-parser.js';
/**
 * Select directory for debug docs
 * Returns existing feature dir if bug relates, null otherwise
 */
export declare function selectDirectory(bug: ParsedBug, activeFeatures: string[]): string | null;
/**
 * Create bugfix directory name from description
 */
export declare function createBugfixDirName(description: string): string;
/**
 * Sanitize directory name
 */
export declare function sanitizeDirName(name: string): string;
//# sourceMappingURL=directory.d.ts.map