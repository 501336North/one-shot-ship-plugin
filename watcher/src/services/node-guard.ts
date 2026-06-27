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
export function checkNode(version: string | undefined, minMajor = 18): NodeCheck {
  if (!version) {
    return {
      ok: false,
      message:
        'Node.js was not found. Local model routing requires Node >= ' +
        minMajor +
        '. Install Node and retry (e.g. via your version manager).',
    };
  }
  const m = version.match(/v?(\d+)\./);
  const major = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(major) || major < minMajor) {
    return {
      ok: false,
      major: Number.isFinite(major) ? major : undefined,
      message: `Node.js ${version} is too old; local model routing requires Node >= ${minMajor}.`,
    };
  }
  return { ok: true, major };
}
