/**
 * Dev Docs Path Resolver
 *
 * Resolves dev docs paths with project-local priority for multi-project support.
 *
 * Priority order:
 * 1. Project .oss/dev/ (canonical project-local)
 * 2. Project dev/ (backward compatibility)
 * 3. Global ~/.oss/dev/ (fallback)
 */
/**
 * Get the dev docs base path for a project.
 *
 * @param projectDir - The project directory path
 * @returns The dev docs base path (contains active/ and completed/)
 */
export declare function getDevDocsPath(projectDir: string): string;
/**
 * Get the path to a specific feature's active docs.
 *
 * @param projectDir - The project directory path
 * @param featureName - The feature name
 * @returns The path to the feature's active docs directory
 */
export declare function getActiveFeaturePath(projectDir: string, featureName: string): string;
/**
 * Get the path to the completed features directory.
 *
 * @param projectDir - The project directory path
 * @returns The path to the completed features directory
 */
export declare function getCompletedPath(projectDir: string): string;
//# sourceMappingURL=dev-docs-path.d.ts.map