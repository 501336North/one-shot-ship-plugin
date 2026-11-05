/**
 * A repo's leftover agent model mappings (T88). Since 2.0.97 (T71b) a project's .oss/config.json no longer picks an
 * agent's model; this reads it only to tell the customer which mappings were ignored and how to keep them. It never
 * feeds routing. The repo is untrusted: the file is read hang-safe, and every value is cleaned before it is shown.
 */
/** The notice for an agent that ran on Claude while the repo maps it (or its default) to another model; else undefined. */
export declare function repoAgentModelNotice(projectDir: string, agentName: string): string | undefined;
/** One notice per agent the repo maps to a non-Claude model, at most `limit`. */
export declare function repoAgentModelNotices(projectDir: string, limit?: number): string[];
//# sourceMappingURL=repo-agent-models.d.ts.map