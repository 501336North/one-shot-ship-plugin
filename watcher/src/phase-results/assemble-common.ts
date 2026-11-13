/**
 * Shared pieces for the phase result assemblers (R-257 T4, T5, T7, T8).
 *
 * An assembler returns the result object; the CLI (T9) validates it against the phase schema and writes it.
 * Error ids are the stable strings in NOTES.md.
 */
import { redactString } from '../services/redaction.js';
import type { Phase } from './schemas.js';

export interface AssembleContext {
  repo: string;
  feature: string;
  startedAt: string;
  headSha: string;
  valueDir: string | null;
  now: () => Date;
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

/** Scrub secrets out of model text. Control characters are left for the schema to refuse. */
export function redactModelText(s: string): string {
  return redactString(s);
}
