/**
 * The git binary phase-result and Stop code runs (R-257, D33): a fixed system location, never looked up on PATH, so a
 * `git` planted early on PATH cannot decide a check. Homebrew's paths sit at the recorded node's trust level (D21).
 * ledger.ts keeps its own copy of this list (child processes import it with type stripping, builtins only).
 */
import * as fs from 'node:fs';
const CANDIDATES = ['/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git', '/bin/git'];
/** The first candidate that is a regular executable file; '' when none is, so callers fail closed. */
export function gitBin() {
    for (const p of CANDIDATES) {
        try {
            if (!fs.statSync(p).isFile())
                continue;
            fs.accessSync(p, fs.constants.X_OK);
            return p;
        }
        catch {
            /* missing or not executable: try the next one */
        }
    }
    return '';
}
//# sourceMappingURL=git-bin.js.map