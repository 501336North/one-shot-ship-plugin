/**
 * Plan result assembler (R-257 T5, AC-003.2).
 *
 * Reads the model's task list from the `tasks.json` value file and returns the plan result. Task ids must be unique
 * and each task needs at least one test id. Model text is redacted; the CLI validates the result against the schema.
 */
import { readValueFile } from './store.js';
import { baseFields, redactModelText, type AssembleContext, type AssembleOutcome } from './assemble-common.js';

interface TaskInput {
  id?: unknown;
  title?: unknown;
  testIds?: unknown;
}

function redactIfString(v: unknown): unknown {
  return typeof v === 'string' ? redactModelText(v) : v;
}

export function assemblePlan(ctx: AssembleContext): AssembleOutcome {
  const raw = ctx.valueDir === null ? null : readValueFile(ctx.valueDir, 'tasks.json');
  let parsed: unknown;
  try {
    parsed = raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) return { ok: false, error: 'no_tasks' };

  const seen = new Set<unknown>();
  const tasks: Record<string, unknown>[] = [];
  for (const item of parsed as TaskInput[]) {
    const { id, title, testIds } = item ?? {};
    if (seen.has(id)) return { ok: false, error: 'duplicate_task', detail: String(id) };
    seen.add(id);
    if (!Array.isArray(testIds) || testIds.length === 0) {
      return { ok: false, error: 'task_without_test', detail: String(id) };
    }
    tasks.push({ id, title: redactIfString(title), testIds: testIds.map(redactIfString) });
  }

  return {
    ok: true,
    result: { ...baseFields(ctx, 'plan'), sources: { tasks: 'model' }, tasks },
  };
}
