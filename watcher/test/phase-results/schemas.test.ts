/**
 * @behavior Each phase (ideate, plan, build, ship) writes a result file that must match its JSON Schema
 *           before the phase counts as done. The schemas ship with the plugin, never with the repo.
 * @business-rule R-257 T2 (amended S8): one schema per phase plus a common one; every object is closed,
 *                model text is capped at 4000 characters and may not carry control characters, and the
 *                schemas load only from the plugin's own schemas/phase-results/ directory.
 * @boundary watcher/src/phase-results/schemas.ts, schemas/phase-results/*.schema.json
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadPhaseSchema, PHASES, type Phase } from '../../src/phase-results/schemas.js';
import { validate, type ValidationResult } from '../../src/phase-results/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '../../..');
const FIXTURES = path.resolve(HERE, '../fixtures/phase-results');
const SCHEMA_DIR = path.join(PLUGIN_ROOT, 'schemas', 'phase-results');

type Json = Record<string, unknown>;

function fixture(phase: Phase): Json {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${phase}.valid.json`), 'utf8')) as Json;
}

function check(phase: Phase, value: unknown): ValidationResult {
  return validate(loadPhaseSchema(phase, PLUGIN_ROOT), value);
}

function rejected(r: ValidationResult): { path: string; rule: string } {
  if (r.ok) throw new Error('expected the value to be rejected');
  return { path: r.path, rule: r.rule };
}

const LONG = 'x'.repeat(4001);

/** Per phase: a wrong enum and an over-long model text field, each with the path the error must name. */
const CASES: Record<Phase, {
  wrongEnum: (v: Json) => void; enumPath: string;
  longText: (v: Json) => void; longPath: string;
  required: string;
}> = {
  ideate: {
    wrongEnum: (v) => { v.designCommitted = false; }, enumPath: '$.designCommitted',
    longText: (v) => { v.openQuestions = [LONG]; }, longPath: '$.openQuestions[0]',
    required: 'decisionsRecorded',
  },
  plan: {
    wrongEnum: (v) => { v.phase = 'build'; }, enumPath: '$.phase',
    longText: (v) => { (v.tasks as Json[])[0].title = LONG; }, longPath: '$.tasks[0].title',
    required: 'tasks',
  },
  build: {
    wrongEnum: (v) => { (v.testRuns as Json).lastResult = 'yellow'; }, enumPath: '$.testRuns.lastResult',
    longText: (v) => { v.notes = LONG; }, longPath: '$.notes',
    required: 'testRuns',
  },
  ship: {
    wrongEnum: (v) => { v.verdict = 'merged'; }, enumPath: '$.verdict',
    longText: (v) => { v.summary = LONG; }, longPath: '$.summary',
    required: 'diff',
  },
};

for (const phase of PHASES) {
  describe(`${phase} result schema`, () => {
    // Behaviour: a correct result for this phase is accepted. Rule: the shipped fixture matches the shape the assembler emits.
    it('should accept the valid fixture', () => {
      expect(check(phase, fixture(phase))).toEqual({ ok: true });
    });

    // Behaviour: a result with a field nobody defined is refused. Rule: every object is closed (additionalProperties false).
    it('should reject an unknown field', () => {
      const v = { ...fixture(phase), extra: 1 };
      expect(rejected(check(phase, v))).toEqual({ path: '$.extra', rule: 'additionalProperties' });
    });

    // Behaviour: a value outside the allowed set is refused. Rule: enums are exact.
    it('should reject a wrong enum value', () => {
      const v = fixture(phase);
      CASES[phase].wrongEnum(v);
      expect(rejected(check(phase, v))).toEqual({ path: CASES[phase].enumPath, rule: 'enum' });
    });

    // Behaviour: model prose longer than 4000 characters is refused. Rule: model text is size-capped.
    it('should reject an over-long model text field (4001)', () => {
      const v = fixture(phase);
      CASES[phase].longText(v);
      expect(rejected(check(phase, v))).toEqual({ path: CASES[phase].longPath, rule: 'maxLength' });
    });

    // Behaviour: a result missing a phase field is refused. Rule: each phase's fields are required.
    it('should reject a missing required field', () => {
      const v = fixture(phase);
      delete v[CASES[phase].required];
      expect(rejected(check(phase, v))).toEqual({ path: `$.${CASES[phase].required}`, rule: 'required' });
    });

    // Behaviour: a result without the common header is refused. Rule: v, feature, startedAt, headSha etc. are required everywhere.
    it('should reject a missing common field', () => {
      const v = fixture(phase);
      delete v.headSha;
      expect(rejected(check(phase, v))).toEqual({ path: '$.headSha', rule: 'required' });
    });
  });
}

