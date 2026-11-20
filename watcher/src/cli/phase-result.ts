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
 * binds its bytes to this run in the owner-only ledger (`results/<feature>/<phase>`), then clears the `pending` marker
 * and both `unverified` markers (ledger and repo `results/<phase>.unverified.json`), so a rebuilt phase can pass again.
 * A failed assemble writes nothing. check passes only for that exact file, from this run (`run/<phase>`), still matching
 * the evidence, with no unverified marker; for ship, made at the current HEAD. `check ship --all` instead applies the
 * archive rule (phase-results/archivable.ts) to every active feature. Exit 0 on pass, 1 on refusal (stderr
 * names the reason id, the field and the rebuild command), 2 on wrong usage.
 *
 * Repo: the physical cwd's git toplevel, or --repo; never CLAUDE_PROJECT_DIR. Schemas: the plugin root this bundle sits
 * in (<root>/watcher/dist/cli/phase-result.cjs), never the repo. No network; the only child process is git.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assembleBuild } from '../phase-results/assemble-build.js';
import { sha256, type AssembleContext, type AssembleOutcome } from '../phase-results/assemble-common.js';
import { assembleIdeate } from '../phase-results/assemble-ideate.js';
import { assemblePlan } from '../phase-results/assemble-plan.js';
import {
  assembleShip,
  isLocalBranch,
  shipBaseCheck,
} from '../phase-results/assemble-ship.js';
import { LedgerError, ledgerKey, openLedger, parseRunRow, type Ledger } from '../phase-results/ledger.js';
import { loadPhaseSchema, PHASES, type Phase } from '../phase-results/schemas.js';
import { shipArchivable } from '../phase-results/archivable.js';
import { activeFeatures, resolveFeature } from '../phase-results/feature.js';
import { gitBin } from '../phase-results/git-bin.js';
import { gitEnv, gitOut } from '../phase-results/git.js';
import { clearUnverifiedMarker, readBack, readResult, readValueFile, resolveRepo, writeResult } from '../phase-results/store.js';
import { validate } from '../phase-results/validate.js';

const USAGE =
  'usage: oss-phase-result.sh assemble <ideate|plan|build|ship>\n' +
  '       oss-phase-result.sh check <ideate|plan|build|ship> [--repo <path>] [--all]\n';

type Verdict = { ok: true } | { ok: false; id: string; field: string; detail?: string };

/** `field` names the field or input at fault; `detail`, when set, is a fixed hint printed as its own clause (pen info 1). */
class Refusal extends Error {
  readonly id: string;
  readonly field: string;
  readonly detail: string | undefined;
  constructor(id: string, field: string, detail?: string) {
    super(id);
    this.id = id;
    this.field = field;
    this.detail = detail;
  }
}

/** Assembler errors whose `detail` is a fixed hint, not a field name (pen info 1). */
const HINT_ERRORS: ReadonlySet<string> = new Set(['diff_unavailable']);

/** Pen low 4 (gate round 7): the unsafe_base hint when only the snapshot containment failed. Fixed text, no values. */
const NOT_IN_SNAPSHOT = 'the base tip is not in the ship-start remote snapshot: update or push the base, then run ship start again';

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

/** The commit HEAD points at; assemble records it and check for ship compares against it. */
function headSha(repo: string): string | null {
  return gitOut(repo, ['rev-parse', '--verify', 'HEAD^{commit}']);
}

/**
 * The local branch ship diffs against (D19): the model's `base.txt` (the PR's base) when it is one line naming an
 * existing local branch; else repo-local `oss.shipBase`, else `main` (local ref only, never gh or fetch). A bad
 * base.txt falls back; assembleShip's ref checks validate the config value, and a failed read gives '' so it is
 * refused, never silently `main`. Finding 7 / D50 (code review L2, D51): whichever is chosen must then pass
 * checkShipBase (a same-name ref on any remote at ship start that contains its tip), so a local-only branch is still
 * refused (`unsafe_base`) and a repo whose remote is not called origin can name its integration branch.
 */
