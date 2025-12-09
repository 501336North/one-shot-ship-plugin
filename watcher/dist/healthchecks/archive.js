import { promises as fs } from 'fs';
import * as path from 'path';
/**
 * @behavior Verify shipped features are being archived properly
 * @acceptance-criteria Features in "ship" or "complete" phase should be moved to dev/completed/
 * @boundary Healthcheck
 */
export async function checkArchive(options) {
    const { devActivePath } = options;
    try {
        // Read all entries in dev/active/
        const entries = await fs.readdir(devActivePath, { withFileTypes: true });
        // Filter to directories only
        const featureDirs = entries.filter((entry) => entry.isDirectory());
        const completedFeatures = [];
        // Check each feature's PROGRESS.md for completion status
        for (const dir of featureDirs) {
            const featureName = dir.name;
            const progressPath = path.join(devActivePath, featureName, 'PROGRESS.md');
            try {
                const content = await fs.readFile(progressPath, 'utf-8');
                // Check for completion patterns (case-insensitive)
                const isCompleted = /## Current Phase:\s*(ship|complete)/i.test(content) ||
                    /\(complete\)/i.test(content);
                if (isCompleted) {
                    completedFeatures.push(featureName);
                }
            }
            catch (error) {
                // Skip features without PROGRESS.md (treat as not completed)
                continue;
            }
        }
        // Build result
        const details = {
            completedFeatures,
            suggestedAction: 'Run /oss:plan to auto-archive completed features to dev/completed/',
        };
        if (completedFeatures.length > 0) {
            details.unarchived = completedFeatures;
            return {
                status: 'warn',
                message: `Found ${completedFeatures.length} completed features not archived: ${completedFeatures.join(', ')}`,
                details,
            };
        }
        return {
            status: 'pass',
            message: 'All completed features have been archived',
            details,
        };
    }
    catch (error) {
        return {
            status: 'fail',
            message: `Failed to check archive status: ${error instanceof Error ? error.message : String(error)}`,
            details: {},
        };
    }
}
//# sourceMappingURL=archive.js.map