describe('common fields', () => {
  // Behaviour: a result says whether it was verified. Rule: verification is verified|unverified only.
  it('should require verification in {verified, unverified}', () => {
    const v = fixture('build');
    v.verification = 'unverified';
    v.verificationError = { check: 'events', errorClass: 'events_truncated' };
    expect(check('build', v)).toEqual({ ok: true });
    v.verification = 'maybe';
    expect(rejected(check('build', v))).toEqual({ path: '$.verification', rule: 'enum' });
    delete v.verification;
    expect(rejected(check('build', v))).toEqual({ path: '$.verification', rule: 'required' });
  });

  // Behaviour: a verification error carries only safe tokens. Rule: verificationError is {check, errorClass}, closed.
  it('should refuse a verificationError with free text or extra fields', () => {
    const v = fixture('build');
    v.verificationError = { check: 'events', errorClass: 'has spaces; rm -rf' };
    expect(rejected(check('build', v))).toEqual({ path: '$.verificationError.errorClass', rule: 'pattern' });
    v.verificationError = { check: 'events', errorClass: 'x', why: 'y' };
    expect(rejected(check('build', v))).toEqual({ path: '$.verificationError.why', rule: 'additionalProperties' });
  });

  // Behaviour: claims are bounded and labelled from a fixed set. Rule: at most 100 claims, label VERIFIED|REFUTED|UNVERIFIABLE.
  it('should cap claims[] at 100 and accept label VERIFIED|REFUTED|UNVERIFIABLE', () => {
    const v = fixture('plan');
    v.claims = ['VERIFIED', 'REFUTED', 'UNVERIFIABLE'].map((label) => ({ text: 't', kind: 'k', label }));
    expect(check('plan', v)).toEqual({ ok: true });
    v.claims = Array.from({ length: 100 }, () => ({ text: 't', kind: 'k' }));
    expect(check('plan', v)).toEqual({ ok: true });
    v.claims = Array.from({ length: 101 }, () => ({ text: 't', kind: 'k' }));
    expect(rejected(check('plan', v))).toEqual({ path: '$.claims', rule: 'maxItems' });
    v.claims = [{ text: 't', kind: 'k', label: 'TRUE' }];
    expect(rejected(check('plan', v))).toEqual({ path: '$.claims[0].label', rule: 'enum' });
  });

  // Behaviour: the command chain records which commands ran. Rule: chain entries are {command, ranAt, initEventId}.
  it('should accept chain[] entries {command, ranAt, initEventId}', () => {
    const v = fixture('ship');
    v.chain = [
      { command: 'ideate', ranAt: '2026-11-12T10:00:00Z', initEventId: 'evt-1' },
      { command: 'plan', ranAt: '2026-11-12T11:00:00.123Z', initEventId: 'evt-2' },
    ];
    expect(check('ship', v)).toEqual({ ok: true });
    v.chain = [{ command: 'plan', ranAt: 'yesterday', initEventId: 'evt-2' }];
    expect(rejected(check('ship', v))).toEqual({ path: '$.chain[0].ranAt', rule: 'pattern' });
    v.chain = [{ command: 'plan', ranAt: '2026-11-12T11:00:00Z' }];
    expect(rejected(check('ship', v))).toEqual({ path: '$.chain[0].initEventId', rule: 'required' });
  });

  // Behaviour: a ship result names the branch its diff was taken against, so check can re-derive it.
  // Rule: diff.baseRef is required, a branch-name shape (no `..`, not starting with `-`).
  it('should accept the ship fixture with diff.baseRef and refuse a missing or malformed one', () => {
    const v = fixture('ship');
    expect((v.diff as Json).baseRef).toBe('feat/sprint-d/build');
    expect(check('ship', v)).toEqual({ ok: true });
    delete (v.diff as Json).baseRef;
    expect(rejected(check('ship', v))).toEqual({ path: '$.diff.baseRef', rule: 'required' });
    for (const bad of ['main..x', '-main', '', 'a b', 'x'.repeat(201)]) {
      (v.diff as Json).baseRef = bad;
      expect(check('ship', v).ok, bad).toBe(false);
    }
  });

  // Behaviour: a field's source says who produced it. Rule: sources values are code|model|agent, keys are the phase's fields.
  it('should reject an unknown sources key or source value', () => {
    const v = fixture('build');
    v.sources = { testRuns: 'human' };
    expect(rejected(check('build', v))).toEqual({ path: '$.sources.testRuns', rule: 'enum' });
    v.sources = { verdict: 'code' };
    expect(rejected(check('build', v))).toEqual({ path: '$.sources.verdict', rule: 'additionalProperties' });
  });

  // Behaviour: a field the plugin's code derives cannot be relabelled as the model's (or an agent's).
  // Rule: round 2 security: each code-owned sources entry is pinned to "code" in the schema.
  it('should reject a code-owned sources entry relabelled model or agent', () => {
    const cases: Array<[Phase, string]> = [
      ['ship', 'verdict'], ['ship', 'diff'], ['ship', 'blockers'], ['ship', 'overrides'], ['ship', 'gateEvidence'],
      ['ship', 'uncapturedGates'], ['build', 'testRuns'], ['build', 'evidenceTrust'], ['ideate', 'decisions'],
      ['ideate', 'decisionsRecorded'], ['ideate', 'designCommitted'],
    ];
    for (const [phase, field] of cases) {
      for (const source of ['model', 'agent']) {
        const v = fixture(phase);
        v.sources = { [field]: source };
        expect(rejected(check(phase, v)), `${phase}.${field}=${source}`).toEqual({ path: `$.sources.${field}`, rule: 'enum' });
      }
    }
  });

  // Behaviour: terminal escapes in model text cannot reach the user's screen. Rule: control characters except tab/newline are refused.
  it('should reject an ANSI escape in a model text field', () => {
    const v = fixture('build');
    v.notes = 'all good \u001b[31mRED\u001b[0m';
    expect(rejected(check('build', v))).toEqual({ path: '$.notes', rule: 'pattern' });
    const s = fixture('ship');
    s.summary = 'ok\u007f';
    expect(rejected(check('ship', s))).toEqual({ path: '$.summary', rule: 'pattern' });
    const p = fixture('plan');
    (p.tasks as Json[])[0].title = 'bell\u0007';
    expect(rejected(check('plan', p))).toEqual({ path: '$.tasks[0].title', rule: 'pattern' });
  });
});

