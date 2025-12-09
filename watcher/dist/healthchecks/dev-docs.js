/**
 * Dev Docs Health Check
 *
 * Verifies dev docs are being updated:
 * - PROGRESS.md freshness (<1 hour during active work)
 * - Required docs exist (PLAN.md, PROGRESS.md)
 * - Optional docs tracked (DESIGN.md, TESTING.md)
 */
import { promises as fs } from 'fs';
import path from 'path';
const REQUIRED_DOCS = ['PLAN.md', 'PROGRESS.md'];
const OPTIONAL_DOCS = ['DESIGN.md', 'TESTING.md', 'DECISIONS.md', 'NOTES.md'];
const STALENESS_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
/**
 * Check dev docs health for a feature
 */
export async function checkDevDocs(options) {
    const { featurePath, sessionActive = false } = options;
    try {
        // Check which docs exist
        const docStatus = await checkDocsExistence(featurePath);
        // Check if required docs are missing
        const missingRequired = REQUIRED_DOCS.filter((doc) => !docStatus[docKeyName(doc)]);
        if (missingRequired.length > 0) {
            return {
                status: 'fail',
                message: `Required dev docs missing: ${missingRequired.join(', ')}`,
                details: {
                    missingDocs: missingRequired,
                    ...docStatus,
                },
            };
        }
        // Check PROGRESS.md freshness
        const progressPath = path.join(featurePath, 'PROGRESS.md');
        const progressStats = await fs.stat(progressPath);
        const ageMs = Date.now() - progressStats.mtime.getTime();
        const isStale = ageMs > STALENESS_THRESHOLD_MS;
        // Build details
        const details = {
            ...docStatus,
            progressAgeMinutes: Math.floor(ageMs / (60 * 1000)),
        };
        // Warn if stale during active session
        if (isStale && sessionActive) {
            return {
                status: 'warn',
                message: `PROGRESS.md is stale (${Math.floor(ageMs / (60 * 1000))} minutes old)`,
                details,
            };
        }
        // All checks passed
        return {
            status: 'pass',
            message: 'Dev docs are up-to-date',
            details,
        };
    }
    catch (error) {
        return {
            status: 'fail',
            message: `Dev docs check error: ${error.message}`,
        };
    }
}
/**
 * Check which docs exist in the feature path
 */
async function checkDocsExistence(featurePath) {
    const allDocs = [...REQUIRED_DOCS, ...OPTIONAL_DOCS];
    const results = {};
    await Promise.all(allDocs.map(async (doc) => {
        const docPath = path.join(featurePath, doc);
        try {
            await fs.access(docPath);
            results[docKeyName(doc)] = true;
        }
        catch {
            results[docKeyName(doc)] = false;
        }
    }));
    return results;
}
/**
 * Convert doc filename to camelCase key (PLAN.md -> hasPlan)
 */
function docKeyName(filename) {
    const base = filename.replace('.md', '').toLowerCase();
    return `has${base.charAt(0).toUpperCase()}${base.slice(1)}`;
}
//# sourceMappingURL=dev-docs.js.map