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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
/**
 * Get the dev docs base path for a project.
 *
 * @param projectDir - The project directory path
 * @returns The dev docs base path (contains active/ and completed/)
 */
export function getDevDocsPath(projectDir) {
    // Priority 1: Project .oss/dev/
    const projectOssDev = path.join(projectDir, '.oss', 'dev');
    if (fs.existsSync(path.join(projectOssDev, 'active'))) {
        return projectOssDev;
    }
    // Priority 2: Project dev/ (backward compatibility)
    const projectDev = path.join(projectDir, 'dev');
    if (fs.existsSync(path.join(projectDev, 'active'))) {
        return projectDev;
    }
    // Priority 3: Global ~/.oss/dev/ (fallback)
    return path.join(os.homedir(), '.oss', 'dev');
}
/**
 * Get the path to a specific feature's active docs.
 *
 * @param projectDir - The project directory path
 * @param featureName - The feature name
 * @returns The path to the feature's active docs directory
 */
export function getActiveFeaturePath(projectDir, featureName) {
    const devDocsPath = getDevDocsPath(projectDir);
    return path.join(devDocsPath, 'active', featureName);
}
/**
 * Get the path to the completed features directory.
 *
 * @param projectDir - The project directory path
 * @returns The path to the completed features directory
 */
export function getCompletedPath(projectDir) {
    const devDocsPath = getDevDocsPath(projectDir);
    return path.join(devDocsPath, 'completed');
}
//# sourceMappingURL=dev-docs-path.js.map