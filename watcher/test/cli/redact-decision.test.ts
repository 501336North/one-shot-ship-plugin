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

type RunRedactDecision = (input: string, args?: string[]) => RedactResult;

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
    const zeroWidthSplit = `ak_${AK_BODY}`.slice(0, 10) + '\u200B' + `ak_${AK_BODY}`.slice(10);
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

  // Special characters are built from code points so the source holds no invisible or unpaired character.
  const ch = (codePoint: number): string => String.fromCodePoint(codePoint);
  const questionOut = (runRedactDecision: RunRedactDecision, question: string): string => {
    const result = runRedactDecision(`${JSON.stringify({ ...baseRecord(), question })}\n`);
    expect(result.exitCode).toBe(0);
    return (JSON.parse(result.stdout) as { question: string }).question;
  };

  it.each([
    { name: 'U+200B zero-width space', codePoint: 0x200b },
    { name: 'U+0001 control character', codePoint: 0x0001 },
  ])('should redact a GitHub token split by two unpaired surrogate halves around a $name', async ({ codePoint }) => {
    // A high half, a stripped character and a low half: stripping the middle alone would join the halves into
    // U+E0020 (an invisible tag) after the strip had passed, and the tag would split the token. The halves are
    // deleted first, so nothing is left between the two parts of the token.
    const runRedactDecision = await loadCli();
    const token = ghToken(GH_BODY_1);
    const injected = `${token.slice(0, 10)}${ch(0xdb40)}${ch(codePoint)}${ch(0xdc20)}${token.slice(10)}`;

    const out = questionOut(runRedactDecision, `rotate ${injected} now`);

    expect(out).toBe('rotate [REDACTED] now');
    expect(out, 'no U+E0020 tag may be formed').not.toContain(ch(0xe0020));
    expect(out, 'no replacement character may be left').not.toContain(ch(0xfffd));
  });

  it('should remove an unpaired surrogate half that stands on its own', async () => {
    const runRedactDecision = await loadCli();

    expect(questionOut(runRedactDecision, `a${ch(0xd800)}b c${ch(0xdc00)}d`)).toBe('ab cd');
  });

  it('should keep a real surrogate pair such as an emoji untouched', async () => {
    const runRedactDecision = await loadCli();
    const question = `Ship it ${ch(0x1f600)} today?`;

    expect(questionOut(runRedactDecision, question)).toBe(question);
  });

  const HANGUL_FILLERS = [
    { name: 'U+115F Hangul choseong filler', codePoint: 0x115f },
    { name: 'U+1160 Hangul jungseong filler', codePoint: 0x1160 },
    { name: 'U+3164 Hangul filler', codePoint: 0x3164 },
    { name: 'U+FFA0 halfwidth Hangul filler', codePoint: 0xffa0 },
  ];

  it.each(HANGUL_FILLERS)('should redact an sk- key glued to a word by $name, and leave no filler behind', async ({ codePoint }) => {
    // The filler looks like a space: deleting it first would glue "word" onto the key.
    const runRedactDecision = await loadCli();

    const out = questionOut(runRedactDecision, `word${ch(codePoint)}sk-${SK_BODY_1}`);

    expect(out).toBe('word[REDACTED]');
    expect(out).not.toContain(SK_BODY_1.slice(-8));
  });

  it.each(HANGUL_FILLERS)('should redact a pass= value that $name separates from "by", and leave no filler behind', async ({ codePoint }) => {
    // Deleting the filler first would read "bypass=", a word the key-name rule refuses on purpose.
    const runRedactDecision = await loadCli();
    const value = 'Hx7Vq2' + 'Lm9Rt4';

    const out = questionOut(runRedactDecision, `by${ch(codePoint)}pass=${value}`);

    expect(out).toBe('bypass=[REDACTED]');
    expect(out).not.toContain(value);
  });

  it('should redact the shortest assigned value (6 characters) that a Hangul filler separates from "by"', async () => {
    const runRedactDecision = await loadCli();

    const out = questionOut(runRedactDecision, `by${ch(0x3164)}pass=${'abc' + '123'}`);

    expect(out).toBe('bypass=[REDACTED]');
  });

  it.each(HANGUL_FILLERS)('should redact the whole of a long sk- key that $name splits after its first 24 characters', async ({ codePoint }) => {
    // Redacting with the filler kept would stop the key at the filler and leave the tail readable.
    const runRedactDecision = await loadCli();
    const tail = 'TAIL' + '9xyz';

    const out = questionOut(runRedactDecision, `x sk-${SK_BODY_1}${ch(codePoint)}${tail} end`);

    expect(out).not.toContain(tail);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain(ch(codePoint));
  });
});

