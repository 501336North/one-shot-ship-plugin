/**
 * @behavior A phase result is checked against its JSON Schema before it counts as done,
 *           using a small validator that ships inside the watcher bundle (no new dependency).
 * @business-rule D5: only a fixed keyword subset is supported; any other keyword is refused
 *                when the schema loads, never silently ignored. Patterns are full-string
 *                matches, capped at 200 characters, and checked after maxLength (S8).
 * @boundary watcher/src/phase-results/validate.ts
 */
import { describe, it, expect } from 'vitest';
import { loadSchema, validate } from '../../src/phase-results/validate.js';

describe('validate: keyword subset', () => {
  // Behaviour: a well-formed result is accepted. Rule: every supported keyword passes on a valid value.
  it('should accept a value matching type/required/properties/enum/pattern/maxLength/maxItems/minItems/minimum/items', () => {
    const schema = loadSchema({
      type: 'object',
      required: ['phase', 'diff', 'tasks'],
      additionalProperties: false,
      properties: {
        phase: { type: 'string', enum: ['plan', 'ship'] },
        diff: {
          type: 'object',
          properties: {
            base: { type: 'string', maxLength: 40, pattern: '[0-9a-f]{40}' },
            files: { type: 'integer', minimum: 1 },
          },
        },
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
        },
        note: { type: ['string', 'null'] },
        ok: { type: 'boolean' },
        score: { type: 'number' },
      },
    });
    const value = {
      phase: 'ship',
      diff: { base: 'a'.repeat(40), files: 3 },
      tasks: [{ id: 'T1' }],
      note: null,
      ok: true,
      score: 1.5,
    };
    expect(validate(schema, value)).toEqual({ ok: true });
  });

  // Behaviour: a bad field is reported by its JSON path. Rule: each keyword violation names the
  // failing keyword and the exact path, so the user knows which field to fix.
  const failRows: Array<[string, Record<string, unknown>, unknown, string, string]> = [
    ['type', { type: 'object', properties: { a: { type: 'string' } } }, { a: 1 }, '$.a', 'type'],
    ['type integer', { type: 'object', properties: { a: { type: 'integer' } } }, { a: 1.5 }, '$.a', 'type'],
    ['type object rejects array', { type: 'object' }, [], '$', 'type'],
    ['type null', { type: 'object', properties: { a: { type: 'null' } } }, { a: 0 }, '$.a', 'type'],
    ['required', { type: 'object', properties: { diff: { type: 'object', required: ['base'] } } }, { diff: {} }, '$.diff.base', 'required'],
    ['enum', { type: 'object', properties: { verdict: { enum: ['ready_to_merge', 'blocked'] } } }, { verdict: 'maybe' }, '$.verdict', 'enum'],
    ['pattern', { type: 'object', properties: { diff: { properties: { base: { type: 'string', pattern: '[0-9a-f]{40}' } } } } }, { diff: { base: 'xyz' } }, '$.diff.base', 'pattern'],
    ['maxLength', { type: 'object', properties: { s: { type: 'string', maxLength: 3 } } }, { s: 'abcd' }, '$.s', 'maxLength'],
    ['maxItems', { type: 'object', properties: { l: { type: 'array', maxItems: 1 } } }, { l: [1, 2] }, '$.l', 'maxItems'],
    ['minItems', { type: 'object', properties: { l: { type: 'array', minItems: 1 } } }, { l: [] }, '$.l', 'minItems'],
    ['minimum', { type: 'object', properties: { n: { type: 'integer', minimum: 0 } } }, { n: -1 }, '$.n', 'minimum'],
    ['items', { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } }, { tasks: [{ id: 'T1' }, { id: 2 }] }, '$.tasks[1].id', 'type'],
  ];
  it.each(failRows)('should reject with the JSON path of the field (%s)', (_name, json, value, path, rule) => {
    expect(validate(loadSchema(json), value)).toEqual({ ok: false, path, rule });
  });

  // Behaviour: a model cannot sneak extra fields into a result. Rule: additionalProperties false
  // refuses any property not declared.
  it('should reject an unknown property when additionalProperties is false', () => {
    const schema = loadSchema({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } });
    expect(validate(schema, { a: 'x', extra: 1 })).toEqual({ ok: false, path: '$.extra', rule: 'additionalProperties' });
    expect(validate(schema, { a: 'x' })).toEqual({ ok: true });
  });

  // Behaviour: shared fields live in one common schema. Rule: $ref "common.schema.json#/$defs/x"
  // resolves into the named common schema, and a local "#/$defs/x" resolves in the same file.
  it('should resolve $ref to the common schema', () => {
    const common = loadSchema({
      $id: 'common.schema.json',
      $defs: {
        verification: { type: 'string', enum: ['verified', 'unverified'] },
        sha: { type: 'string', pattern: '[0-9a-f]{40}' },
        diff: { type: 'object', properties: { base: { $ref: '#/$defs/sha' } } },
      },
    });
    const ship = loadSchema(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: 'ship',
        description: 'ship result',
        type: 'object',
        properties: {
          verification: { $ref: 'common.schema.json#/$defs/verification' },
          diff: { $ref: 'common.schema.json#/$defs/diff' },
        },
      },
      { 'common.schema.json': common },
    );
    expect(validate(ship, { verification: 'verified', diff: { base: 'b'.repeat(40) } })).toEqual({ ok: true });
    expect(validate(ship, { verification: 'nope' })).toEqual({ ok: false, path: '$.verification', rule: 'enum' });
    expect(validate(ship, { diff: { base: 'zz' } })).toEqual({ ok: false, path: '$.diff.base', rule: 'pattern' });
  });

  // Behaviour: a schema pointing at a missing definition fails loudly at load. Rule: no silent pass.
  it('should refuse to load a $ref that does not resolve', () => {
    expect(() => loadSchema({ $ref: 'common.schema.json#/$defs/missing' }, {})).toThrow(/unresolved_ref/);
  });

  // Behaviour: a schema author cannot use a keyword the validator would ignore. Rule: D5 refuses
  // unsupported keywords at load time with unsupported_keyword and the keyword name.
  it.each(['oneOf', 'if', 'format', 'anyOf', 'patternProperties'])(
    'should refuse to load a schema that uses an unsupported keyword (%s)',
    (kw) => {
      expect(() => loadSchema({ type: 'object', properties: { a: { type: 'string', [kw]: 'x' } } })).toThrow(
        new RegExp(`unsupported_keyword.*${kw}`),
      );
    },
  );

  // Behaviour: definitions are schemas too. Rule: an unsupported keyword inside $defs is refused.
  it('should refuse an unsupported keyword inside $defs', () => {
    expect(() => loadSchema({ $defs: { x: { oneOf: [] } } })).toThrow(/unsupported_keyword.*oneOf/);
  });

  // Behaviour: additionalProperties may only close an object. Rule: anything but false is refused.
  it('should refuse additionalProperties other than false', () => {
    expect(() => loadSchema({ type: 'object', additionalProperties: true })).toThrow(/unsupported_keyword.*additionalProperties/);
  });
});

