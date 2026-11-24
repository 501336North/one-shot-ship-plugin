/**
 * @behavior When an ideate phase ends, the plugin builds the ideate result from the picker answers the decision hook
 *           recorded (`decisions.ndjson`), the committed DESIGN.md and the model's open questions, so "the user made
 *           these decisions and the design is committed" is recorded by code, not claimed by the model.
 * @business-rule R-257 AC-003.1 (amended by D18): a record counts only when the sha256 of its exact line matches a
 *                private ledger row with the same feature and id, and its own feature is this feature; anything else
 *                is excluded and never counted. Zero decisions is valid. DESIGN.md needs a whole line
 *                `Status: COMMITTED`, else `design_not_committed`. Open questions are model text, redacted.
 *                A symlinked record file is `unsafe_path`.
 * @boundary watcher/src/phase-results/assemble-ideate.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { assembleIdeate } from '../../src/phase-results/assemble-ideate.js';
import type { AssembleContext, AssembleOutcome } from '../../src/phase-results/assemble-common.js';
import { openLedger } from '../../src/phase-results/ledger.js';
import { loadPhaseSchema } from '../../src/phase-results/schemas.js';
import { validate } from '../../src/phase-results/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '../../..');
const FEATURE = 'phase-results';
const FAKE_KEY = 'sk-ant-api03-' + 'Ab1'.repeat(30);

let repo: string;
let home: string;
let valueDir: string;
let savedHome: string | undefined;

beforeEach(() => {
  savedHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-ideate-home-'));
  process.env.HOME = home;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-ideate-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  valueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-ideate-values-'));
  fs.mkdirSync(featureDir(), { recursive: true });
  writeDesign('# Design\n\nStatus: COMMITTED\n');
});
afterEach(() => {
  process.env.HOME = savedHome;
  for (const d of [repo, home, valueDir]) fs.rmSync(d, { recursive: true, force: true });
});

function featureDir(): string {
  return path.join(repo, '.oss', 'dev', 'active', FEATURE);
}

function ctx(): AssembleContext {
  return {
    repo,
    feature: FEATURE,
    startedAt: '2026-11-13T09:00:00.000Z',
    headSha: 'a'.repeat(40),
    valueDir,
    now: () => new Date('2026-11-13T10:00:00.000Z'),
  };
}

function writeDesign(text: string): void {
  fs.writeFileSync(path.join(featureDir(), 'DESIGN.md'), text);
}

interface Rec {
  id: string;
  feature: string;
  question: string;
  answer: string;
  kind: string;
  answeredAt: string;
}

// ⚠ changes existing test fixture: D47 (pen I2): a record with no answeredAt never counts, so every fixture record
//   carries the whole-second stamp the decision hook always writes (oss-decision-record.sh).
function rec(id: string, feature = FEATURE): Rec {
  return { id, feature, question: `Question ${id}?`, answer: `Answer ${id}`, kind: 'design', answeredAt: '2026-11-13T09:30:00Z' };
}

function line(r: Rec): string {
  return JSON.stringify({ v: 1, ...r, command: 'ideate' });
}

/** What the hook does on this machine: the record line goes to the repo file, its hash row to the ledger. */
function recordViaHook(l: string, ledgerFeature: string, id: string): void {
  const sha256 = createHash('sha256').update(l).digest('hex');
  openLedger(repo).appendRow(`decisions/${FEATURE}`, { id, feature: ledgerFeature, sha256 });
}

function writeRecords(lines: string[]): void {
  fs.writeFileSync(path.join(featureDir(), 'decisions.ndjson'), lines.map((l) => `${l}\n`).join(''));
}

function result(o: AssembleOutcome): Record<string, unknown> {
  if (!o.ok) throw new Error(`expected ok, got ${o.error}`);
  return o.result;
}

