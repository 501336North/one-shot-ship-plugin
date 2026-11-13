#!/usr/bin/env node
/**
 * phase-result CLI (R-257 T9, amended by D14): run by hooks/oss-phase-result.sh as the bundle
 * dist/cli/phase-result.cjs.
 *
 * Usage:
 *   phase-result assemble <ideate|plan|build|ship>
 *   phase-result check <phase> [--repo <path>] [--all]
 *
 * assemble builds the result from evidence (the phase assembler), validates it against the phase schema, writes it and
 * binds its bytes to this run in the owner-only ledger (`results/<feature>/<phase>`), then clears the `pending` marker.
 * A failed assemble writes nothing. check passes only for that exact file, from this run (`run/<phase>`), still matching
 * the evidence, with no unverified marker; for ship, made at the current HEAD. `check ship --all` instead applies the
 * archive rule (phase-results/archivable.ts) to every active feature. Exit 0 on pass, 1 on refusal (stderr
 * names the reason id, the field and the rebuild command), 2 on wrong usage.
 *
 * Repo: the physical cwd's git toplevel, or --repo; never CLAUDE_PROJECT_DIR. Schemas: the plugin root this bundle sits
 * in (<root>/watcher/dist/cli/phase-result.cjs), never the repo. No network; the only child process is git.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assembleBuild } from '../phase-results/assemble-build.js';
import type { AssembleContext, AssembleOutcome } from '../phase-results/assemble-common.js';
import { assembleIdeate } from '../phase-results/assemble-ideate.js';
import { assemblePlan } from '../phase-results/assemble-plan.js';
import { assembleShip } from '../phase-results/assemble-ship.js';
import { LedgerError, ledgerKey, openLedger, type Ledger } from '../phase-results/ledger.js';
import { loadPhaseSchema, PHASES, type Phase } from '../phase-results/schemas.js';
import { shipArchivable } from '../phase-results/archivable.js';
import { activeFeatures, resolveFeature } from '../phase-results/feature.js';
import { readResult, resolveRepo, writeResult } from '../phase-results/store.js';
import { validate } from '../phase-results/validate.js';

const USAGE =
  'usage: oss-phase-result.sh assemble <ideate|plan|build|ship>\n' +
  '       oss-phase-result.sh check <ideate|plan|build|ship> [--repo <path>] [--all]\n';

type Verdict = { ok: true } | { ok: false; id: string; field: string };

class Refusal extends Error {
  readonly id: string;
  readonly field: string;
  constructor(id: string, field: string) {
    super(id);
    this.id = id;
    this.field = field;
  }
}

interface Args {
  verb: 'assemble' | 'check';
  phase: Phase;
  repo: string | null;
  all: boolean;
}

function parseArgs(argv: string[]): Args | null {
  const [verb, phase, ...rest] = argv;
  if ((verb !== 'assemble' && verb !== 'check') || !(PHASES as readonly string[]).includes(phase ?? '')) return null;
  const args: Args = { verb, phase: phase as Phase, repo: null, all: false };
  for (let i = 0; i < rest.length; i++) {
    if (verb === 'check' && rest[i] === '--all') args.all = true;
    else if (verb === 'check' && rest[i] === '--repo' && rest[i + 1] !== undefined) args.repo = rest[++i];
    else return null;
  }
  return args;
}

function gitOut(cwd: string, args: string[]): string | null {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  try {
    const out = execFileSync('git', args, { cwd, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/**
 * The local branch ship diffs against: repo-local `oss.shipBase`, else `main` (local ref only, never gh or fetch).
 * assembleShip's ref checks validate the value; a failed read gives '' so it is refused, never silently `main`.
 */
