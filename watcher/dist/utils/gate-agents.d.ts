/**
 * The review (gate) agents, read for the offloader without loading the tool gate (which ships only as a
 * bundle): the plugin's config/tool-gates.json gateAgents, plus any names a repo's .oss/tool-gates.json
 * adds. A repo file can only add; a missing or broken one is ignored. A missing or broken plugin list throws.
 */
export declare function readGateAgents(pluginRoot: string, repoRoot: string): string[];
//# sourceMappingURL=gate-agents.d.ts.map