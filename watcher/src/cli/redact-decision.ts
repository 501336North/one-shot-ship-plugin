#!/usr/bin/env node
/**
 * redact-decision — scrub secrets out of decision record lines before they are committed
 *
 * Usage:
 *   node redact-decision.js < records.ndjson > redacted.ndjson
 *   node redact-decision.js --push-body < record-line.json > body.json
 *
 * Default mode: reads NDJSON on stdin (one decision record per line) and writes the same records with
 * every free-text field passed through the shared secret list (services/redaction.ts); a secret removed
 * from one field is removed from every other text field of the same record too.
 *
 * --push-body: reads ONE committed record line and writes the JSON body for POST /api/v1/decisions —
 * the one place in the plugin that knows that wire shape. The record is redacted again (whole record,
 * BEFORE any cut), then only the API's fields are kept and sized to its schema (UTF-16 units, no split
 * surrogate pair): question/notes 2000; header, recommended, labels, descriptions, each choice 200; at
 * most 20 options and 20 choices; a single-select choice becomes a one-item list; null header and
 * recommended are left out. person, session, answerText and v are never sent.
 *
 * Exit codes:
 *   0 — every line redacted; all lines written to stdout
 *       (--push-body: the body on stdout, or EMPTY stdout when the record has no feature:
 *        not pushable, keep it local)
 *   1 — a line could not be read; NOTHING is written to stdout (the hook fails closed)
 *   2 — (--push-body only) the line is valid JSON but can never be sent: a field has the wrong type
 *       (a null option description counts as no description) or breaks the API's metadata rules
 *       (id, feature, questionKey, answerIndex, kind, command, answeredAt). NOTHING is written to stdout.
 */

import { isMainModule } from '../lib/is-main-module.js';
import { cleanAndRedactWithRemoved } from '../services/redaction.js';

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
    const { text: redacted, removed } = cleanAndRedactWithRemoved(text);
    for (const span of removed) {
      if (span.length >= MIN_SPAN) spans.add(span);
    }
    return redacted;
  });
  const longestFirst = [...spans].sort((a, b) => b.length - a.length);
  mapTextFields((text: string): string => longestFirst.reduce((acc, span) => acc.split(span).join(MARKER), text));
  return out;
}

interface DecisionOption {
  label: string;
  description?: string | null;
}

/** A committed decision record line as hooks/oss-decision-record.sh writes it. */
interface DecisionLine {
  id: string;
  feature: string | null;
  questionKey: string;
  answerIndex: number;
  question: string;
  header: string | null;
  options: DecisionOption[];
  recommended: string | null;
  choice: string | string[];
  notes: string | null;
  kind: string;
  command: string;
  answeredAt: string;
}

/** Limits of the API's decision schema (packages/api/src/routes/decisions.ts); a 400 is never retried. */
const LONG_TEXT_MAX = 2000;
const SHORT_TEXT_MAX = 200;
const LIST_MAX = 20;

/** The API counts UTF-16 units (zod .max); a cut that would leave half a surrogate pair drops the pair. */
function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Absent or null optional text is left out of the body; present text is capped. */
function capOrOmit(text: string | null | undefined, max: number): string | undefined {
  return text === null || text === undefined ? undefined : cap(text, max);
}

/** The POST /api/v1/decisions body: only the fields the API schema accepts. */
function toPushBody(record: DecisionLine): Record<string, unknown> {
  return {
    id: record.id,
    feature: record.feature,
    questionKey: record.questionKey,
    answerIndex: record.answerIndex,
    question: cap(record.question, LONG_TEXT_MAX),
    header: capOrOmit(record.header, SHORT_TEXT_MAX),
    options: record.options.slice(0, LIST_MAX).map((option) => ({
      label: cap(option.label, SHORT_TEXT_MAX),
      description: capOrOmit(option.description, SHORT_TEXT_MAX),
    })),
    recommended: capOrOmit(record.recommended, SHORT_TEXT_MAX),
    choice: (Array.isArray(record.choice) ? record.choice : [record.choice]).slice(0, LIST_MAX).map((item) => cap(item, SHORT_TEXT_MAX)),
    notes: record.notes === null ? null : cap(record.notes, LONG_TEXT_MAX),
    kind: record.kind,
    command: record.command,
    answeredAt: record.answeredAt,
  };
}

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown): boolean => value === null || isText(value);

