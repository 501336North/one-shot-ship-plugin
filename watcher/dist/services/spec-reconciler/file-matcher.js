/**
 * File Matcher
 *
 * Matches spec component names to actual implementation files in the codebase.
 * Supports various naming conventions (PascalCase, kebab-case, camelCase, snake_case).
 *
 * @behavior File matcher finds implementation files for spec components
 * @acceptance-criteria AC-FILE-MATCHER.1 through AC-FILE-MATCHER.6
 */
import * as fs from 'fs';
import * as path from 'path';
/**
 * Creates a file list cache for a reconciliation cycle.
 * Caches file listings per search path to avoid repeated directory traversals.
 *
 * @returns A cache object with getFiles method
 */
export function createFileListCache() {
    const cache = new Map();
    return {
        async getFiles(searchPath) {
            if (cache.has(searchPath)) {
                return cache.get(searchPath);
            }
            const files = await findAllFiles(searchPath);
            cache.set(searchPath, files);
            return files;
        },
    };
}
/**
 * File extensions to search for (in order of preference).
 */
const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
/**
 * Files/patterns to ignore when searching.
 */
const IGNORE_PATTERNS = [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /node_modules/,
    /\.d\.ts$/,
];
/**
 * Files to ignore when checking for extras.
 */
const IGNORED_FILE_NAMES = ['index', 'types', 'constants', 'utils'];
/**
 * Convert a string to different naming convention variations.
 *
 * @param name - The component name to normalize
 * @returns Array of name variations in different cases
 */
export function normalizeComponentName(name) {
    const variations = new Set();
    // Add original
    variations.add(name);
    // Detect if already in different formats and extract words
    const words = extractWords(name);
    // PascalCase
    const pascalCase = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    variations.add(pascalCase);
    // camelCase
    const camelCase = words
        .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join('');
    variations.add(camelCase);
    // kebab-case
    const kebabCase = words.map((w) => w.toLowerCase()).join('-');
    variations.add(kebabCase);
    // snake_case
    const snakeCase = words.map((w) => w.toLowerCase()).join('_');
    variations.add(snakeCase);
    // lowercase
    const lowerCase = words.join('').toLowerCase();
    variations.add(lowerCase);
    return Array.from(variations);
}
/**
 * Extract words from a name (handles PascalCase, camelCase, kebab-case, snake_case).
 */
function extractWords(name) {
    // Handle kebab-case and snake_case
    if (name.includes('-') || name.includes('_')) {
        return name.split(/[-_]/).filter((w) => w.length > 0);
    }
    // Handle PascalCase, camelCase, and acronyms
    // Use regex to split: captures sequences of uppercase (acronyms) or upper+lower (normal words)
    const matches = name.match(/[A-Z]{2,}(?=[A-Z][a-z]|$)|[A-Z][a-z]*|[a-z]+/g);
    if (matches && matches.length > 0) {
        return matches;
    }
    return [name];
}
/**
 * Check if a file path should be ignored.
 */
function shouldIgnorePath(filePath) {
    return IGNORE_PATTERNS.some((pattern) => pattern.test(filePath));
}
/**
 * Recursively find all files in a directory.
 * Uses parallel traversal for sibling directories.
 */
async function findAllFiles(dir) {
    const files = [];
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        // Separate files and directories
        const directoryPromises = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (shouldIgnorePath(fullPath)) {
                continue;
            }
            if (entry.isDirectory()) {
                // Queue directory traversal for parallel execution
                directoryPromises.push(findAllFiles(fullPath));
            }
            else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (FILE_EXTENSIONS.includes(ext)) {
                    files.push(fullPath);
                }
            }
        }
        // Traverse all subdirectories in parallel
        if (directoryPromises.length > 0) {
            const subFileArrays = await Promise.all(directoryPromises);
            for (const subFiles of subFileArrays) {
                files.push(...subFiles);
            }
        }
    }
    catch {
        // Directory might not exist or not be accessible
    }
    return files;
}
/**
 * Find a file matching the component name in the search paths.
 *
 * @param componentName - The component name to search for
 * @param searchPaths - Directories to search in
 * @param cache - Optional file list cache for performance optimization
 * @returns The matching file path or null if not found
 */
export async function findMatchingFile(componentName, searchPaths, cache) {
    const nameVariations = normalizeComponentName(componentName);
    const foundFiles = new Map(); // basename -> fullPath
    for (const searchPath of searchPaths) {
        const files = cache ? await cache.getFiles(searchPath) : await findAllFiles(searchPath);
        for (const file of files) {
            if (shouldIgnorePath(file)) {
                continue;
            }
            const basename = path.basename(file);
            const nameWithoutExt = basename.replace(/\.[jt]sx?$/, '');
            // Check if any name variation matches
            if (nameVariations.some((variation) => variation.toLowerCase() === nameWithoutExt.toLowerCase())) {
                // Track by extension preference
                const ext = path.extname(basename);
                const existingFile = foundFiles.get(nameWithoutExt.toLowerCase());
                if (!existingFile) {
                    foundFiles.set(nameWithoutExt.toLowerCase(), file);
                }
                else {
                    // Prefer .ts over .js, .tsx over .jsx
                    const existingExt = path.extname(existingFile);
                    const extPriority = FILE_EXTENSIONS.indexOf(ext);
                    const existingExtPriority = FILE_EXTENSIONS.indexOf(existingExt);
                    if (extPriority < existingExtPriority) {
                        foundFiles.set(nameWithoutExt.toLowerCase(), file);
                    }
                }
            }
        }
    }
    // Return the first match found
    if (foundFiles.size > 0) {
        return foundFiles.values().next().value ?? null;
    }
    return null;
}
/**
 * Find files in the search paths that are not in the spec.
 *
 * @param specComponents - The components listed in the spec
 * @param searchPaths - Directories to search in
 * @param cache - Optional file list cache for performance optimization
 * @returns Array of file paths not matching any spec component
 */
export async function findExtraFiles(specComponents, searchPaths, cache) {
    const extras = [];
    // Get all name variations for spec components
    const specNameVariations = new Set();
    for (const component of specComponents) {
        const variations = normalizeComponentName(component.id);
        for (const v of variations) {
            specNameVariations.add(v.toLowerCase());
        }
    }
    for (const searchPath of searchPaths) {
        const files = cache ? await cache.getFiles(searchPath) : await findAllFiles(searchPath);
        for (const file of files) {
            if (shouldIgnorePath(file)) {
                continue;
            }
            const basename = path.basename(file);
            const nameWithoutExt = basename.replace(/\.[jt]sx?$/, '');
            // Skip ignored file names
            if (IGNORED_FILE_NAMES.includes(nameWithoutExt.toLowerCase())) {
                continue;
            }
            // Check if this file matches any spec component
            const fileVariations = normalizeComponentName(nameWithoutExt);
            const hasMatch = fileVariations.some((v) => specNameVariations.has(v.toLowerCase()));
            if (!hasMatch) {
                extras.push(file);
            }
        }
    }
    return extras;
}
//# sourceMappingURL=file-matcher.js.map