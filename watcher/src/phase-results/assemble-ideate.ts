/**
 * Ideate result assembler (R-257 T7, AC-003.1 as amended by D18).
 *
 * Decisions come from the hook's record file, counted only when the sha256 of the exact line matches a private ledger
 * row with the same feature and id, and the record's own feature is this feature. Zero decisions is valid (D18).
 * DESIGN.md needs a whole line `Status: COMMITTED`. Open questions are model text from `open-questions.json`.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { readValueFile } from './store.js';
import { LedgerError, openLedger } from './ledger.js';
import { baseFields, redactModelText, type AssembleContext, type AssembleOutcome } from './assemble-common.js';

const FILE_CAP = 1024 * 1024;
const MAX_DECISIONS = 200;
const TEXT_CAP = 4000;
const KIND_CAP = 64;

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

function parseRecord(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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

function readOpenQuestions(ctx: AssembleContext): string[] {
  const raw = ctx.valueDir === null ? null : readValueFile(ctx.valueDir, 'open-questions.json');
  let parsed: unknown;
  try {
    parsed = raw === null ? [] : (JSON.parse(raw) as unknown);
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((q): q is string => typeof q === 'string').map((q) => clipText(q, TEXT_CAP) ?? '');
}

export function assembleIdeate(ctx: AssembleContext): AssembleOutcome {
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
      const rec = parseRecord(line);
      if (rec === null || rec.feature !== ctx.feature || typeof rec.id !== 'string') continue;
      const sha = createHash('sha256').update(line).digest('hex');
      if (!keys.has(`${rec.id}\n${sha}`)) continue;
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
    },
  };
}
