/**
 * Ideate result assembler (R-257 T7, AC-003.1 as amended by D18).
 *
 * Decisions come from the hook's record file, counted only when the sha256 of the exact line matches a private ledger
 * row with the same feature and id, and the record's own feature is this feature. Zero decisions is valid (D18).
 * DESIGN.md needs a whole line `Status: COMMITTED`. Open questions are model text from `open-questions.json`.
 *
 * D42 (round 5, finding 1): the result stores its evidence cutoff, the assemble time, and a record answered after it
 * (its hook-stamped `answeredAt`) is not counted, so a later picker (plan's) never makes a finished ideate look
 * mismatched. A re-check passes the stored cutoff; `null` re-checks an older result with no cutoff (the old rule).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LedgerError, openLedger } from './ledger.js';
import {
  baseFields,
  parseJsonObject,
  parseJsonOr,
  readValue,
  redactModelText,
  sha256,
  type AssembleContext,
  type AssembleOutcome,
} from './assemble-common.js';

const FILE_CAP = 1024 * 1024;
const MAX_DECISIONS = 200;
const TEXT_CAP = 4000;
const KIND_CAP = 64;

/** D42: undefined assembles now (cutoff = now); a string re-checks with that cutoff; null re-checks with none. */
export type IdeateContext = AssembleContext & { evidenceCutoff?: string | null };

type FileRead = { ok: true; text: string | null } | { ok: false; error: string };

/** A repo file: O_NOFOLLOW, regular, at most 1 MB. Missing gives text null. */
function readRepoFile(p: string): FileRead {
  let fd: number;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: true, text: null };
    return { ok: false, error: 'unsafe_path' };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { ok: false, error: 'unsafe_path' };
    if (st.size > FILE_CAP) return { ok: false, error: 'too_large' };
    return { ok: true, text: fs.readFileSync(fd, 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

function clipText(v: unknown, cap: number): string | undefined {
  return typeof v === 'string' ? redactModelText(v).slice(0, cap) : undefined;
}

function ledgerKeys(ctx: AssembleContext): Set<string> {
  const keys = new Set<string>();
  for (const row of openLedger(ctx.repo).readRows(`decisions/${ctx.feature}`)) {
    if (row.feature === ctx.feature && typeof row.id === 'string' && typeof row.sha256 === 'string') {
      keys.add(`${row.id}\n${row.sha256}`);
    }
  }
  return keys;
}

/**
 * D42: the hook stamps answeredAt in whole seconds. D47: the cutoff is stored floored to the whole second, with no
 * fraction, and a pick counts when its stamp is at or before it, so a pick in the assemble's own second counts at
 * assemble and on re-check alike. A stored cutoff with a fraction comes from a result assembled under the old rule
 * (a pick counts only when its whole second ends by the cutoff), which it keeps so that result re-checks equal.
 * An answeredAt that is missing or not a time never counts (pen I2: fail closed), at assemble and on re-check.
 */
function answeredAfter(answeredAt: unknown, cutoff: string): boolean {
  const at = typeof answeredAt === 'string' ? Date.parse(answeredAt) : Number.NaN;
  if (Number.isNaN(at)) return true;
  return /\.\d+Z$/.test(cutoff) ? at + 1000 > Date.parse(cutoff) : at > Date.parse(cutoff);
}

function readOpenQuestions(ctx: AssembleContext): string[] {
  const raw = readValue(ctx, 'open-questions.json');
  const parsed = raw === null ? [] : parseJsonOr(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((q): q is string => typeof q === 'string').map((q) => clipText(q, TEXT_CAP) ?? '');
}

export function assembleIdeate(ctx: IdeateContext): AssembleOutcome {
  const cutoff = ctx.evidenceCutoff === undefined ? ctx.now().toISOString().replace(/\.\d+Z$/, 'Z') : ctx.evidenceCutoff;
  const dir = path.join(ctx.repo, '.oss', 'dev', 'active', ctx.feature);

  const design = readRepoFile(path.join(dir, 'DESIGN.md'));
  if (!design.ok) return { ok: false, error: design.error };
  const committed = (design.text ?? '').split('\n').some((l) => l.replace(/\r$/, '') === 'Status: COMMITTED');
  if (!committed) return { ok: false, error: 'design_not_committed' };

  const records = readRepoFile(path.join(dir, 'decisions.ndjson'));
  if (!records.ok) return { ok: false, error: records.error };

  const decisions: Record<string, unknown>[] = [];
  if (records.text !== null) {
    let keys: Set<string>;
    try {
      keys = ledgerKeys(ctx);
    } catch (e) {
      if (e instanceof LedgerError) return { ok: false, error: e.code };
      throw e;
    }
    for (const line of records.text.split('\n')) {
      if (decisions.length >= MAX_DECISIONS) break;
      const rec = parseJsonObject(line);
      if (rec === null || rec.feature !== ctx.feature || typeof rec.id !== 'string') continue;
      if (!keys.has(`${rec.id}\n${sha256(line)}`)) continue;
      if (cutoff !== null && answeredAfter(rec.answeredAt, cutoff)) continue;
      const d: Record<string, unknown> = { id: rec.id };
      const question = clipText(rec.question, TEXT_CAP);
      const answer = clipText(rec.answer, TEXT_CAP);
      const kind = clipText(rec.kind, KIND_CAP);
      if (question !== undefined) d.question = question;
      if (answer !== undefined) d.answer = answer;
      if (kind !== undefined) d.kind = kind;
      decisions.push(d);
    }
  }

  return {
    ok: true,
    result: {
      ...baseFields(ctx, 'ideate'),
      sources: { decisions: 'code', decisionsRecorded: 'code', designCommitted: 'code', openQuestions: 'model' },
      decisions,
      decisionsRecorded: decisions.length,
      designCommitted: true,
      openQuestions: readOpenQuestions(ctx),
      ...(cutoff === null ? {} : { evidenceCutoff: cutoff }),
    },
  };
}