function isOption(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { label, description } = value as Record<string, unknown>;
  return isText(label) && (description === undefined || isTextOrNull(description));
}

/** The text fields hold the types toPushBody sizes; anything else is a 400 the API would give forever. */
function hasSendableShape(record: Record<string, unknown>): boolean {
  const { question, header, recommended, notes, options, choice } = record;
  return (
    isText(question) &&
    isTextOrNull(header) &&
    isTextOrNull(recommended) &&
    isTextOrNull(notes) &&
    Array.isArray(options) &&
    options.every(isOption) &&
    (isText(choice) || (Array.isArray(choice) && choice.every(isText)))
  );
}

/** The API's metadata rules (packages/api/src/routes/decisions.ts), checked before anything is sent. */
const ID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FEATURE = /^(?!\.)[A-Za-z0-9._-]{1,128}$/;
const QUESTION_KEY = /^[a-f0-9]{16}$/;
const KINDS = new Set<unknown>(['risk', 'scope', 'design']);
// Empty is allowed: the hook records "" when no workflow command is running, and the API takes it.
const COMMAND = /^(?:[a-z][a-z-]{0,63})?$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;
const EARLIEST_ANSWER_MS = Date.UTC(2020, 0, 1);

const matches = (value: unknown, pattern: RegExp): boolean => isText(value) && pattern.test(value);

function isAcceptedTime(value: unknown): boolean {
  if (!matches(value, ISO_UTC)) return false;
  const at = Date.parse(value as string);
  // Date.parse rolls Feb 30 over into March; the API refuses it, so the day must survive the round trip.
  return (
    Number.isFinite(at) &&
    new Date(at).toISOString().slice(0, 10) === (value as string).slice(0, 10) &&
    at >= EARLIEST_ANSWER_MS
  );
}

function hasValidMetadata(record: Record<string, unknown>): boolean {
  const { id, feature, questionKey, answerIndex, kind, command, answeredAt } = record;
  return (
    matches(id, ID_V4) &&
    matches(feature, FEATURE) &&
    matches(questionKey, QUESTION_KEY) &&
    Number.isInteger(answerIndex) &&
    (answerIndex as number) >= 1 &&
    (answerIndex as number) <= 100 &&
    KINDS.has(kind) &&
    matches(command, COMMAND) &&
    isAcceptedTime(answeredAt)
  );
}

function runPushBody(input: string): RedactResult {
  try {
    // Redact the whole record BEFORE capping: a cut through a secret leaves a prefix no pattern matches.
    const record = redactRecord(JSON.parse(input) as Record<string, unknown>);
    if (record.feature === null || record.feature === '') {
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (!hasSendableShape(record) || !hasValidMetadata(record)) {
      return { exitCode: 2, stdout: '', stderr: 'redact-decision: the record cannot be sent: a field breaks the API rules\n' };
    }
    return { exitCode: 0, stdout: `${JSON.stringify(toPushBody(record as unknown as DecisionLine))}\n`, stderr: '' };
  } catch {
    // The parse error quotes the line, which may hold the secret: say only that it was unreadable.
    return { exitCode: 1, stdout: '', stderr: 'redact-decision: the record is not valid JSON\n' };
  }
}

export function runRedactDecision(input: string, args: string[] = []): RedactResult {
  if (args.includes('--push-body')) {
    return runPushBody(input);
  }
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
  const result = runRedactDecision(await readStdin(), process.argv.slice(2));
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
