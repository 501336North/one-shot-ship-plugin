#!/usr/bin/env node
/**
 * redact-decision — scrub secrets out of decision record lines before they are committed
 *
 * Usage:
 *   node redact-decision.js < records.ndjson > redacted.ndjson
 *
 * Reads NDJSON on stdin (one decision record per line) and writes the same records with every
 * free-text field passed through the shared secret list (services/redaction.ts); a secret removed from
 * one field is removed from every other text field of the same record too.
 *
 * Exit codes:
 *   0 — every line redacted; all lines written to stdout
 *   1 — a line could not be read; NOTHING is written to stdout (the hook fails closed)
 */

import { isMainModule } from '../lib/is-main-module.js';
import { cleanText, redactStringWithRemoved } from '../services/redaction.js';

export interface RedactResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const MARKER = '[REDACTED]';

/** Every string at any depth goes through fn; numbers, booleans, null and object keys are kept. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return fn(value);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => mapStrings(item, fn));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, mapStrings(inner, fn)]));
  }
  return value;
}

/** The record fields that hold text a person wrote or picked; ids, keys and metadata pass through as is. */
const FREE_TEXT_FIELDS = ['question', 'header', 'options', 'recommended', 'choice', 'answerText', 'notes'] as const;

/** A span shorter than this is too likely to be ordinary text to be blanked everywhere. */
const MIN_SPAN = 6;

/**
 * Each text field is redacted on its own, then every secret removed from any field is removed from all of
 * them: labels, choice, answerText and recommended derive from the same text, and a value caught in one
 * field's context ("Password: x" ending its line) may read as prose in another's ("Password: x, Other").
 */
function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...record };
  const mapTextFields = (fn: (text: string) => string): void => {
    for (const field of FREE_TEXT_FIELDS) {
      if (field in out) {
        out[field] = mapStrings(out[field], fn);
      }
    }
  };
  const spans = new Set<string>();
  mapTextFields((text: string): string => {
    const { text: redacted, removed } = redactStringWithRemoved(cleanText(text));
    for (const span of removed) {
      if (span.length >= MIN_SPAN) spans.add(span);
    }
    return redacted;
  });
  const longestFirst = [...spans].sort((a, b) => b.length - a.length);
  mapTextFields((text: string): string => longestFirst.reduce((acc, span) => acc.split(span).join(MARKER), text));
  return out;
}

export function runRedactDecision(input: string): RedactResult {
  const lines = input.split('\n').filter((line) => line.trim() !== '');
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      out.push(`${JSON.stringify(redactRecord(JSON.parse(line) as Record<string, unknown>))}\n`);
    } catch {
      // The parse error quotes the line, which may hold the secret: name the line only.
      return { exitCode: 1, stdout: '', stderr: `redact-decision: record ${index + 1} is not valid JSON\n` };
    }
  }
  return { exitCode: 0, stdout: out.join(''), stderr: '' };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function main(): Promise<void> {
  const result = runRedactDecision(await readStdin());
  if (result.stdout !== '') {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== '') {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void main();
}
