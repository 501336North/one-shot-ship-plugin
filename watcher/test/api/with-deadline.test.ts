/**
 * The OSS API deadline settles on its own, whatever the request does with its signal.
 *
 * @behavior A watcher request to the OSS API ends with a TimeoutError at its deadline, even when the
 *           request (headers or body read) never looks at the abort signal it was handed.
 * @business-rule A request timeout must not depend on fetch honouring an abort: on some Node versions,
 *           under garbage collection, an aborted stalled body read never settles (SR10, TR1). The
 *           deadline therefore rejects by itself, and every OSS API sender in the watcher runs its
 *           whole request, body read included, under that deadline.
 * @boundary The request function and the global fetch are replaced by fakes that ignore the signal,
 *           so the guard holds the same way on every Node version (no GC timing involved).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withDeadline } from '../../src/api/with-deadline.js';
import { LLMAnalyzer } from '../../src/detectors/llm-analyzer.js';
import { CustomCommandExecutor } from '../../src/engine/custom-command-executor.js';
import { fetchWorkflowConfig } from '../../src/api/workflow-config.js';
import type { QueueManager } from '../../src/queue/manager.js';
import type { RuleEngine } from '../../src/detectors/rules.js';

const TIMEOUT_MS = 50;
const SETTLE_BY_MS = 1_000;
const HUNG = Symbol('hung');

/** Settles with the call's outcome (a rejection becomes its error), or HUNG if not settled by SETTLE_BY_MS. */
async function settleWithin<T>(call: Promise<T>): Promise<T | Error | typeof HUNG> {
  let timer: NodeJS.Timeout | undefined;
  const hung = new Promise<typeof HUNG>((resolve) => {
    timer = setTimeout(() => resolve(HUNG), SETTLE_BY_MS);
  });
  try {
    return await Promise.race([call.catch((error: Error) => error), hung]);
  } finally {
    clearTimeout(timer);
  }
}

/** A promise that never settles, like a stalled request that ignores its abort signal. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

describe('withDeadline settles on its own at the deadline (TR1)', () => {
  it('rejects with a TimeoutError when the request ignores its signal and never settles', async () => {
    const outcome = await settleWithin(withDeadline(TIMEOUT_MS, () => never<string>()));

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).name).toBe('TimeoutError');
  });

  it('also aborts the signal it handed to the request, so a cooperating fetch can free its connection', async () => {
    let seen: AbortSignal | undefined;
    await settleWithin(
      withDeadline(TIMEOUT_MS, (signal) => {
        seen = signal;
        return never<string>();
      })
    );

    expect(seen?.aborted).toBe(true);
  });

  it('returns the request result when it finishes before the deadline', async () => {
    expect(await withDeadline(TIMEOUT_MS, async () => 'answer')).toBe('answer');
  });
});

describe('every OSS API sender in the watcher runs under the deadline, body read included (TR1)', () => {
  let configDir: string;
  let savedConfigDir: string | undefined;

  beforeEach(() => {
    savedConfigDir = process.env.OSS_CONFIG_DIR;
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-deadline-')); // 0700
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({ apiKey: 'k', apiUrl: 'http://127.0.0.1:9' }),
      { mode: 0o600 }
    );
    process.env.OSS_CONFIG_DIR = configDir;
    // headers arrive, then the body never does; the signal is ignored throughout
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: () => never<unknown>() }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (savedConfigDir === undefined) delete process.env.OSS_CONFIG_DIR;
    else process.env.OSS_CONFIG_DIR = savedConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('LLM analyzer: gives up with no result', async () => {
    const analyzer = new LLMAnalyzer(
      { addTask: vi.fn() } as unknown as QueueManager,
      { analyze: () => null } as unknown as RuleEngine,
      0.7,
      TIMEOUT_MS
    );

    expect(await settleWithin(analyzer.analyze('some log line'))).toBeNull();
  });

  it('custom command fetch: fails with a TimeoutError', async () => {
    const outcome = await settleWithin(new CustomCommandExecutor().fetchCustomCommand('review', TIMEOUT_MS));

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).name).toBe('TimeoutError');
  });

  it('workflow config fetch: fails with a TimeoutError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await settleWithin(fetchWorkflowConfig('build', TIMEOUT_MS));

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).name).toBe('TimeoutError');
  });
});
