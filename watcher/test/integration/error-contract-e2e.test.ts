/**
 * @behavior End-to-end error contract: a real emitter emission travels through the
 *           real watcher pipeline (WorkflowLogger → LogReader → WorkflowAnalyzer →
 *           InterventionGenerator → QueueManager) and heals cheap retryable failures
 *           (auto_remediate task carrying the retry_hint, RECOVERY visibility line,
 *           status-line retry text), escalates expensive failures via the real
 *           TelegramNotifier (transport mocked at the fetch boundary) without any
 *           retry task, and surfaces hand-corrupted OSS_ERROR lines as OSS-WORKFLOW-901.
 * @acceptance-criteria DESIGN success criteria 1–3; validates the A3 collaborator
 *                      port design (RecoveryLogger/RetryStatusLine/EscalationNotifier)
 *                      against real implementations (London: integration validates mocks).
 * @business-rule US-004/US-005/US-006 — the healing loop works with real parts, not
 *                just against the mocks used in unit tests.
 * @boundary Emitter CLI (runOssError) + watcher supervisor pipeline + queue persistence.
 *           Mocked: ONLY the Telegram HTTP transport (global fetch).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runOssError } from '../../src/cli/oss-error';
import { WorkflowLogger } from '../../src/logger/workflow-logger';
import { LogReader } from '../../src/logger/log-reader';
import { WorkflowAnalyzer } from '../../src/analyzer/workflow-analyzer';
import { InterventionGenerator, Intervention } from '../../src/intervention/generator';
import { QueueManager } from '../../src/queue/manager';
import { StatusLineService } from '../../src/services/status-line';
import { TelegramNotifier } from '../../src/services/telegram-notifier';
import { Task, CreateTaskInput } from '../../src/types';

interface Sandbox {
  projectDir: string;
  ossDir: string;
  logPath: string;
}

const sandboxes: string[] = [];

function makeSandbox(): Sandbox {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'error-contract-e2e-'));
  sandboxes.push(projectDir);
  const ossDir = path.join(projectDir, '.oss');
  fs.mkdirSync(ossDir);
  return { projectDir, ossDir, logPath: path.join(ossDir, 'workflow.log') };
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (sandboxes.length > 0) {
    const dir = sandboxes.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

/** Env pinned into the sandbox — the real ~/.oss is never touched. */
function emitterEnv(sandbox: Sandbox): Record<string, string> {
  return { CLAUDE_PROJECT_DIR: sandbox.projectDir, HOME: sandbox.projectDir };
}

const RETRY_HINT =
  'Wait 5s then re-run: node watcher/dist/cli/get-copy.js --cmd build (network blip, endpoint healthy)';

/**
 * Run the real supervisor pipeline over the sandbox log and enqueue every
 * auto_remediate intervention into the real QueueManager, exactly as the
 * supervisor does (queue.json persisted on disk).
 */
async function runPipeline(
  sandbox: Sandbox,
  generator: InterventionGenerator,
): Promise<{ interventions: Intervention[]; queuedTasks: Task[] }> {
  const reader = new LogReader(sandbox.ossDir);
  const entries = await reader.readAll();
  const analysis = new WorkflowAnalyzer().analyze(entries, new Date());
  const interventions = analysis.issues.map((issue) => generator.generate(issue));

  const queueManager = new QueueManager(sandbox.ossDir);
  await queueManager.initialize();
  for (const intervention of interventions) {
    if (intervention.response_type === 'auto_remediate' && intervention.queue_task) {
      const taskInput: CreateTaskInput = {
        priority: 'high',
        source: 'log-monitor',
        anomaly_type: 'agent_error',
        prompt: intervention.queue_task.prompt,
        suggested_agent: intervention.queue_task.agent_type ?? 'debugger',
        context: { analysis: intervention.issue.message, confidence: intervention.issue.confidence },
      };
      await queueManager.addTask(taskInput);
    }
  }

  // Behavior assertion surface: what actually got persisted to queue.json
  const persisted = JSON.parse(
    fs.readFileSync(path.join(sandbox.ossDir, 'queue.json'), 'utf-8'),
  ) as { tasks: Task[] };
  return { interventions, queuedTasks: persisted.tasks };
}

