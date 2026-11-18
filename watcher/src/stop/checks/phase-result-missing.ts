/**
 * Stop check `phase-result-missing` (R-257 T11, US-004): the phase started in this repo has no valid result.
 * Unbound (no ledger results row for this run's startedAt) blocks at once; a bound result must pass the phase-result
 * CLI's `check`. Path problems (a link, a FIFO, an oversized file) block. A CLI that times out or dies throws, so the
 * dispatcher fails open (ADR-1).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readResult } from '../../phase-results/store.js';
import type { CheckOutcome, StopCheck, StopSubject } from '../types.js';

const CLI_TIMEOUT_MS = 4000;
const PATH_PROBLEMS = ['unsafe_path', 'too_large'];

function namedError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

/** <offFeature>: the run's feature, when the branch resolves elsewhere (round 3, finding 2): assemble must run there. */
export function blockFor(phase: string, id: string, pathProblem: boolean, offFeature?: string): CheckOutcome {
  const reason =
    offFeature === undefined
      ? `OSS: the ${phase} phase has no valid result for this run (${id}). ` +
        `Run ~/.oss/hooks/oss-phase-result.sh assemble ${phase} before stopping.`
      : `OSS: the ${phase} phase of feature ${offFeature} has no valid result for this run (${id}). ` +
        `Check out ${offFeature}'s branch and run ~/.oss/hooks/oss-phase-result.sh assemble ${phase} before stopping.`;
  return pathProblem
    ? { kind: 'block', reason, systemMessage: `OSS: ${phase} result refused (${id}): a linked, special or oversized file` }
    : { kind: 'block', reason };
}

/**
 * The phase-result CLI checks the feature the branch resolves to, so a subject off the branch is checked here, as the
 * shell fast path does: no marker, and the result's bytes hash to the bound ledger row. null when it holds.
 */
function offBranchProblem(s: StopSubject, bytes: Buffer | null): string | null {
  if (bytes === null) return 'missing';
  const marker = path.join(s.repo, '.oss', 'dev', 'active', s.feature, 'results', `${s.phase}.unverified.json`);
  if (fs.lstatSync(marker, { throwIfNoEntry: false }) !== undefined) return 'unverified';
  for (const kind of ['pending', 'unverified']) if (s.ledger.hasMarker(`${kind}/${s.feature}/${s.phase}`)) return 'unverified';
  const sha = createHash('sha256').update(bytes).digest('hex');
  return s.ledger.lastRow(`results/${s.feature}/${s.phase}`)?.sha256 === sha ? null : 'unbound_result';
}

export const phaseResultMissing: StopCheck = {
  id: 'phase-result-missing',
  run(ctx) {
    const s = ctx.subject;
    if (s === null) return { kind: 'allow' };
    const read = readResult(s.repo, s.feature, s.phase);
    const off = s.offBranch ? s.feature : undefined;
    if (!read.ok && PATH_PROBLEMS.includes(read.error)) return blockFor(s.phase, read.error, true, off);
    if (!s.bound) return blockFor(s.phase, read.ok ? 'unbound_result' : read.error, false, off);
    if (s.offBranch) {
      const id = offBranchProblem(s, read.ok ? read.bytes : null);
      return id === null ? { kind: 'allow' } : blockFor(s.phase, id, false, off);
    }
    const r = spawnSync(process.execPath, [ctx.phaseResultCli, 'check', s.phase, '--repo', s.repo], {
      cwd: s.repo,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    if (r.error !== undefined) throw namedError((r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timeout' : 'cli_failed');
    if (r.status === 0) return { kind: 'allow' };
    if (r.status === 1) {
      const id = /^phase-result: \S+ \S+: ([a-z_]+)/m.exec(r.stderr)?.[1] ?? 'refused';
      // assemble cannot shrink the ledger, so a block would ask for the impossible: fail open instead (finding 8).
      if (id === 'ledger_too_large') throw namedError(id);
      return blockFor(s.phase, id, PATH_PROBLEMS.includes(id));
    }
    throw namedError('cli_failed');
  },
};