describe('ship specifics', () => {
  // Behaviour: the ship diff is pinned to a real commit. Rule: diff.base is 40 lowercase hex, counts are integers >= 0.
  it('should require ship.diff {base: 40-hex, baseRef, files, insertions, deletions}', () => {
    const v = fixture('ship');
    (v.diff as Json).base = 'main';
    expect(rejected(check('ship', v))).toEqual({ path: '$.diff.base', rule: 'pattern' });
    v.diff = { base: 'fedcba9876543210fedcba9876543210fedcba98', baseRef: 'main', files: 1, insertions: 1 };
    expect(rejected(check('ship', v))).toEqual({ path: '$.diff.deletions', rule: 'required' });
    v.diff = { base: 'fedcba9876543210fedcba9876543210fedcba98', baseRef: 'main', files: -1, insertions: 1, deletions: 0 };
    expect(rejected(check('ship', v))).toEqual({ path: '$.diff.files', rule: 'minimum' });
  });

  // Behaviour: ship ends in exactly one of two verdicts. Rule: verdict is ready_to_merge|blocked.
  it('should require verdict in {ready_to_merge, blocked}', () => {
    const v = fixture('ship');
    v.verdict = 'blocked';
    v.blockers = ['security gate failed'];
    expect(check('ship', v)).toEqual({ ok: true });
    v.verdict = 'approved';
    expect(rejected(check('ship', v))).toEqual({ path: '$.verdict', rule: 'enum' });
  });
});