/**
 * --push-body mode: one committed record line in, the POST /api/v1/decisions JSON body out.
 *
 * @behavior The push hook hands one committed decision line to the CLI and sends whatever it prints;
 *           the body holds only the fields the API's schema accepts, sized to its limits.
 * @business-rule A 400 is never retried, so every body the CLI prints must fit the API schema
 *                (packages/api/src/routes/decisions.ts); identity fields (person, session) never leave.
 */
describe('redact-decision CLI --push-body', () => {
  const PUSH = ['--push-body'];

  async function pushBody(record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const runRedactDecision = await loadCli();
    const result = runRedactDecision(`${JSON.stringify(record)}\n`, PUSH);
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout) as Record<string, unknown>;
  }

  it('should send only the fields the API accepts', async () => {
    const body = await pushBody({
      ...baseRecord(),
      answerText: 'Canary',
      options: [
        { label: 'Canary', description: 'Ship to 5% first', preview: 'deploy --canary' },
        { label: 'Big bang', description: 'Ship to everyone' },
      ],
    });

    expect(Object.keys(body).sort()).toEqual(
      ['answerIndex', 'answeredAt', 'choice', 'command', 'feature', 'header', 'id', 'kind', 'notes', 'options', 'question', 'questionKey', 'recommended'],
    );
    expect(body.options).toEqual([
      { label: 'Canary', description: 'Ship to 5% first' },
      { label: 'Big bang', description: 'Ship to everyone' },
    ]);
    expect(body.id).toBe('7f0c1e2a-3b4c-4d5e-8f90-a1b2c3d4e5f6');
    expect(body.answeredAt).toBe('2026-10-28T12:00:00.000Z');
  });

  // A run of prose (not one repeated letter, which a key pattern could match) cut to n units, then an
  // emoji (a surrogate pair) placed so the cap falls between its two halves.
  const straddle = (cap: number): string => `${'word '.repeat(Math.ceil(cap / 5)).slice(0, cap - 1)}\u{1F600}tail`;
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('should cap question and notes at 2000 and labels, descriptions, header, recommended and each choice at 200 UTF-16 units, without splitting a surrogate pair', async () => {
    const body = await pushBody({
      ...baseRecord(),
      question: straddle(2000),
      notes: straddle(2000),
      header: straddle(200),
      recommended: straddle(200),
      options: [{ label: straddle(200), description: straddle(200) }],
      choice: [straddle(200), 'Canary'],
    });

    const options = body.options as Array<{ label: string; description: string }>;
    const capped: Array<[string, string, number]> = [
      ['question', body.question as string, 2000],
      ['notes', body.notes as string, 2000],
      ['header', body.header as string, 200],
      ['recommended', body.recommended as string, 200],
      ['label', options[0].label, 200],
      ['description', options[0].description, 200],
      ['choice[0]', (body.choice as string[])[0], 200],
    ];
    for (const [field, value, cap] of capped) {
      expect(value.length, `${field} length`).toBeLessThanOrEqual(cap);
      expect(value.length, `${field} keeps the text up to the cut`).toBe(cap - 1);
      expect(LONE_SURROGATE.test(value), `${field} must not end in half an emoji`).toBe(false);
    }
    expect((body.choice as string[])[1]).toBe('Canary');
  });


  it('should send at most 20 options and 20 choices', async () => {
    const labels = Array.from({ length: 25 }, (_, index) => `Option ${index + 1}`);
    const body = await pushBody({
      ...baseRecord(),
      options: labels.map((label) => ({ label, description: `About ${label}` })),
      choice: labels,
    });

    expect(body.options).toEqual(labels.slice(0, 20).map((label) => ({ label, description: `About ${label}` })));
    expect(body.choice).toEqual(labels.slice(0, 20));
  });


  it('should send a single-select choice as a one-item list', async () => {
    // The committed line keeps a single-select answer as a string; the API takes a list for every answer.
    const body = await pushBody({ ...baseRecord(), choice: 'Canary' });

    expect(body.choice).toEqual(['Canary']);
  });


  it('should leave out header and recommended when they are null', async () => {
    // The API's header and recommended are optional, not nullable: a null there is a 400. Notes may be null.
    const body = await pushBody({ ...baseRecord(), header: null, recommended: null, notes: null });

    expect(body).not.toHaveProperty('header');
    expect(body).not.toHaveProperty('recommended');
    expect(body.notes).toBeNull();
  });


  it('should print no body for a record with no feature', async () => {
    // The API requires a feature. Contract with the bash caller: exit 0 and EMPTY stdout means
    // "not pushable, keep the record local" — never a body the API would refuse with a 400.
    const runRedactDecision = await loadCli();
    for (const feature of [null, '']) {
      const result = runRedactDecision(`${JSON.stringify({ ...baseRecord(), feature })}\n`, PUSH);

      expect(result.exitCode, `feature ${JSON.stringify(feature)}`).toBe(0);
      expect(result.stdout, `feature ${JSON.stringify(feature)}`).toBe('');
      expect(result.stderr, `feature ${JSON.stringify(feature)}`).toBe('');
    }
  });


  it('should redact the body again', async () => {
    // The committed line was redacted when it was written, but the secret list grows: a line committed
    // before a pattern existed is scrubbed again on its way to the server.
    const body = await pushBody({ ...baseRecord(), question: `Rotate ${ghToken(GH_BODY_1)} now?` });

    expect(body.question).toBe('Rotate [REDACTED] now?');
  });


  it('should redact the whole record before capping, so a secret cut at the limit leaves nothing behind', async () => {
    // Capping first would keep "ghp_" plus the first chars of the token: too short for any pattern,
    // so that prefix would reach the server. Redacting first replaces the whole token before the cut.
    const runRedactDecision = await loadCli();
    const prefix = 'word '.repeat(398); // 1990 units: the 40-unit token straddles the 2000 cut
    const record = { ...baseRecord(), question: `${prefix}${ghToken(GH_BODY_1)}`, notes: `${prefix}${ghToken(GH_BODY_2)}` };

    const result = runRedactDecision(`${JSON.stringify(record)}\n`, PUSH);

    expect(result.exitCode).toBe(0);
    for (const fragment of [GH_BODY_1.slice(0, 6), GH_BODY_2.slice(0, 6), 'ghp_']) {
      expect(result.stdout, `no part of the token (${fragment.slice(0, 3)}...) may reach the body`).not.toContain(fragment);
    }
    const body = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(body.question).toBe(`${prefix}[REDACTED]`);
  });


  it('should exit non-zero and print nothing on stdout when the line is not JSON', async () => {
    // Same rule as the default mode: the caller sends nothing, and the error never quotes the line.
    const runRedactDecision = await loadCli();

    const result = runRedactDecision(`{"question": "token ${ghToken(GH_BODY_2)}"\n`, PUSH);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('redact-decision');
    expect(result.stderr, 'the error must not echo the bad line').not.toContain(GH_BODY_2);
    expect(result.stderr, 'the error must not echo the bad line').not.toContain('question');
  });


  it('should send an option whose description is null, without a description', async () => {
    // The API's description is optional, not nullable: a null is the same as no description.
    const body = await pushBody({
      ...baseRecord(),
      options: [{ label: 'Canary', description: null }, { label: 'Big bang', description: 'Ship to everyone' }],
    });

    expect(body.options).toEqual([{ label: 'Canary' }, { label: 'Big bang', description: 'Ship to everyone' }]);
  });


  it('should exit 2 and print nothing on stdout when the line is JSON but a field has the wrong type', async () => {
    // Exit 1 means "unreadable"; exit 2 means "readable but never sendable", so the caller can mark
    // the record refused instead of retrying a body the API would refuse with a 400 forever.
    const runRedactDecision = await loadCli();
    const wrongShapes: Array<[string, Record<string, unknown>]> = [
      ['question is a number', { question: 5 }],
      ['question is a list', { question: ['Which rollout approach?'] }],
      ['options is not a list', { options: 'Canary' }],
      ['an option label is a number', { options: [{ label: 7 }] }],
      ['an option is not an object', { options: ['Canary'] }],
      ['an option description is a number', { options: [{ label: 'Canary', description: 3 }] }],
      ['a choice is a number', { choice: ['Canary', 2] }],
      ['choice is an object', { choice: { label: 'Canary' } }],
      ['header is a number', { header: 9 }],
      ['recommended is a list', { recommended: ['Canary'] }],
      ['notes is a number', { notes: 4 }],
    ];

    for (const [label, change] of wrongShapes) {
      const result = runRedactDecision(`${JSON.stringify({ ...baseRecord(), ...change })}\n`, PUSH);

      expect(result.exitCode, label).toBe(2);
      expect(result.stdout, label).toBe('');
      expect(result.stderr, label).not.toContain('not valid JSON');
    }
  });


  it('should exit 2 and print nothing on stdout when a metadata field breaks the API rules', async () => {
    // A committed line can be hand-edited: every metadata field is checked against the API schema here,
    // so a line the API would refuse with a 400 is refused locally instead of being retried.
    const runRedactDecision = await loadCli();
    const badFields: Array<[string, Record<string, unknown>]> = [
      ['id in upper case', { id: '7F0C1E2A-3B4C-4D5E-8F90-A1B2C3D4E5F6' }],
      ['id not version 4', { id: '7f0c1e2a-3b4c-1d5e-8f90-a1b2c3d4e5f6' }],
      ['id with a bad variant', { id: '7f0c1e2a-3b4c-4d5e-7f90-a1b2c3d4e5f6' }],
      ['id with text around it', { id: ' 7f0c1e2a-3b4c-4d5e-8f90-a1b2c3d4e5f6' }],
      ['id is a number', { id: 5 }],
      ['id is missing', { id: undefined }],
      ['feature starts with a dot', { feature: '.hidden' }],
      ['feature has a slash', { feature: 'demo/../x' }],
      ['feature has a space', { feature: 'demo x' }],
      ['feature is 129 characters', { feature: 'f'.repeat(129) }],
      ['feature is a number', { feature: 5 }],
      ['feature is missing', { feature: undefined }],
      ['questionKey in upper case', { questionKey: 'A1B2C3D4E5F60718' }],
      ['questionKey is 15 hex', { questionKey: 'a1b2c3d4e5f6071' }],
      ['questionKey is not hex', { questionKey: 'g1b2c3d4e5f60718' }],
      ['questionKey is a number', { questionKey: 1234567890123456 }],
      ['answerIndex is 0', { answerIndex: 0 }],
      ['answerIndex is 101', { answerIndex: 101 }],
      ['answerIndex is not whole', { answerIndex: 1.5 }],
      ['answerIndex is text', { answerIndex: '1' }],
      ['kind is not one of risk, scope, design', { kind: 'other' }],
      ['kind is missing', { kind: undefined }],
      ['command has a capital', { command: 'Build' }],
      ['command starts with a dash', { command: '-build' }],
      ['command has a shell character', { command: 'build;rm' }],
      ['command is 65 characters', { command: `b${'a'.repeat(64)}` }],
      ['command is a number', { command: 7 }],
      ['answeredAt has no seconds', { answeredAt: '2026-10-28T12:00Z' }],
      ['answeredAt has an offset', { answeredAt: '2026-10-28T12:00:00+01:00' }],
      ['answeredAt is not a calendar day', { answeredAt: '2026-02-30T12:00:00Z' }],
      ['answeredAt has a 13th month', { answeredAt: '2026-13-01T12:00:00Z' }],
      ['answeredAt is before 2020', { answeredAt: '2019-12-31T23:59:59.999Z' }],
      ['answeredAt is not a date', { answeredAt: 'yesterday' }],
      ['answeredAt is a number', { answeredAt: 1761652800000 }],
    ];

    for (const [label, change] of badFields) {
      const result = runRedactDecision(`${JSON.stringify({ ...baseRecord(), ...change })}\n`, PUSH);

      expect(result.exitCode, label).toBe(2);
      expect(result.stdout, label).toBe('');
    }
  });


  it('should send metadata at the edges of the API rules', async () => {
    const edges = {
      feature: `A.b_c-${'9'.repeat(122)}`,
      questionKey: 'ffffffffffffffff',
      answerIndex: 100,
      command: `oss-${'z'.repeat(60)}`,
      answeredAt: '2020-01-01T00:00:00Z',
    };

    const body = await pushBody({ ...baseRecord(), ...edges });

    expect(body).toMatchObject(edges);
  });


  it('should send an answer stamped two days ahead by a fast clock, keeping the stamp as given', async () => {
    // The user chose server time: the API clamps a future answeredAt to its receive time, so a machine
    // whose clock runs fast must still push its answers instead of having them refused for good.
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    const body = await pushBody({ ...baseRecord(), answeredAt: inTwoDays });

    expect(body.answeredAt).toBe(inTwoDays);
  });


  it('should send a record answered outside any workflow command, whose command is empty', async () => {
    // The hook records command "" when no /oss command is running, and the API accepts an empty command.
    const body = await pushBody({ ...baseRecord(), command: '' });

    expect(body.command).toBe('');
  });

});
