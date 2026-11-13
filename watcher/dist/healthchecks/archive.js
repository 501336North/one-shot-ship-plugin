import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { shipArchivable } from '../phase-results/archivable.js';
/** The plugin root this module sits in (<root>/watcher/{src,dist}/healthchecks/): the ship schema's home. */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/**
 * @behavior Verify shipped features are being archived properly
 * @acceptance-criteria A feature whose ship phase result passes the archive rule (phase-results/archivable.ts:
 *   valid, bound, verified, ready_to_merge) should be moved to dev/completed/. PROGRESS.md prose never decides
 *   (R-257 AC-006.1).
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
        // The repo that holds dev/active (<repo>/.oss/dev/active): results and the ledger are keyed on it
        const repo = path.resolve(devActivePath, '..', '..', '..');
        for (const dir of featureDirs) {
            try {
                if (shipArchivable(repo, dir.name, PLUGIN_ROOT).ok)
                    completedFeatures.push(dir.name);
            }
            catch {
                // unreadable ledger or a bad name: not completed
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