describe('plan specifics', () => {
  // Behaviour: every planned task names at least one test. Rule: testIds has minItems 1 (D11).
  it('should reject a task with no test ids', () => {
    const v = fixture('plan');
    (v.tasks as Json[])[0].testIds = [];
    expect(rejected(check('plan', v))).toEqual({ path: '$.tasks[0].testIds', rule: 'minItems' });
  });
});

describe('loadPhaseSchema: plugin root only', () => {
  const made: string[] = [];
  const cwd = process.cwd();
  afterEach(() => {
    process.chdir(cwd);
    for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function tmp(): string {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oss-schemas-')));
    made.push(d);
    return d;
  }

  // Behaviour: a repo cannot loosen the rules by shipping its own schemas. Rule: schemas load only from the plugin root (S8).
  it('should ignore a planted <repo>/schemas/phase-results/', () => {
    const repo = tmp();
    const planted = path.join(repo, 'schemas', 'phase-results');
    fs.mkdirSync(planted, { recursive: true });
    for (const p of ['common', ...PHASES]) {
      fs.writeFileSync(path.join(planted, `${p}.schema.json`), JSON.stringify({ type: 'object' }));
    }
    process.chdir(repo);
    const v = { ...fixture('build'), extra: 1 };
    expect(rejected(check('build', v)).rule).toBe('additionalProperties');
  });

  // Behaviour: a schema file that links outside the plugin's schema dir is refused. Rule: realpath must stay inside the dir.
  it('should refuse a schema file that is a symlink to outside the schema dir', () => {
    const root = tmp();
    const dir = path.join(root, 'schemas', 'phase-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(SCHEMA_DIR, 'common.schema.json'), path.join(dir, 'common.schema.json'));
    const outside = path.join(root, 'loose.schema.json');
    fs.writeFileSync(outside, JSON.stringify({ type: 'object' }));
    fs.symlinkSync(outside, path.join(dir, 'build.schema.json'));
    expect(() => loadPhaseSchema('build', root)).toThrow(/unsafe_path/);
  });

  // Behaviour: only the four phases have schemas. Rule: an unknown phase never becomes a file path.
  it('should refuse an unknown phase', () => {
    expect(() => loadPhaseSchema('../common' as Phase, PLUGIN_ROOT)).toThrow(/unsafe_path/);
  });
});

describe('shipped patterns', () => {
  function patterns(node: unknown, out: string[]): string[] {
    if (Array.isArray(node)) node.forEach((n) => patterns(n, out));
    else if (typeof node === 'object' && node !== null) {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'pattern' && typeof v === 'string') out.push(v);
        else patterns(v, out);
      }
    }
    return out;
  }

  // Behaviour: a crafted result cannot hang the checker. Rule: no shipped pattern nests an unbounded quantifier (S8, ReDoS).
  it('should have no nested quantifier in any shipped pattern', () => {
    const all: string[] = [];
    for (const p of ['common', ...PHASES]) {
      const json: unknown = JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, `${p}.schema.json`), 'utf8'));
      patterns(json, all);
    }
    expect(all.length).toBeGreaterThan(5);
    // A group holding a quantifier, itself followed by a repeating quantifier: (a+)+, (a*)*, (a{1,}){2,}, (a+){1,9}.
    const nested = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d+,?\d*\})(?:[^()\\]|\\.)*\)(?:[+*]|\{\d+,?\d*\})/;
    expect(all.filter((p) => nested.test(p))).toEqual([]);
  });
});
