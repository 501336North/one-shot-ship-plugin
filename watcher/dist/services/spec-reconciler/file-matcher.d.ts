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
 * Interface for file list cache to avoid repeated directory traversals.
 */
export interface FileListCache {
    getFiles(searchPath: string): Promise<string[]>;
}
/**
 * Creates a file list cache for a reconciliation cycle.
 * Caches file listings per search path to avoid repeated directory traversals.
 *
 * @returns A cache object with getFiles method
 */
export declare function createFileListCache(): FileListCache;
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
 * @param cache - Optional file list cache for performance optimization
 * @returns The matching file path or null if not found
 */
export declare function findMatchingFile(componentName: string, searchPaths: string[], cache?: FileListCache): Promise<string | null>;
/**
 * Find files in the search paths that are not in the spec.
 *
 * @param specComponents - The components listed in the spec
 * @param searchPaths - Directories to search in
 * @param cache - Optional file list cache for performance optimization
 * @returns Array of file paths not matching any spec component
 */
export declare function findExtraFiles(specComponents: SpecItem[], searchPaths: string[], cache?: FileListCache): Promise<string[]>;
//# sourceMappingURL=file-matcher.d.ts.map