function shipBase(repo: string): string {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  env.GIT_CONFIG_NOSYSTEM = '1';
  const r = spawnSync('git', ['config', '--local', '--get', 'oss.shipBase'], {
    cwd: repo,
    env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  if (r.error === undefined && r.status === 1) return 'main';
  if (r.error === undefined && r.status === 0) return r.stdout.replace(/\n$/, '');
  return '';
}

/** The plugin root this bundle sits in: <root>/watcher/dist/cli/phase-result.cjs. */
function pluginRoot(): string {
  return path.resolve(path.dirname(fs.realpathSync(process.argv[1] ?? '')), '..', '..', '..');
}

function isDirOf(p: string, uid: number | undefined): boolean {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  return st !== undefined && !st.isSymbolicLink() && st.isDirectory() && st.uid === uid;
}

/** $HOME/.oss/run/<key> when it exists, is owned and is not a link (lookup only, never created); else null. */
function valueDir(repo: string): string | null {
  const key = ledgerKey(repo);
  if (key === null) return null;
  const uid = process.getuid?.();
  const run = path.join(os.homedir(), '.oss', 'run');
  const dir = path.join(run, key);
  return isDirOf(run, uid) && isDirOf(dir, uid) ? fs.realpathSync(dir) : null;
}

function runStartedAt(ledger: Ledger, phase: Phase): string {
  const startedAt = ledger.lastRow(`run/${phase}`)?.startedAt;
  if (typeof startedAt !== 'string') throw new Refusal('no_run_started', `run/${phase}`);
  return startedAt;
}

function runAssembler(phase: Phase, ctx: AssembleContext): AssembleOutcome {
  switch (phase) {
    case 'ideate':
      return assembleIdeate(ctx);
    case 'plan':
      return assemblePlan(ctx);
    case 'build':
      return assembleBuild(ctx);
    case 'ship':
      return assembleShip(ctx, { base: shipBase(ctx.repo) });
  }
}

function checkSchema(phase: Phase, value: unknown): void {
  const v = validate(loadPhaseSchema(phase, pluginRoot()), value);
  if (!v.ok) throw new Refusal(`invalid_result (${v.rule})`, v.path);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assemble(repo: string, feature: string, phase: Phase): Record<string, unknown> {
  const ledger = openLedger(repo);
  const startedAt = runStartedAt(ledger, phase);
  const ctx: AssembleContext = {
    repo,
    feature,
    startedAt,
    headSha: gitOut(repo, ['rev-parse', '--verify', 'HEAD^{commit}']) ?? '',
    valueDir: valueDir(repo),
    now: () => new Date(),
  };
  const outcome = runAssembler(phase, ctx);
  if (!outcome.ok) throw new Refusal(outcome.error, outcome.detail ?? phase);
  checkSchema(phase, outcome.result);
  writeResult(repo, feature, phase, outcome.result);
  const read = readResult(repo, feature, phase);
  if (!read.ok) throw new Refusal(read.error, `results/${phase}.json`);
  ledger.appendRow(`results/${feature}/${phase}`, {
    sha256: sha256(read.bytes),
    feature,
    phase,
    startedAt,
    headSha: outcome.result.headSha,
    session: process.env.CLAUDE_CODE_SESSION_ID ?? '',
  });
  ledger.clearMarker(`pending/${feature}/${phase}`);
  return outcome.result;
}

/**
 * Re-runs the assembler in memory. For ship, the overrides it asked for are fed back from the stored result (the
 * model's value file ages out), so the assembler re-checks each against the ledger and re-copies its person.
 */
function reassemble(repo: string, feature: string, phase: Phase, stored: Record<string, unknown>): AssembleOutcome {
  let tmp: string | null = null;
  let dir = valueDir(repo);
  if (phase === 'ship') {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-phase-result-'));
    const requested = Array.isArray(stored.overrides) ? (stored.overrides as Array<Record<string, unknown>>) : [];
    const overrides = requested.map((o) => ({ finding: o.finding, decisionId: o.decisionId }));
    fs.writeFileSync(path.join(tmp, 'overrides.json'), JSON.stringify(overrides), { mode: 0o600 });
    dir = tmp;
  }
  try {
    return runAssembler(phase, {
      repo,
      feature,
      startedAt: String(stored.startedAt),
      headSha: String(stored.headSha),
      valueDir: dir,
      now: () => new Date(),
    });
  } finally {
    if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function check(repo: string, feature: string, phase: Phase): void {
  const ledger = openLedger(repo);
  const marker = path.join(repo, '.oss', 'dev', 'active', feature, 'results', `${phase}.unverified.json`);
  if (fs.lstatSync(marker, { throwIfNoEntry: false }) !== undefined) throw new Refusal('unverified', 'marker');
  for (const kind of ['pending', 'unverified']) {
    if (ledger.hasMarker(`${kind}/${feature}/${phase}`)) throw new Refusal('unverified', `${kind} marker`);
  }

  const read = readResult(repo, feature, phase);
  if (!read.ok) throw new Refusal(read.error, `results/${phase}.json`);
  const value = read.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Refusal('invalid_result', '$');
  const stored = value as Record<string, unknown>;
  if (stored.feature !== feature) throw new Refusal('stale_result', 'feature');
  if (stored.phase !== phase) throw new Refusal('stale_result', 'phase');
  if (ledger.lastRow(`results/${feature}/${phase}`)?.sha256 !== sha256(read.bytes)) {
    throw new Refusal('unbound_result', 'sha256');
  }
  checkSchema(phase, stored);
  if (stored.startedAt !== runStartedAt(ledger, phase)) throw new Refusal('stale_result', 'startedAt');
  if (phase === 'ship' && stored.headSha !== gitOut(repo, ['rev-parse', '--verify', 'HEAD^{commit}'])) {
    throw new Refusal('stale_result', 'headSha');
  }
  if (stored.verification !== 'verified') throw new Refusal('unverified', 'verification');

  const fresh = reassemble(repo, feature, phase, stored);
  if (!fresh.ok) throw new Refusal('evidence_mismatch', fresh.error);
  const sources = (stored.sources ?? {}) as Record<string, unknown>;
  for (const [field, source] of Object.entries(sources)) {
    if (source !== 'code') continue;
    if (JSON.stringify(stored[field]) !== JSON.stringify(fresh.result[field])) {
      throw new Refusal('evidence_mismatch', field);
    }
  }
}

function verdictOf(fn: () => void): Verdict {
  try {
    fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, id: e.id, field: e.field };
    if (e instanceof LedgerError) return { ok: false, id: e.code, field: 'ledger' };
    const msg = e instanceof Error ? e.message : String(e);
    const id = /^([a-z_]+):/.exec(msg)?.[1] ?? 'internal_error';
    return { ok: false, id, field: 'store' };
  }
}

function refuse(args: Args, id: string, field: string): number {
  process.stderr.write(
    `phase-result: ${args.verb} ${args.phase}: ${id} (field ${field}); rebuild: oss-phase-result.sh assemble ${args.phase}\n`,
  );
  return 1;
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if (args === null) {
    process.stderr.write(USAGE);
    return 2;
  }
  const repo = resolveRepo(args.repo ?? process.cwd());
  if (repo === null) return refuse(args, 'no_repo', 'repo');

  if (args.all) {
    for (const feature of activeFeatures(repo)) {
      const v = verdictOf(() => {
        if (args.phase !== 'ship') return check(repo, feature, args.phase);
        const a = shipArchivable(repo, feature, pluginRoot());
        if (!a.ok) throw new Refusal(a.reason, 'archive');
      });
      process.stdout.write(`${feature} ${v.ok ? 'ok' : v.id}\n`);
    }
    return 0;
  }

  const feature = resolveFeature(repo);
  if (feature === null) return refuse(args, 'no_feature', 'feature');
  if (args.verb === 'assemble') {
    let result: Record<string, unknown> = {};
    const v = verdictOf(() => {
      result = assemble(repo, feature, args.phase);
    });
    if (!v.ok) return refuse(args, v.id, v.field);
    process.stdout.write(`${JSON.stringify({ verification: result.verification, phase: args.phase })}\n`);
    return 0;
  }
  const v = verdictOf(() => check(repo, feature, args.phase));
  if (!v.ok) return refuse(args, v.id, v.field);
  process.stdout.write(`${JSON.stringify({ verification: 'verified' })}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
