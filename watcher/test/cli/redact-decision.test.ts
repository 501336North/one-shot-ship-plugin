/**
 * redact-decision CLI Tests — secret redaction of committed decision records
 *
 * @behavior A secret typed or pasted into a picker answer ("Other" text, notes, a label) is replaced
 *           with [REDACTED] before the decision record line is written to the committed file, and
 *           everything else in the record is written exactly as it came in.
 * @business-rule A credential never reaches git history through a decision record. The plugin uses
 *                ONE secret list (services/redaction.ts), and that list catches every sample the API's
 *                own redaction test catches (the API redacts again on upload: defence in depth).
 * @acceptance-criteria US-006 AC-006.2 (radical-observability G1)
 * @boundary CLI: watcher/src/cli/redact-decision.ts (runRedactDecision: NDJSON in, NDJSON out)
 *
 * Every secret-shaped value is FAKE and built by concatenation, so no literal token is committed.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { cleanText, redactString } from '../../src/services/redaction.js';

/**
 * test/fixtures/api-secret-samples.json MIRRORS the API's redaction test
 * (AgenticDevWorkflow packages/api/test/decisions/redaction.test.ts) and must change with it:
 * every sample that test redacts is listed there, secrets stored as split parts.
 */
interface SecretSample {
  source: string;
  parts: string[];
  fragments: string[];
  clean?: boolean;
}

interface SampleFixture {
  samples: SecretSample[];
}

interface RedactResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunRedactDecision = (input: string) => RedactResult;

/** Module under test — dynamic import so a missing module is a clean test failure. */
async function loadCli(): Promise<RunRedactDecision> {
  const mod = (await import('../../src/cli/redact-decision.js')) as unknown as {
    runRedactDecision: RunRedactDecision;
  };
  return mod.runRedactDecision;
}

// Fake token bodies (taken from the API redaction test), each distinctive so no fragment can hide.
const GH_BODY_1 = `${'A1b2C3d4E5'.repeat(3)}x9Y8z7`;
const GH_BODY_2 = `${'Q7w8E9r0T1'.repeat(3)}m4N5b6`;
const SK_BODY_1 = 'Zq8Wm3Kt'.repeat(3);
const SK_BODY_2 = 'Pv5Lx2Hy'.repeat(3);
const AWS_BODY_1 = 'K2M4N6P8R1S3T5V7';
const AWS_BODY_2 = 'Z9X8C7V6B5N4M3L2';
const JWT_HEAD = 'hbGciOiJIUzI1NiJ9';
const JWT_PAYLOAD_1 = 'zdWIiOiIxMjM0NTY3ODkwIn0';
const JWT_SIG_1 = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV';
const JWT_PAYLOAD_2 = 'uYW1lIjoiQm9iIiwiYWRtaW4iOnRydWV9';
const JWT_SIG_2 = 'Xk4Vr7Lq2Tn9Pw5Hm3Jd8Gc6Bf1Zs0Ya';
const PGP_BODY = `lQOYBGVmZXNlY3JldA${'Kq9Wd2'.repeat(8)}`;
const PGP_CHECKSUM = '=Tm4x';
const XOXE_BODY = 'E2kd93Lmq7Rt';
const AK_BODY = 'c3'.repeat(32);

const ghToken = (body: string): string => `ghp${'_'}${body}`;
const stripeLive = (body: string): string => `sk${'_live_'}${body}`;
const awsKey = (body: string): string => `AK${'IA'}${body}`;
const jwt = (payload: string, sig: string): string => `ey${'J'}${JWT_HEAD}.ey${'J'}${payload}.${sig}`;
const pgpBlock = (): string =>
  ['-----BEGIN PGP ' + 'PRIVATE KEY BLOCK-----', '', PGP_BODY, PGP_CHECKSUM, '-----END PGP ' + 'PRIVATE KEY BLOCK-----'].join('\n');

const ALL_SECRET_FRAGMENTS = [
  GH_BODY_1, GH_BODY_2, SK_BODY_1, SK_BODY_2, AWS_BODY_1, AWS_BODY_2,
  JWT_PAYLOAD_1, JWT_SIG_1, JWT_PAYLOAD_2, JWT_SIG_2, PGP_BODY, PGP_CHECKSUM, 'PRIVATE KEY',
  XOXE_BODY, AK_BODY.slice(-12),
];