describe('assembleIdeate', () => {
  // User sees the picks they answered recorded as code-sourced decisions, in a result the ideate schema accepts.
  // Rule: a record counts when its line hash, feature and id match a ledger row (AC-003.1).
  it('turns recorded, ledger-backed picks into code-sourced decisions', () => {
    const a = line(rec('d-1'));
    const b = line(rec('d-2'));
    recordViaHook(a, FEATURE, 'd-1');
    recordViaHook(b, FEATURE, 'd-2');
    writeRecords([a, b]);
    const r = result(assembleIdeate(ctx()));
    expect(r.decisions).toEqual([
      { id: 'd-1', question: 'Question d-1?', answer: 'Answer d-1', kind: 'design' },
      { id: 'd-2', question: 'Question d-2?', answer: 'Answer d-2', kind: 'design' },
    ]);
    expect(r.decisionsRecorded).toBe(2);
    expect(r.designCommitted).toBe(true);
    expect(r.sources).toEqual({
      decisions: 'code',
      decisionsRecorded: 'code',
      designCommitted: 'code',
      openQuestions: 'model',
    });
    expect(validate(loadPhaseSchema('ideate', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });

  // Rule: a pick made for another feature never counts toward this feature's ideate.
  it('excludes a record from another feature', () => {
    const mine = line(rec('d-1'));
    const other = line(rec('d-2', 'other-feature'));
    recordViaHook(mine, FEATURE, 'd-1');
    recordViaHook(other, 'other-feature', 'd-2');
    writeRecords([mine, other]);
    const r = result(assembleIdeate(ctx()));
    expect(r.decisionsRecorded).toBe(1);
    expect((r.decisions as Rec[]).map((d) => d.id)).toEqual(['d-1']);
  });

  // Rule: a record written into the repo file by hand (no ledger row) is excluded, never counted.
  it('excludes a planted record that is not in the ledger', () => {
    const real = line(rec('d-1'));
    recordViaHook(real, FEATURE, 'd-1');
    writeRecords([real, line(rec('d-planted'))]);
    const r = result(assembleIdeate(ctx()));
    expect((r.decisions as Rec[]).map((d) => d.id)).toEqual(['d-1']);
    expect(r.decisionsRecorded).toBe(1);
  });

  // Rule (D18): only planted records give zero decisions and still pass; they are never a failure.
  it('gives decisionsRecorded 0 and ok when every record is planted', () => {
    writeRecords([line(rec('d-x')), line(rec('d-y'))]);
    const r = result(assembleIdeate(ctx()));
    expect(r.decisions).toEqual([]);
    expect(r.decisionsRecorded).toBe(0);
  });

  // User running ideate headless (no picker) still gets a valid result (D18: zero picks allowed).
  it('gives an empty decision list when there is no decisions.ndjson', () => {
    const r = result(assembleIdeate(ctx()));
    expect(r.decisions).toEqual([]);
    expect(r.decisionsRecorded).toBe(0);
    expect(validate(loadPhaseSchema('ideate', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });

  // Rule: editing a record's feature after the hook wrote it breaks the hash match; that record drops out.
  it('excludes a record whose feature was edited after the ledger row was written', () => {
    const a = line(rec('d-1'));
    const b = line(rec('d-2', 'other-feature'));
    recordViaHook(a, FEATURE, 'd-1');
    recordViaHook(b, 'other-feature', 'd-2');
    const edited = b.replace('"feature":"other-feature"', `"feature":"${FEATURE}"`);
    writeRecords([a, edited]);
    const r = result(assembleIdeate(ctx()));
    expect(r.decisionsRecorded).toBe(1);
  });

  // Rule: ideate fails until DESIGN.md is committed.
  it('fails with design_not_committed when DESIGN.md is a draft', () => {
    writeDesign('# Design\n\nStatus: DRAFT\n');
    expect(assembleIdeate(ctx())).toMatchObject({ ok: false, error: 'design_not_committed' });
  });

  // Rule: the commit marker is a whole line, not a phrase found in prose.
  it('fails with design_not_committed when "Status: COMMITTED" only appears inside a sentence', () => {
    writeDesign('# Design\n\nWe will set Status: COMMITTED once the user approves.\n');
    expect(assembleIdeate(ctx())).toMatchObject({ ok: false, error: 'design_not_committed' });
  });

  // User sees the model's open questions recorded as model text, with secrets scrubbed.
  it('takes openQuestions from the value file as model text and redacts a planted key', () => {
    fs.writeFileSync(path.join(valueDir, 'open-questions.json'), JSON.stringify(['Which cap?', `key ${FAKE_KEY}`]));
    const r = result(assembleIdeate(ctx()));
    const qs = r.openQuestions as string[];
    expect(qs[0]).toBe('Which cap?');
    expect(qs[1]).not.toContain(FAKE_KEY);
    expect((r.sources as Record<string, string>).openQuestions).toBe('model');
  });

  // Rule: a symlinked record file is refused, so a link cannot point the assembler at another file.
  it('fails with unsafe_path when decisions.ndjson is a symlink', () => {
    const target = path.join(repo, 'elsewhere.ndjson');
    fs.writeFileSync(target, `${line(rec('d-1'))}\n`);
    fs.symlinkSync(target, path.join(featureDir(), 'decisions.ndjson'));
    expect(assembleIdeate(ctx())).toMatchObject({ ok: false, error: 'unsafe_path' });
  });
});

describe('the evidence cutoff (D42)', () => {
  /** A hook-recorded pick answered at <answeredAt> (the hook stamps answeredAt in whole seconds). */
  function pickAt(id: string, answeredAt: string): string {
    const l = JSON.stringify({ v: 1, ...rec(id), command: 'ideate', answeredAt });
    recordViaHook(l, FEATURE, id);
    return l;
  }

  // User who finished ideate and then answered a plan picker still has a valid ideate result.
  // Rule: D42, an ideate result stores its evidence cutoff (the assemble time) and counts decisions only up to it.
  it('stores the assemble time as its evidence cutoff', () => {
    writeRecords([pickAt('d-1', '2026-11-13T09:30:00Z')]);
    const r = result(assembleIdeate(ctx()));
    // ⚠ changes existing test: D47 (ideate same-second pick): the cutoff is stored floored to the whole second, with
    //   no fraction, so a stored cutoff with a fraction marks a result assembled under the old rule.
    expect(r.evidenceCutoff).toBe('2026-11-13T10:00:00Z');
    expect(validate(loadPhaseSchema('ideate', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });

  // Rule: D42, a re-check given the stored cutoff ignores picks answered after it, so it re-derives the same decisions.
  it('counts only the decisions answered up to the given cutoff', () => {
    writeRecords([pickAt('d-1', '2026-11-13T09:30:00Z'), pickAt('d-2', '2026-11-13T10:30:00Z')]);
    const r = result(assembleIdeate({ ...ctx(), evidenceCutoff: '2026-11-13T10:00:00.000Z' }));
    expect(r.decisionsRecorded).toBe(1);
    expect(r.decisions).toEqual([expect.objectContaining({ id: 'd-1' })]);
  });

  // Rule: D42, answeredAt is stamped in whole seconds, so a pick stamped with the cutoff's own second may have come
  //       after it: it is not counted, so a pick made just after assemble never shows up on re-check.
  //       D47: this old rule still applies to a stored cutoff with a fraction (a result assembled before round 6).
  it("leaves out a pick stamped with the cutoff's own second", () => {
    writeRecords([pickAt('d-1', '2026-11-13T09:59:59Z'), pickAt('d-2', '2026-11-13T10:00:00Z')]);
    const r = result(assembleIdeate({ ...ctx(), evidenceCutoff: '2026-11-13T10:00:00.500Z' }));
    expect(r.decisions).toEqual([expect.objectContaining({ id: 'd-1' })]);
  });

  // User who answered a pick in the very second ideate finished still has that pick on the ideate result.
  // Rule: D47, the cutoff is the assemble time floored to the whole second, and a pick stamped at or before it counts,
  //       both at assemble and on re-check with the stored cutoff, so the two agree.
  it("counts a pick stamped with the assemble's own second, at assemble and on re-check", () => {
    writeRecords([pickAt('d-1', '2026-11-13T09:59:59Z'), pickAt('d-2', '2026-11-13T10:00:00Z')]);
    const late = { ...ctx(), now: () => new Date('2026-11-13T10:00:00.750Z') };
    const assembled = result(assembleIdeate(late));
    expect(assembled.evidenceCutoff).toBe('2026-11-13T10:00:00Z');
    expect(assembled.decisions).toEqual([expect.objectContaining({ id: 'd-1' }), expect.objectContaining({ id: 'd-2' })]);
    const rechecked = result(assembleIdeate({ ...late, evidenceCutoff: String(assembled.evidenceCutoff) }));
    expect(rechecked.decisions).toEqual(assembled.decisions);
  });

  // Rule: D47 (pen I2), a pick whose answeredAt is missing or cannot be read as a time is never counted as before the
  //       cutoff (fails closed), at assemble and on re-check alike.
  it('leaves out a pick whose answer time cannot be read', () => {
    writeRecords([pickAt('d-1', '2026-11-13T09:30:00Z'), pickAt('d-2', 'not a time')]);
    const assembled = result(assembleIdeate(ctx()));
    expect(assembled.decisions).toEqual([expect.objectContaining({ id: 'd-1' })]);
    const rechecked = result(assembleIdeate({ ...ctx(), evidenceCutoff: String(assembled.evidenceCutoff) }));
    expect(rechecked.decisions).toEqual(assembled.decisions);
  });

  // Rule: D42, a result written before the cutoff existed (re-checked with a null cutoff) keeps counting every pick.
  it('counts every decision when re-checking a result with no cutoff', () => {
    writeRecords([pickAt('d-1', '2026-11-13T09:30:00Z'), pickAt('d-2', '2026-11-13T10:30:00Z')]);
    const r = result(assembleIdeate({ ...ctx(), evidenceCutoff: null }));
    expect(r.decisionsRecorded).toBe(2);
    expect(r).not.toHaveProperty('evidenceCutoff');
  });
});
