/**
 * node-guard — preflight that Node is present and new enough.
 *
 * The launcher/offload paths shell out to `node`. If Node is missing or too old (the exact
 * gap that silently broke local routing on DeepBlue), fail LOUDLY rather than letting the
 * session run all-cloud with no signal.
 */
export interface NodeCheck {
    ok: boolean;
    major?: number;
    message?: string;
}
/**
 * @param version e.g. process.version ("v20.11.0"), or undefined if node couldn't be run.
 * @param minMajor minimum required major version.
 */
export declare function checkNode(version: string | undefined, minMajor?: number): NodeCheck;
//# sourceMappingURL=node-guard.d.ts.map