describe('error contract end-to-end (Task 12)', () => {
  it('should heal a cheap retryable hook failure end-to-end: emit → log → analyze → auto_remediate task enqueued with retry_hint', async () => {
    // GIVEN — a real in-flight build log and a real cheap retryable emission
    const sandbox = makeSandbox();
    const workflowLogger = new WorkflowLogger(sandbox.ossDir);
    await workflowLogger.log({ cmd: 'build', event: 'START', data: { args: [] } });

    const emitted = await runOssError(
      [
        '--code', 'OSS-API-003',
        '--severity', 'HIGH',
        '--message', 'Prompt fetch failed: ECONNREFUSED one-shot-ship-api.onrender.com',
        '--source', 'hooks/ensure-decrypt-cli.sh',
        '--retry-eligible', 'true',
        '--retry-hint', RETRY_HINT,
        '--retry-cost', 'cheap',
        '--attempt', '0',
      ],
      emitterEnv(sandbox),
    );
    expect(emitted.exitCode, 'emitter must accept the valid emission').toBe(0);

    // GIVEN — the generator wired with REAL collaborator ports (A3 port design
    // validated against reality): WorkflowLogger as RecoveryLogger, real status line
    const statusLine = new StatusLineService(sandbox.ossDir);
    const generator = new InterventionGenerator({
      recoveryLogger: workflowLogger,
      statusLine,
    });

    // WHEN — the real pipeline consumes the log
    const { queuedTasks } = await runPipeline(sandbox, generator);

    // THEN — an auto-executing remediation task was PERSISTED carrying the hint
    expect(queuedTasks, 'exactly one retry task must be enqueued').toHaveLength(1);
    expect(queuedTasks[0].prompt).toContain(RETRY_HINT);
    expect(queuedTasks[0].prompt).toContain('OSS-API-003');
    expect(queuedTasks[0].priority).toBe('high');
    expect(queuedTasks[0].status).toBe('pending');

    // THEN — retry visibility went through the REAL RecoveryLogger port:
    // workflow.log gains a RECOVERY line with attempt 1/2
    await vi.waitFor(() => {
      const recoveryLines = fs
        .readFileSync(sandbox.logPath, 'utf-8')
        .split('\n')
        .filter((l) => !l.startsWith('#') && l.includes('"RECOVERY"'))
        .map((l) => JSON.parse(l) as { event: string; data: Record<string, unknown> });
      expect(recoveryLines, 'a RECOVERY visibility line must be logged for real').toHaveLength(1);
      expect(recoveryLines[0].data.code).toBe('OSS-API-003');
      expect(recoveryLines[0].data.attempt).toBe(1);
    });

    // THEN — the REAL RetryStatusLine port persisted the retry text
    await vi.waitFor(() => {
      const statusState = JSON.parse(
        fs.readFileSync(path.join(sandbox.ossDir, 'status-line.json'), 'utf-8'),
      ) as { retry?: string };
      expect(statusState.retry).toBe('⟳ retry 1/2: OSS-API-003');
    });
  });

  it('should escalate an expensive failure end-to-end via the real TelegramNotifier without enqueuing any retry task', async () => {
    // GIVEN — the ONLY mock in this suite: the Telegram HTTP transport boundary
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // GIVEN — a real expensive emission (a retry would burn a full pipeline run)
    const sandbox = makeSandbox();
    const workflowLogger = new WorkflowLogger(sandbox.ossDir);
    await workflowLogger.log({ cmd: 'build', event: 'START', data: { args: [] } });
    const emitted = await runOssError(
      [
        '--code', 'OSS-API-001',
        '--severity', 'HIGH',
        '--message', 'Pipeline run failed after 40 minutes: API 500 mid-ship',
        '--source', 'oss:auto',
        '--retry-eligible', 'true',
        '--retry-cost', 'expensive',
        '--attempt', '0',
      ],
      emitterEnv(sandbox),
    );
    expect(emitted.exitCode).toBe(0);

    // GIVEN — the generator wired with the REAL notifier implementation
    const generator = new InterventionGenerator({
      notifier: new TelegramNotifier('http://telegram-bridge.invalid:8787'),
    });

    // WHEN
    const { interventions, queuedTasks } = await runPipeline(sandbox, generator);

    // THEN — the error surfaced as an escalation, never an auto-retry
    const surfaced = interventions.filter((i) => JSON.stringify(i).includes('OSS-API-001'));
    expect(surfaced.length, 'expensive error must surface, not vanish').toBeGreaterThan(0);
    expect(surfaced.every((i) => i.response_type !== 'auto_remediate')).toBe(true);

    // THEN — NO retry task was persisted to the queue
    expect(queuedTasks).toHaveLength(0);

    // THEN — the real TelegramNotifier delivered the escalation through the
    // (mocked) transport: code + registry recovery steps in the payload
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/notify');
    const body = String(init?.body);
    expect(body).toContain('OSS-API-001');
    expect(body).toContain('status.oneshotship.com');
  });

  it('should surface a hand-corrupted OSS_ERROR line as OSS-WORKFLOW-901 through the same pipeline', async () => {
    // GIVEN — a healthy log then a torn OSS_ERROR line (crashed writer)
    const sandbox = makeSandbox();
    const workflowLogger = new WorkflowLogger(sandbox.ossDir);
    await workflowLogger.log({ cmd: 'build', event: 'START', data: { args: [] } });
    fs.appendFileSync(
      sandbox.logPath,
      '{"ts":"2026-07-21T00:00:00.000Z","cmd":"build","event":"OSS_ERROR","data":{"code":\n',
    );

    // WHEN — the same real pipeline runs (no ports needed: escalation is in-session)
    const { interventions, queuedTasks } = await runPipeline(
      sandbox,
      new InterventionGenerator(),
    );

    // THEN — the corrupted line surfaced as a conformant OSS-WORKFLOW-901 escalation
    const wrapped = interventions.filter((i) =>
      JSON.stringify(i).includes('OSS-WORKFLOW-901'),
    );
    expect(wrapped.length, 'corrupted line must surface as OSS-WORKFLOW-901').toBeGreaterThan(0);
    expect(wrapped.every((i) => i.response_type !== 'auto_remediate')).toBe(true);

    // THEN — nothing auto-retried a nonconforming line
    expect(queuedTasks).toHaveLength(0);
  });
});
