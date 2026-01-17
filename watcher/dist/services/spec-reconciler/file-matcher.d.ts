/**
 * File Matcher
 *
 * Matches spec component names to actual implementation files in the codebase.
 * Supports various naming conventions (PascalCase, kebab-case, camelCase, snake_case).
 *
 * @behavior File matcher finds implementation files for spec components
 * @acceptance-criteria AC-FILE-MATCHER.1 through AC-FILE-MATCHER.6
 */
import { SpecItem } from './types.js';
/**
 * Convert a string to different naming convention variations.
 *
 * @param name - The component name to normalize
 * @returns Array of name variations in different cases
 */
export declare function normalizeComponentName(name: string): string[];
/**
 * Find a file matching the component name in the search paths.
 *
 * @param componentName - The component name to search for
 * @param searchPaths - Directories to search in
 * @returns The matching file path or null if not found
 */
export declare function findMatchingFile(componentName: string, searchPaths: string[]): Promise<string | null>;
/**
 * Find files in the search paths that are not in the spec.
 *
 * @param specComponents - The components listed in the spec
 * @param searchPaths - Directories to search in
 * @returns Array of file paths not matching any spec component
 */
export declare function findExtraFiles(specComponents: SpecItem[], searchPaths: string[]): Promise<string[]>;
//# sourceMappingURL=file-matcher.d.ts.map