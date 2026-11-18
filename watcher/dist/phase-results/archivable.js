/**
 * The archive rule (R-257 T13, T14; D13, D14, AC-004.5, AC-006.1): one rule for the archive hook (through
 * `phase-result check ship --all`) and the archive healthcheck.
 *
 * A feature's ship result is archivable when results/ship.json reads safely, its bytes are bound in the ledger
 * (`results/<feature>/ship`, last row, written by this machine's assembler in any session), it is schema-valid and
 * verified, there is no repo or ledger unverified/pending marker, it comes from the feature's LAST ship run (round 1
 * finding 8: its startedAt equals that of the last `run/ship` row naming this feature, so a later ship run of the
 * feature with no new result is not archivable; run/ship is per repo, so other features' runs are ignored), and the
 * verdict is ready_to_merge. It does not compare HEAD: archive runs in a later session, after the merge moved HEAD on.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openLedger } from './ledger.js';
import { loadPhaseSchema } from './schemas.js';
import { readResult } from './store.js';
import { validate } from './validate.js';
/** Throws LedgerError or a store error (`bad_feature: ...`) for the caller to report. */
export function shipArchivable(repo, feature, pluginRoot) {
    const marker = path.join(repo, '.oss', 'dev', 'active', feature, 'results', 'ship.unverified.json');
    if (fs.lstatSync(marker, { throwIfNoEntry: false }) !== undefined)
        return { ok: false, reason: 'unverified' };
    const read = readResult(repo, feature, 'ship');
    if (!read.ok)
        return { ok: false, reason: read.error };
    const ledger = openLedger(repo);
    for (const kind of ['pending', 'unverified']) {
        if (ledger.hasMarker(`${kind}/${feature}/ship`))
            return { ok: false, reason: 'unverified' };
    }
    const sha = createHash('sha256').update(read.bytes).digest('hex');
    if (ledger.lastRow(`results/${feature}/ship`)?.sha256 !== sha)
        return { ok: false, reason: 'unbound_result' };
    const v = validate(loadPhaseSchema('ship', pluginRoot), read.value);
    if (!v.ok)
        return { ok: false, reason: 'invalid_result' };
    const stored = read.value;
    if (stored.verification !== 'verified')
        return { ok: false, reason: 'unverified' };
    const runs = ledger.readRows('run/ship').filter((r) => r.feature === feature);
    if (runs.length > 0 && stored.startedAt !== runs[runs.length - 1].startedAt)
        return { ok: false, reason: 'stale_result' };
    if (stored.verdict !== 'ready_to_merge')
        return { ok: false, reason: 'not_ready_to_merge' };
    return { ok: true };
}
//# sourceMappingURL=archivable.js.map