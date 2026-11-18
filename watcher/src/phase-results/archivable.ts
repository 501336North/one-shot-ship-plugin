/**
 * The archive rule (R-257 T13, T14; D13, D14, AC-004.5, AC-006.1): one rule for the archive hook (through
 * `phase-result check ship --all`) and the archive healthcheck.
 *
 * A feature's ship result is archivable when results/ship.json reads safely, its bytes are bound in the ledger
 * (`results/<feature>/ship`, last row, written by this machine's assembler in any session), it is schema-valid and
 * verified, there is no repo or ledger unverified/pending marker, it comes from the feature's LAST ship run (round 1
 * finding 8: its startedAt equals that of the last `run/ship` row naming this feature, so a later ship run of the
 * feature with no new result is not archivable; run/ship is per repo, so other features' runs are ignored; pen N5: a
 * run/ship row with feature "" or no feature field, started after the result, may be this feature's re-ship, so it
 * makes the result stale too), and the verdict is ready_to_merge. run/ship is read from its end backwards (ledger
 * scanBack, performance L3), stopping at the first row that decides. It does not compare HEAD: archive runs in a later session, after the merge moved HEAD on.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openLedger, type Ledger } from './ledger.js';
import { loadPhaseSchema } from './schemas.js';
import { readResult } from './store.js';
import { validate } from './validate.js';

export type ArchiveVerdict = { ok: true } | { ok: false; reason: string };

/**
 * True when run/ship holds a run of `feature` the result is not from: the newest row naming the feature has another
 * startedAt (finding 8), or a row with feature "" or none started after the result (pen N5). Newest rows first; a
 * no-feature row with the result's own startedAt is the result's run and ends the scan as fresh.
 */
function laterShipRun(ledger: Ledger, feature: string, resultStart: unknown): boolean {
  const start = typeof resultStart === 'string' ? Date.parse(resultStart) : NaN;
  let stale = false;
  ledger.scanBack('run/ship', (row) => {
    if (row.feature === feature) {
      stale = row.startedAt !== resultStart;
      return false;
    }
    if (row.feature !== '' && row.feature !== undefined) return true;
    // A no-feature row: the result's own run (same startedAt) decides fresh; one started after it, stale.
    if (row.startedAt === resultStart) return false;
    const rowStart = typeof row.startedAt === 'string' ? Date.parse(row.startedAt) : NaN;
    stale = !(rowStart <= start);
    return !stale;
  });
  return stale;
}

/** Throws LedgerError or a store error (`bad_feature: ...`) for the caller to report. */
export function shipArchivable(repo: string, feature: string, pluginRoot: string): ArchiveVerdict {
  const marker = path.join(repo, '.oss', 'dev', 'active', feature, 'results', 'ship.unverified.json');
  if (fs.lstatSync(marker, { throwIfNoEntry: false }) !== undefined) return { ok: false, reason: 'unverified' };
  const read = readResult(repo, feature, 'ship');
  if (!read.ok) return { ok: false, reason: read.error };
  const ledger = openLedger(repo);
  for (const kind of ['pending', 'unverified']) {
    if (ledger.hasMarker(`${kind}/${feature}/ship`)) return { ok: false, reason: 'unverified' };
  }
  const sha = createHash('sha256').update(read.bytes).digest('hex');
  if (ledger.lastRow(`results/${feature}/ship`)?.sha256 !== sha) return { ok: false, reason: 'unbound_result' };
  const v = validate(loadPhaseSchema('ship', pluginRoot), read.value);
  if (!v.ok) return { ok: false, reason: 'invalid_result' };
  const stored = read.value as Record<string, unknown>;
  if (stored.verification !== 'verified') return { ok: false, reason: 'unverified' };
  if (laterShipRun(ledger, feature, stored.startedAt)) return { ok: false, reason: 'stale_result' };
  if (stored.verdict !== 'ready_to_merge') return { ok: false, reason: 'not_ready_to_merge' };
  return { ok: true };
}
