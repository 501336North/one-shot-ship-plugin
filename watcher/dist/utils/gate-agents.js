/**
 * The review (gate) agents, read for the offloader without loading the tool gate (which ships only as a
 * bundle): the plugin's config/tool-gates.json gateAgents, plus any names a repo's .oss/tool-gates.json
 * adds. A repo file can only add; a missing or broken one is ignored. A missing or broken plugin list throws.
 */
import * as path from 'path';
import { readRegularFileSyncOrNull } from './regular-file.js';
function namesIn(file) {
    try {
        const text = readRegularFileSyncOrNull(file);
        const list = text === null ? null : JSON.parse(text)?.gateAgents;
        return Array.isArray(list) && list.every((n) => typeof n === 'string' && n.length > 0) ? list : null;
    }
    catch {
        return null;
    }
}
export function readGateAgents(pluginRoot, repoRoot) {
    const base = namesIn(path.join(pluginRoot, 'config', 'tool-gates.json'));
    if (base === null)
        throw new Error('plugin gateAgents is missing or invalid');
    return [...new Set([...base, ...(namesIn(path.join(repoRoot, '.oss', 'tool-gates.json')) ?? [])])];
}
//# sourceMappingURL=gate-agents.js.map