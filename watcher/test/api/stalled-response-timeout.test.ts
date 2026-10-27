/**
 * The OSS API senders give up on a response whose body stalls.
 *
 * @behavior When the OSS API answers 200 with headers and part of a JSON body and then goes silent,
 *           the watcher's LLM analyzer, custom-command fetch and workflow-config fetch still settle
 *           (null / an error) soon after their timeout, instead of hanging the watcher.
 * @business-rule A request timeout must cover the whole response, body included, and must hold under
 *           garbage collection. Measured (Node 25): with redirect: 'error' and GC running, aborting
 *           the fetch's signal does not end a stalled body read (AbortSignal.timeout or an
 *           AbortController alike), so the read hangs until the server closes the socket.
 * @boundary A real local HTTP server and the real fetch. Garbage collection is forced in a loop to
 *           make the collection that happens in a long-running watcher happen inside the test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as v8 from 'v8';
import * as vm from 'vm';
import type { AddressInfo } from 'net';
import { LLMAnalyzer } from '../../src/detectors/llm-analyzer.js';
import { CustomCommandExecutor } from '../../src/engine/custom-command-executor.js';
import { fetchWorkflowConfig } from '../../src/api/workflow-config.js';
import type { QueueManager } from '../../src/queue/manager.js';
import type { RuleEngine } from '../../src/detectors/rules.js';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

const TIMEOUT_MS = 300;
const SETTLE_BY_MS = 2_000;
const HUNG = Symbol('hung');

let server: http.Server;
let configDir: string;
let savedConfigDir: string | undefined;
let gcLoop: NodeJS.Timeout;

/** Settles with the call's outcome, or HUNG if it has not settled by SETTLE_BY_MS. */
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

beforeEach(async () => {
  // 200, headers, part of a JSON body, then silence
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"anomaly_detected": tr');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  savedConfigDir = process.env.OSS_CONFIG_DIR;
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-stall-')); // 0700
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ apiKey: 'k', apiUrl: `http://127.0.0.1:${port}` }),
    { mode: 0o600 }
  );
  process.env.OSS_CONFIG_DIR = configDir;
  gcLoop = setInterval(gc, Number(process.env.GCI));
});

afterEach(async () => {
  clearInterval(gcLoop);
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (savedConfigDir === undefined) delete process.env.OSS_CONFIG_DIR;
  else process.env.OSS_CONFIG_DIR = savedConfigDir;
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe('a stalled response body does not hang the watcher (SR10)', () => {
  it('LLM analyzer: settles with no result soon after its timeout', async () => {
    const analyzer = new LLMAnalyzer(
      { addTask: vi.fn() } as unknown as QueueManager,
      { analyze: () => null } as unknown as RuleEngine,
      0.7,
      TIMEOUT_MS
    );

    expect(await settleWithin(analyzer.analyze('some log line'))).toBeNull();
  });

  it('custom command fetch: fails soon after its timeout', async () => {
    const outcome = await settleWithin(new CustomCommandExecutor().fetchCustomCommand('review', TIMEOUT_MS));

    expect(outcome).toBeInstanceOf(Error);
  });

  it('workflow config fetch: fails with a timeout soon after its timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outcome = await settleWithin(fetchWorkflowConfig('build', TIMEOUT_MS));

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).name).toBe('TimeoutError');
  });
});
