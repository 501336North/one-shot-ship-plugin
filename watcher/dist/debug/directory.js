/**
 * Directory Strategy Selection
 * Selects directory for debug documentation
 */
/**
 * Select directory for debug docs
 * Returns existing feature dir if bug relates, null otherwise
 */
export function selectDirectory(bug, activeFeatures) {
    if (!bug.component) {
        return null;
    }
    // Check if component matches any active feature
    for (const feature of activeFeatures) {
        if (feature.toLowerCase().includes(bug.component.toLowerCase())) {
            return feature;
        }
    }
    return null;
}
/**
 * Create bugfix directory name from description
 */
export function createBugfixDirName(description) {
    const sanitized = sanitizeDirName(description);
    const withPrefix = `bugfix-${sanitized}`;
    // Limit to 30 characters
    if (withPrefix.length > 30) {
        return withPrefix.substring(0, 30);
    }
    return withPrefix;
}
/**
 * Sanitize directory name
 */
export function sanitizeDirName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-'); // Remove duplicate hyphens
}
//# sourceMappingURL=directory.js.map