describe('validate: pattern safety (S8)', () => {
  // Behaviour: "abc" inside a longer string does not satisfy pattern "abc". Rule: patterns are
  // compiled as ^(?:p)$, so the whole string must match.
  it('should treat pattern as a full-string match', () => {
    const schema = loadSchema({ type: 'object', properties: { s: { type: 'string', pattern: 'a|b' } } });
    expect(validate(schema, { s: 'a' })).toEqual({ ok: true });
    expect(validate(schema, { s: 'xa' })).toEqual({ ok: false, path: '$.s', rule: 'pattern' });
    expect(validate(schema, { s: 'bx' })).toEqual({ ok: false, path: '$.s', rule: 'pattern' });
  });

  // Behaviour: a schema with a huge pattern cannot be loaded. Rule: ReDoS cap of 200 characters.
  it('should refuse patterns over 200 chars', () => {
    expect(() => loadSchema({ type: 'string', pattern: 'a'.repeat(201) })).toThrow(/pattern_too_long/);
    expect(() => loadSchema({ type: 'string', pattern: 'a'.repeat(200) })).not.toThrow();
  });

  // Behaviour: an over-long string is refused before any regex runs on it. Rule: maxLength is
  // checked before pattern, so the regex never sees unbounded input.
  it('should check maxLength before pattern', () => {
    const schema = loadSchema({ type: 'string', maxLength: 5, pattern: '[0-9]+' });
    expect(validate(schema, 'abcdefgh')).toEqual({ ok: false, path: '$', rule: 'maxLength' });
  });

  // Behaviour: a hostile, deeply nested result cannot crash the check. Rule: the walk follows the
  // schema, not the value, so a 100k-deep value fails at the first mismatch with no RangeError.
  it('should fail a 100k-deep nested value without throwing', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 100_000; i++) deep = { a: deep };
    const schema = loadSchema({ type: 'object', properties: { a: { type: 'string' } } });
    expect(validate(schema, deep)).toEqual({ ok: false, path: '$.a', rule: 'type' });
  });
});