function baseRecord(): Record<string, unknown> {
  return {
    v: 1,
    id: '7f0c1e2a-3b4c-4d5e-8f90-a1b2c3d4e5f6',
    feature: 'demo',
    questionKey: 'a1b2c3d4e5f60718',
    answerIndex: 1,
    question: 'Which rollout approach?',
    header: 'Rollout',
    options: [
      { label: 'Canary', description: 'Ship to 5% first' },
      { label: 'Big bang', description: 'Ship to everyone' },
    ],
    recommended: 'Canary',
    choice: 'Canary',
    notes: null,
    kind: 'design',
    command: 'build',
    answeredAt: '2026-10-28T12:00:00.000Z',
    person: { status: 'unverified' },
    session: 'session-1234',
  };
}

function expectNoSecret(text: unknown, label: string): void {
  const value = typeof text === 'string' ? text : JSON.stringify(text);
  for (const fragment of ALL_SECRET_FRAGMENTS) {
    expect(value, `${label} must not contain ${fragment.slice(0, 6)}...`).not.toContain(fragment);
  }
}

describe('redact-decision CLI', () => {
  it('should redact every secret kind from the API-side list, including glued and PGP cases, in every text field of a record', async () => {
    const runRedactDecision = await loadCli();
    const zeroWidthSplit = `ak_${AK_BODY}`.slice(0, 10) + '​' + `ak_${AK_BODY}`.slice(10);
    const stringChoice = {
      ...baseRecord(),
      question: `Should we rotate the deploy token ${ghToken(GH_BODY_1)}${ghToken(GH_BODY_2)} before launch?`,
      header: `Key ${awsKey(AWS_BODY_1)}`,
      options: [
        { label: `Rotate ${stripeLive(SK_BODY_1)}${stripeLive(SK_BODY_2)}`, description: `Session ${jwt(JWT_PAYLOAD_1, JWT_SIG_1)}${jwt(JWT_PAYLOAD_2, JWT_SIG_2)}` },
        { label: 'Keep it', description: 'Leave the key as it is' },
      ],
      recommended: `Rotate ${stripeLive(SK_BODY_1)}`,
      choice: `Other: use xo${'xe-1-4815162342-'}${XOXE_BODY.repeat(2)}`,
      answerText: `pasted ${awsKey(AWS_BODY_2)} by mistake`,
      notes: `the signing key leaked:\n${pgpBlock()}\nplease rotate it, also ${zeroWidthSplit}`,
    };
    const arrayChoice = {
      ...baseRecord(),
      choice: [`Rotate ${stripeLive(SK_BODY_2)}`, 'Keep it'],
    };

    const result = runRedactDecision(`${JSON.stringify(stringChoice)}\n${JSON.stringify(arrayChoice)}\n`);

    expect(result.exitCode).toBe(0);
    const [first, second] = result.stdout.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const field of ['question', 'header', 'options', 'recommended', 'choice', 'answerText', 'notes']) {
      expectNoSecret(first[field], field);
    }
    expectNoSecret(second.choice, 'choice[]');
    // Redaction replaces the secret, not the field: the words around it survive.
    expect(first.question).toMatch(/^Should we rotate the deploy token (\[REDACTED\])+ before launch\?$/);
    expect(first.options).toEqual([
      { label: expect.stringMatching(/^Rotate (\[REDACTED\])+$/), description: expect.stringMatching(/^Session (\[REDACTED\])+$/) },
      { label: 'Keep it', description: 'Leave the key as it is' },
    ]);
    expect(first.notes).toBe('the signing key leaked:\n[REDACTED]\nplease rotate it, also [REDACTED]');
    expect(second.choice).toEqual(['Rotate [REDACTED]', 'Keep it']);
  });

  it('should redact secrets at any depth of the text fields: an option preview, an extra option key, and object-valued header and notes', async () => {
    // AskUserQuestion options carry a "preview" (often a code snippet), and a record may hold shapes the
    // CLI does not know: every string anywhere inside a text field is scrubbed, as the API does on upload.
    const runRedactDecision = await loadCli();
    const record = {
      ...baseRecord(),
      header: { title: 'Rollout', token: ghToken(GH_BODY_1) },
      options: [
        {
          label: 'Canary',
          description: 'Ship to 5% first',
          preview: `const key = "${stripeLive(SK_BODY_1)}";`,
          meta: { snippet: [`aws ${awsKey(AWS_BODY_1)}`] },
        },
      ],
      notes: { pasted: [`jwt ${jwt(JWT_PAYLOAD_1, JWT_SIG_1)}`], count: 3 },
    };

    const result = runRedactDecision(`${JSON.stringify(record)}\n`);

    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout) as Record<string, unknown>;
    for (const field of ['header', 'options', 'notes']) {
      expectNoSecret(out[field], field);
    }
    expect(out.header).toEqual({ title: 'Rollout', token: '[REDACTED]' });
    expect(out.options).toEqual([
      {
        label: 'Canary',
        description: 'Ship to 5% first',
        preview: expect.stringContaining('[REDACTED]'),
        meta: { snippet: ['aws [REDACTED]'] },
      },
    ]);
    expect(out.notes).toEqual({ pasted: ['jwt [REDACTED]'], count: 3 });
  });

  it('should redact a secret found in one field in every other field of the record too', async () => {
    // "Password: <letters>" is a secret alone on its line, but prose inside "..., Other" or before
    // " (Recommended)": the label, the choice, the typed answer and the recommended option all derive
    // from the same text, so a value caught in one of them must not survive in another.
    const runRedactDecision = await loadCli();
    const letters = 'Vexing' + 'Quark';
    const label = `Password: ${letters}`;
    const multi = {
      ...baseRecord(),
      options: [{ label, description: 'x' }, { label: 'Other', description: 'y' }],
      recommended: null,
      choice: [label, 'Other'],
      answerText: `${label}, Other`,
    };
    const single = {
      ...baseRecord(),
      options: [{ label: `${label} (Recommended)`, description: 'x' }],
      recommended: label,
      choice: `${label} (Recommended)`,
      answerText: `${label} (Recommended)`,
    };

    const result = runRedactDecision(`${JSON.stringify(multi)}\n${JSON.stringify(single)}\n`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout, 'the secret must not survive in any field').not.toContain(letters);
    const [first, second] = result.stdout.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(first.answerText).toBe('Password: [REDACTED], Other');
    expect(second.choice).toBe('Password: [REDACTED] (Recommended)');
  });

  it("should redact a label's secret in every field when it is glued to a header value", async () => {
    // "Authorization: Basic <token>;password: <letters>" — the letters are a secret where they end the label,
    // and prose inside "..., Other" or before " (Recommended)". The value removed from one field must be
    // removed from the others exactly, however the surrounding text is cut.
    const runRedactDecision = await loadCli();
    const letters = 'Vexing' + 'Quark';
    const token = 'ZnWoz2XR' + 'G493o';
    for (const glue of [';password: ', ',password: ']) {
      const label = `Authorization: Basic ${token}${glue}${letters}`;
      const multi = {
        ...baseRecord(),
        options: [{ label, description: 'x' }, { label: 'Other', description: 'y' }],
        recommended: null,
        choice: [label, 'Other'],
        answerText: `${label}, Other`,
      };
      const single = {
        ...baseRecord(),
        options: [{ label: `${label} (Recommended)`, description: 'x' }],
        recommended: label,
        choice: `${label} (Recommended)`,
        answerText: `${label} (Recommended)`,
      };

      const result = runRedactDecision(`${JSON.stringify(multi)}\n${JSON.stringify(single)}\n`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout, `${glue}: the letters must not survive in any field`).not.toContain(letters);
      expect(result.stdout, `${glue}: the token must not survive in any field`).not.toContain(token);
    }
  });

  it('should never keep text the patterns alone would redact', async () => {
    // Removing a value another field matched before running the patterns can eat the key a pattern needs
    // ("<jwt>.secret" taken whole leaves "token=[REDACTED]=<value>"), so the record would keep a value the
    // patterns alone remove. Whatever the plain pattern list removes from a field must be gone from it.
    const runRedactDecision = await loadCli();
    const shortJwt = `ey${'J'}abcdefghij.ey${'J'}abcdefghij.abcdefghij`;
    const slackBot = `xo${'xb-'}1234567890-AbcdEfGhIjKl`;
    const long = 'QwErTyUiOp' + 'AsDfGhJkLz' + 'XcVbNmPl';
    const mid = 'QwErTyUiOp' + 'AsDfGhJkLz' + 'XcVb';
    const short = 'QwEr' + 'TyUi';
    const shapes: Array<[string, string]> = [
      [`?token=${shortJwt}.secret=${long}&mode=1`, long],
      [`secret=${slackBot}password=${mid}&mode=1`, mid],
      [`Bearer ${short}&token=Bearer x`, short],
    ];
    for (const [text, value] of shapes) {
      expect(redactString(cleanText(text)), 'the patterns alone remove the value').not.toContain(value);
      const fields: Array<[string, Record<string, unknown>]> = [
        ['question', { ...baseRecord(), question: text }],
        ['label', { ...baseRecord(), options: [{ label: text, description: 'x' }, { label: 'Other', description: 'y' }] }],
        ['answerText', { ...baseRecord(), answerText: text }],
      ];
      for (const [field, record] of fields) {
        const result = runRedactDecision(`${JSON.stringify(record)}\n`);
        expect(result.exitCode).toBe(0);
        expect(result.stdout, `${field} must not keep ${value.slice(0, 4)}... from ${text.slice(0, 8)}...`).not.toContain(value);
      }
    }
  });

  it('the watcher pattern list should redact every sample the API redaction test redacts', () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'api-secret-samples.json'), 'utf-8'),
    ) as SampleFixture;
    expect(fixture.samples.length, 'fixture must hold the API samples').toBeGreaterThan(90);

    const leaks: string[] = [];
    for (const { source, parts, fragments, clean } of fixture.samples) {
      const text = parts.join('');
      // The API strips invisible characters (cleanText) before it redacts; the CLI does the same.
      const out = redactString(clean === true ? cleanText(text) : text);
      if (!out.includes('[REDACTED]') || fragments.some((fragment) => out.includes(fragment))) {
        leaks.push(`${source}\n    in:  ${JSON.stringify(text.slice(0, 60))}\n    out: ${JSON.stringify(out.slice(0, 60))}`);
      }
    }
    expect(leaks, `samples the watcher list let through:\n${leaks.join('\n')}`).toEqual([]);
  });

  it('should leave ordinary text unchanged', async () => {
    // Deliberately kept: prose that only mentions secret words or looks a little like a key.
    // (The plugin's original list still redacts "Bearer <word>", "TOKEN=<value>" and long sk- words;
    // that stricter behaviour is kept on purpose and is not tested here as "ordinary".)
    const runRedactDecision = await loadCli();
    const record = {
      ...baseRecord(),
      question: 'Use the token bucket approach for rate limiting?',
      header: 'Build the password reset flow first',
      options: [
        { label: 'Password: see vault', description: 'Token: we rotate it weekly' },
        { label: 'Basic Authentication is enabled on staging', description: 'Rotate keys every 90 days' },
      ],
      recommended: 'max_token: 4096',
      choice: ['bypass=enabled', 'The -----BEGIN CERTIFICATE----- line is public'],
      answerText: 'GitHub tokens start with ghp_ and are 40 characters long',
      notes: 'Choice A: ship it on 2026-10-28 with 3 reviewers',
    };

    const result = runRedactDecision(`${JSON.stringify(record)}\n`);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(record);
  });

  it('should pass non-text fields through unchanged and keep one valid JSON object per input line', async () => {
    const runRedactDecision = await loadCli();
    const first = { ...baseRecord(), notes: `token ${ghToken(GH_BODY_1)}` };
    const second = { ...baseRecord(), id: 'second-id', answerIndex: 2, session: 'session-5678', person: { status: 'verified', login: 'octocat-test' } };
    const third = { ...baseRecord(), id: 'third-id', recommended: null, choice: ['Canary', 'Big bang'] };
    // Blank lines (an empty line between records, an extra trailing newline) are not records.
    const input = `${JSON.stringify(first)}\n\n${JSON.stringify(second)}\n${JSON.stringify(third)}\n\n`;

    const result = runRedactDecision(input);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.endsWith('\n')).toBe(true);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    const records = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const [index, original] of [first, second, third].entries()) {
      for (const field of ['v', 'id', 'feature', 'questionKey', 'answerIndex', 'kind', 'command', 'answeredAt', 'person', 'session']) {
        expect(records[index][field], `${field} of record ${index}`).toEqual((original as Record<string, unknown>)[field]);
      }
    }
    expect(records[0].notes).toBe('token [REDACTED]');
    expect(records[2]).toEqual(third);
  });

  it('should exit non-zero and print nothing on stdout when a line is not JSON', async () => {
    // The hook fails closed: a half-written output could carry an unredacted or truncated record.
    const runRedactDecision = await loadCli();
    const good = { ...baseRecord(), notes: `token ${ghToken(GH_BODY_1)}` };
    const input = `${JSON.stringify(good)}\nnot json ${ghToken(GH_BODY_2)}\n${JSON.stringify(baseRecord())}\n`;

    const result = runRedactDecision(input);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('redact-decision');
    expect(result.stderr, 'the error must not echo the bad line').not.toContain(GH_BODY_2);
  });
});
