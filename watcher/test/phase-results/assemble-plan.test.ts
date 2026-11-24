/**
 * @behavior When a plan phase ends, the plugin builds the plan result from the task list the model wrote to a value
 *           file (`tasks.json`), so the plan's tasks and their test ids are recorded in a checked, schema-valid form.
 * @business-rule R-257 AC-003.2: every task has a unique id and at least one test id. AC-002.1: model text is tagged
 *                `sources.tasks = "model"`. AC-002.3: assembling twice gives the same result apart from assembledAt.
 *                Model text is redacted, and control characters are refused by the schema.
 * @boundary watcher/src/phase-results/assemble-plan.ts, assemble-common.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { assemblePlan } from '../../src/phase-results/assemble-plan.js';
import type { AssembleContext, AssembleOutcome } from '../../src/phase-results/assemble-common.js';
import { loadPhaseSchema } from '../../src/phase-results/schemas.js';
import { validate } from '../../src/phase-results/validate.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '../../..');
const FAKE_KEY = 'sk-ant-api03-' + 'Ab1'.repeat(30);

let valueDir: string;

beforeEach(() => {
  valueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assemble-plan-'));
});
afterEach(() => {
  fs.rmSync(valueDir, { recursive: true, force: true });
});

function ctx(now = new Date('2026-11-13T10:00:00.000Z')): AssembleContext {
  return {
    repo: '/repo',
    feature: 'phase-results',
    startedAt: '2026-11-13T09:00:00Z',
    headSha: 'a'.repeat(40),
    valueDir,
    now: () => now,
  };
}

function writeTasks(tasks: unknown): void {
  fs.writeFileSync(path.join(valueDir, 'tasks.json'), JSON.stringify(tasks));
}

function result(o: AssembleOutcome): Record<string, unknown> {
  if (!o.ok) throw new Error(`expected ok, got ${o.error}`);
  return o.result;
}

const VALID = [
  { id: 'T1', title: 'Validator', testIds: ['validate.test.ts'] },
  { id: 'T2', title: 'Store', testIds: ['store.test.ts', 'store.extra.test.ts'] },
];

describe('assemblePlan', () => {
  // User sees their plan's tasks recorded as model-sourced text, in a result the plan schema accepts.
  it('builds a schema-valid plan result from a valid tasks.json', () => {
    writeTasks(VALID);
    const r = result(assemblePlan(ctx()));
    expect(r.tasks).toEqual(VALID);
    expect(r.sources).toEqual({ tasks: 'model' });
    expect(r.phase).toBe('plan');
    expect(validate(loadPhaseSchema('plan', PLUGIN_ROOT), r)).toEqual({ ok: true });
  });

  // Rule: task ids are unique; a repeated id stops the plan with duplicate_task naming the id.
  it('fails with duplicate_task when two tasks share an id', () => {
    writeTasks([VALID[0], { ...VALID[1], id: 'T1' }]);
    expect(assemblePlan(ctx())).toEqual({ ok: false, error: 'duplicate_task', detail: 'T1' });
  });

  // Rule: every task has at least one test id (TDD); a task with none stops the plan with task_without_test.
  it('fails with task_without_test when a task has no test id', () => {
    writeTasks([VALID[0], { id: 'T2', title: 'Store', testIds: [] }]);
    expect(assemblePlan(ctx())).toEqual({ ok: false, error: 'task_without_test', detail: 'T2' });
  });

  // Rule: no task file means no plan result.
  it('fails with no_tasks when tasks.json is missing', () => {
    expect(assemblePlan(ctx())).toEqual({ ok: false, error: 'no_tasks' });
  });

  // Rule: a task file older than 10 minutes is from an earlier run and is ignored.
  it('fails with no_tasks when tasks.json is older than 10 minutes', () => {
    writeTasks(VALID);
    const old = new Date(Date.now() - 11 * 60 * 1000);
    fs.utimesSync(path.join(valueDir, 'tasks.json'), old, old);
    expect(assemblePlan(ctx())).toEqual({ ok: false, error: 'no_tasks' });
  });

  // Rule: a task file that is not a JSON array is not a task list.
  it('fails with no_tasks when tasks.json is not a JSON array', () => {
    writeTasks({ tasks: VALID });
    expect(assemblePlan(ctx())).toEqual({ ok: false, error: 'no_tasks' });
  });

  // Rule: secrets the model pastes into task text never reach the result file.
  it('redacts a planted API key in a title and a test id', () => {
    writeTasks([{ id: 'T1', title: `use ${FAKE_KEY}`, testIds: [`t ${FAKE_KEY}`] }]);
    const text = JSON.stringify(result(assemblePlan(ctx())));
    expect(text).not.toContain(FAKE_KEY);
    expect(text).toContain('[REDACTED]');
  });

  // Rule: terminal escape codes in model text are refused by the schema, so they cannot reach a reader's terminal.
  it('produces a result the schema refuses when a title carries an ANSI escape', () => {
    writeTasks([{ id: 'T1', title: '\u001b[31mred', testIds: ['a.test.ts'] }]);
    const r = result(assemblePlan(ctx()));
    expect(validate(loadPhaseSchema('plan', PLUGIN_ROOT), r).ok).toBe(false);
  });

  // Rule (AC-002.3): assembling unchanged inputs twice gives the same result apart from assembledAt.
  it('is deterministic apart from assembledAt', () => {
    writeTasks(VALID);
    const a = result(assemblePlan(ctx(new Date('2026-11-13T10:00:00.000Z'))));
    const b = result(assemblePlan(ctx(new Date('2026-11-13T10:05:00.000Z'))));
    expect(a.assembledAt).not.toBe(b.assembledAt);
    expect({ ...a, assembledAt: '' }).toEqual({ ...b, assembledAt: '' });
  });
});