function shipBase(repo: string, dir: string | null): string {
  const named = dir === null ? null : readValueFile(dir, 'base.txt')?.replace(/\n$/, '');
  if (named != null && !named.includes('\n') && isLocalBranch(repo, named)) return named;
  return shipBaseConfig(repo);
}

/** Repo-local `oss.shipBase`, `main` when unset, '' when git fails (so assembleShip refuses it). */
function shipBaseConfig(repo: string): string {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.PATH = '/usr/bin:/bin';
  // pen N3: the fixed-path git, never PATH; with none, '' (refused by assembleShip, never a silent main).
  const git = gitBin();
  if (git === '') return '';
  const r = spawnSync(git, ['config', '--local', '--get', 'oss.shipBase'], {
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

/** D40: at most this many remote refs in a ship start snapshot; a bigger one is refused (fail closed). */
const MAX_ORIGIN_REFS = 1000;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const REMOTE_REF = 'refs/remotes/';

/**
 * D40/D46/D50 (security M1, pen F4, pen M2a): the refs/remotes/<remote>/* names and SHAs that oss-notify's ship start
 * recorded in the ledger (`run/ship.origin`, `{startedAt, refs: {<ref name>: <sha>}}`), for this run only (its
 * startedAt). Refuses `no_base_snapshot` when there is none for this run (a run started before D40, or git failed or
 * found over MAX_ORIGIN_REFS refs at start), or it is malformed, over the cap, or in the D40 `{startedAt, shas}` format.
 */
function originSnapshot(ledger: Ledger, startedAt: string): Map<string, string> {
  const m = ledger.readMarker('run/ship.origin');
  const refs = m?.refs;
  if (m?.startedAt !== startedAt || typeof refs !== 'object' || refs === null || Array.isArray(refs)) {
    throw new Refusal('no_base_snapshot', 'run/ship.origin');
  }
  const entries = Object.entries(refs);
  if (entries.length > MAX_ORIGIN_REFS
    || !entries.every(([name, sha]) => name.startsWith(REMOTE_REF) && typeof sha === 'string' && SHA.test(sha))) {
    throw new Refusal('no_base_snapshot', 'run/ship.origin');
  }
  return new Map(entries as Array<[string, string]>);
}

/**
 * D46 (replaces D40's "any origin SHA" rule): a ship base is accepted only when the snapshot holds <a remote>/<its
 * own name> (D50: any remote) and its tip is inside that SHA, and it is neither the current branch nor one of the feature's phase branches
 * (shipBaseAllowed). Local refs and reflogs, which the model can write, never count. Refuses `unsafe_base`. A name that
 * is not a local branch is left to assembleShip's ref checks (diff_unavailable).
 */
function checkShipBase(repo: string, base: string, feature: string, snapshot: ReadonlyMap<string, string>): void {
  if (!isLocalBranch(repo, base)) return;
  const verdict = shipBaseCheck(repo, base, feature, snapshot);
  if (verdict !== 'ok') throw new Refusal('unsafe_base', 'base', verdict === 'not_in_snapshot' ? NOT_IN_SNAPSHOT : undefined);
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

function runAssembler(phase: Phase, ctx: AssembleContext, base?: string, remoteRefs?: ReadonlyMap<string, string>): AssembleOutcome {
  switch (phase) {
    case 'ideate':
      return assembleIdeate(ctx);
    case 'plan':
      return assemblePlan(ctx);
    case 'build':
      return assembleBuild(ctx);
    case 'ship': {
      if (base !== undefined) return assembleShip(ctx, { base, remoteRefs });
      const chosen = shipBase(ctx.repo, ctx.valueDir);
      const snapshot = originSnapshot(openLedger(ctx.repo), ctx.startedAt);
      checkShipBase(ctx.repo, chosen, ctx.feature, snapshot);
      // Pen L2: the snapshot also moves the diff base past a stale local base.
      return assembleShip(ctx, { base: chosen, remoteRefs: snapshot });
    }
  }
}

function checkSchema(phase: Phase, value: unknown): void {
  const v = validate(loadPhaseSchema(phase, pluginRoot()), value);
  if (!v.ok) throw new Refusal(`invalid_result (${v.rule})`, v.path);
}

const PREVIOUS: Readonly<Partial<Record<Phase, Phase>>> = { plan: 'ideate', build: 'plan', ship: 'build' };

/**
 * Pen N1: oss-notify's start gate (D16/D17) is skipped for a run started where no feature resolved, so assemble re-applies
 * it when the run row's feature is "": the resolved feature needs a valid previous-phase result (check), unless it is
 * legacy (D17: no results/ entry in the repo and no ledger results/<feature> entry). Refuses `no_prev_result`.
 */
function startGate(repo: string, feature: string, phase: Phase, ledger: Ledger): void {
  const prev = PREVIOUS[phase];
  if (prev === undefined || parseRunRow(ledger.lastRow(`run/${phase}`))?.feature !== '') return;
  const exists = (p: string): boolean => fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;
  const legacy = !exists(path.join(repo, '.oss', 'dev', 'active', feature, 'results'))
    && !exists(path.join(ledger.dir, 'results', feature));
  if (legacy) return;
  try {
    check(repo, feature, prev);
  } catch {
    throw new Refusal('no_prev_result', prev);
  }
}

function assemble(repo: string, feature: string, phase: Phase): Record<string, unknown> {
  const ledger = openLedger(repo);
  const startedAt = runStartedAt(ledger, phase);
  startGate(repo, feature, phase, ledger);
  const ctx: AssembleContext = {
    repo,
    feature,
    startedAt,
    headSha: headSha(repo) ?? '',
    valueDir: valueDir(repo),
    now: () => new Date(),
  };
  const outcome = runAssembler(phase, ctx);
  if (!outcome.ok) {
    if (outcome.detail !== undefined && HINT_ERRORS.has(outcome.error)) throw new Refusal(outcome.error, '', outcome.detail);
    throw new Refusal(outcome.error, outcome.detail ?? phase);
  }
  checkSchema(phase, outcome.result);
  // Round 2 race: bind the bytes written, and only when the file read back is that very file holding those bytes.
  const written = writeResult(repo, feature, phase, outcome.result);
  const read = readBack(repo, feature, phase, written);
  if (!read.ok) throw new Refusal(read.error, `results/${phase}.json`);
  ledger.appendRow(`results/${feature}/${phase}`, {
    sha256: sha256(written.bytes),
    feature,
    phase,
    startedAt,
    headSha: outcome.result.headSha,
    session: process.env.CLAUDE_CODE_SESSION_ID ?? '',
  });
  ledger.clearMarker(`pending/${feature}/${phase}`);
  ledger.clearMarker(`unverified/${feature}/${phase}`);
  clearUnverifiedMarker(repo, feature, phase);
  return outcome.result;
}

/**
 * Re-runs the assembler in memory. For ship, the overrides it asked for are fed back from the stored result (the
 * model's value file ages out), so the assembler re-checks each against the ledger and re-copies its person.
 */
function reassemble(repo: string, feature: string, phase: Phase, stored: Record<string, unknown>): AssembleOutcome {
  let tmp: string | null = null;
  let dir = valueDir(repo);
  let base: string | undefined;
  let remoteRefs: ReadonlyMap<string, string> | undefined;
  if (phase === 'ship') {
    // Pen L2: the same ship-start snapshot assemble used (check runs for this run only, so its startedAt matches); none
    // left means the local base, as before.
    try {
      remoteRefs = originSnapshot(openLedger(repo), String(stored.startedAt));
    } catch {
      remoteRefs = undefined;
    }
    // Re-derive from the recorded base (never base.txt, which ages out); assembleShip's ref checks refuse a gone or
    // malformed one, which check reports as evidence_mismatch.
    const recorded = (stored.diff as Record<string, unknown> | undefined)?.baseRef;
    base = typeof recorded === 'string' ? recorded : '';
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-phase-result-'));
    const requested = Array.isArray(stored.overrides) ? (stored.overrides as Array<Record<string, unknown>>) : [];
    // D69: the gate an override names goes back too, so check clears the same D67 rows assemble did.
    const overrides = requested.map((o) => ({ finding: o.finding, decisionId: o.decisionId, ...(o.gate === undefined ? {} : { gate: o.gate }) }));
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
      evidenceCutoff: typeof stored.evidenceCutoff === 'string' ? stored.evidenceCutoff : null,
      // D51: ship reads every fail row, so a stored verdictsFrom (D47, results from rounds 6-7) is ignored.
      now: () => new Date(),
    }, base, remoteRefs);
  } finally {
    if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The code-owned evidence fields check re-derives, per phase (round 2 security): a fixed list, never the stored
 * `sources`, so a result whose `sources` was emptied or relabelled is still compared.
 */
const CODE_FIELDS: Readonly<Record<Phase, readonly string[]>> = {
  ideate: ['decisions', 'decisionsRecorded', 'designCommitted'],
  plan: [],
  build: ['testRuns', 'evidenceTrust'],
  ship: ['diff', 'gateEvidence', 'uncapturedGates', 'overrides', 'blockers', 'verdict'],
};

function check(repo: string, feature: string, phase: Phase): Record<string, unknown> {
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
  if (phase === 'ship' && stored.headSha !== headSha(repo)) {
    throw new Refusal('stale_result', 'headSha');
  }
  if (stored.verification !== 'verified') throw new Refusal('unverified', 'verification');

  const fresh = reassemble(repo, feature, phase, stored);
  if (!fresh.ok) throw new Refusal('evidence_mismatch', fresh.error);
  for (const field of CODE_FIELDS[phase]) {
    if (JSON.stringify(stored[field]) !== JSON.stringify(fresh.result[field])) {
      throw new Refusal('evidence_mismatch', field);
    }
  }
  return stored;
}

function verdictOf(fn: () => void): Verdict {
  try {
    fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, id: e.id, field: e.field, detail: e.detail };
    if (e instanceof LedgerError) return { ok: false, id: e.code, field: 'ledger' };
    const msg = e instanceof Error ? e.message : String(e);
    const id = /^([a-z_]+):/.exec(msg)?.[1] ?? 'internal_error';
    return { ok: false, id, field: 'store' };
  }
}

/**
 * `<id>[: <detail>][ (field <field>)]`: pen info 1 — a hint is its own clause, and "field" names only a real field.
 * Nothing parses this line (hooks read the exit code and stdout).
 */
function refuse(args: Args, id: string, field: string, detail?: string): number {
  const reason = `${id}${detail === undefined ? '' : `: ${detail}`}${field === '' ? '' : ` (field ${field})`}`;
  process.stderr.write(`phase-result: ${args.verb} ${args.phase}: ${reason}; rebuild: oss-phase-result.sh assemble ${args.phase}\n`);
  return 1;
}

/** D26: ship prints its gate evidence label, so the complete notice can name the gates no captured agent row backs. */
function gateLabel(phase: Phase, result: Record<string, unknown>): Record<string, unknown> {
  return phase === 'ship' ? { gateEvidence: result.gateEvidence, uncapturedGates: result.uncapturedGates } : {};
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
        if (args.phase !== 'ship') {
          check(repo, feature, args.phase);
          return;
        }
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
    if (!v.ok) return refuse(args, v.id, v.field, v.detail);
    process.stdout.write(`${JSON.stringify({ verification: result.verification, phase: args.phase, ...gateLabel(args.phase, result) })}\n`);
    return 0;
  }
  let stored: Record<string, unknown> = {};
  const v = verdictOf(() => {
    stored = check(repo, feature, args.phase);
  });
  if (!v.ok) return refuse(args, v.id, v.field, v.detail);
  // D35: check ship also prints the verdict, so complete refuses a verified but blocked ship.
  const verdict = args.phase === 'ship' ? { verdict: stored.verdict } : {};
  process.stdout.write(`${JSON.stringify({ verification: 'verified', ...gateLabel(args.phase, stored), ...verdict })}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
