/**
 * Shared pieces for the phase result assemblers (R-257 T4, T5, T7, T8).
 *
 * An assembler returns the result object; the CLI (T9) validates it against the phase schema and writes it.
 * Error ids are the stable strings in NOTES.md.
 */
import { createHash } from 'node:crypto';
import { redactString } from '../services/redaction.js';
import type { Phase } from './schemas.js';
import { readValueFile } from './store.js';

export interface AssembleContext {
  repo: string;
  feature: string;
  startedAt: string;
  headSha: string;
  valueDir: string | null;
  now: () => Date;
  /**
   * D42: the evidence cutoff. Undefined: assemble now and store the cutoff; a string: re-check with that cutoff;
   * null: a result from before D42, checked by the old rule (every event since startedAt).
   */
  evidenceCutoff?: string | null;
  /** D84: the feature folder (absolute) when it is not `.oss/dev/active/<feature>`: the archived one, for ship. */
  featureDir?: string;
}

export type AssembleOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string; detail?: string };

/** Fields every phase result carries. */
export function baseFields(ctx: AssembleContext, phase: Phase): Record<string, unknown> {
  return {
    v: 1,
    phase,
    feature: ctx.feature,
    startedAt: ctx.startedAt,
    assembledAt: ctx.now().toISOString(),
    headSha: ctx.headSha,
    verification: 'verified',
    claims: [],
    chain: [],
  };
}

/** The parsed JSON text, or `fallback` when it does not parse. */
export function parseJsonOr(text: string, fallback: unknown): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fallback;
  }
}

/** One JSON line as a plain object; null when it does not parse or is not an object. */
export function parseJsonObject(line: string): Record<string, unknown> | null {
  const v = parseJsonOr(line, null);
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** The model's value file `name` (store.ts readValueFile rules); null when there is no value dir or no usable file. */
export function readValue(ctx: AssembleContext, name: string): string | null {
  return ctx.valueDir === null ? null : readValueFile(ctx.valueDir, name);
}

/** Hex sha256, the hash the ledger binds lines and results with. */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Scrub secrets out of model text. Control characters are left for the schema to refuse. */
export function redactModelText(s: string): string {
  return redactString(s);
}
