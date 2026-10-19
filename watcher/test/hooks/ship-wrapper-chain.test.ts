/**
 * @behavior Running /oss:ship's documented status-line commands fires the team's
 *           ship chain (chains_to) exactly once and leaves the status line on "→ DONE",
 *           whether the PR is merged by ship (--merge) or left for human review.
 * @business-rule A team that configures `ship.chains_to` (e.g. ship → stage) gets that
 *           chain after every successful ship, never zero times and never twice.
 *           The wrapper owns the lifecycle events (start / complete / merged); served
 *           prompts send none of them (AgenticDevWorkflow ADR-5).
 * @boundary commands/ship.md (wrapper text) → hooks/oss-notify.sh → watcher chain-trigger
 *           → a local HTTPS stand-in for the OSS API serving the team's ship config.
 *
 * Nothing is mocked inside the plugin: the real oss-notify.sh, oss-log.sh,
 * update-workflow-state.js and chain-trigger.cjs run under /bin/bash with a temp HOME.
 * Only the external API is replaced, by a real HTTPS server on 127.0.0.1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';

const run = promisify(execFile);

const pluginRoot = path.resolve(__dirname, '../../..');
const notifyScript = path.join(pluginRoot, 'hooks', 'oss-notify.sh');
const shipWrapper = path.join(pluginRoot, 'commands', 'ship.md');

const CHAIN_OPEN = '---CHAIN_COMMANDS---';
const TEAM_SHIP_CONFIG = { chains_to: [{ command: 'stage', always: true }] };

/** Every `oss-notify.sh --workflow ship <event> '<ctx>'` line the wrapper tells the model to run, in order. */
function documentedShipNotifyLines(): Array<{ event: string; context: string }> {
  const text = fs.readFileSync(shipWrapper, 'utf8');
  const re = /^~\/\.oss\/hooks\/oss-notify\.sh --workflow ship ([a-z_]+) '(.*)'$/gm;
  const out: Array<{ event: string; context: string }> = [];
  for (const m of text.matchAll(re)) {
    // Placeholders such as {PR_NUM} / "{BRANCH}" are model-filled; any value keeps the JSON valid.
    out.push({ event: m[1], context: m[2].replace(/\{[A-Z_]+\}/g, '1') });
  }
  return out;
}

/** The event the wrapper's "Execute Chain Commands" step says to read the chain block from. */
function eventNamedByChainStep(): string | undefined {
  const text = fs.readFileSync(shipWrapper, 'utf8');
  const section = text.split('## Execute Chain Commands')[1] ?? '';
  return section.match(/oss-notify\.sh --workflow ship ([a-z_]+)/)?.[1];
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('/oss:ship wrapper fires the team ship chain exactly once', () => {
  let tmp: string;
  let home: string;
  let server: https.Server | undefined;
  let port: number;
  const workflowRequests: string[] = [];

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-ship-chain-'));
    home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.oss'), { recursive: true });

    // Self-signed cert for the local API stand-in (chain-trigger only accepts https).
    const key = path.join(tmp, 'key.pem');
    const cert = path.join(tmp, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=localhost',
    ], { stdio: 'ignore' });

    // Stored credentials, encrypted the way the plugin's login writes them (machine-bound key).
    const creds = { apiKey: 'test-key', userId: 'user-1', hardwareId: 'hw-1', salt: 'salt-1' };
    const machineKey = crypto
      .createHash('sha256')
      .update([process.env.USER || 'user', home, process.platform, process.arch].join(':'))
      .digest();
    const credIv = crypto.randomBytes(12);
    const credCipher = crypto.createCipheriv('aes-256-gcm', machineKey, credIv);
    const credEnc = credCipher.update(JSON.stringify(creds), 'utf8', 'base64') + credCipher.final('base64');
    fs.writeFileSync(
      path.join(home, '.oss', 'credentials.enc'),
      `${credIv.toString('base64')}:${credCipher.getAuthTag().toString('base64')}:${credEnc}`,
    );

    // The team's ship workflow config, encrypted as the API serves it.
    const licenseId = `lic_${crypto.createHash('sha256').update(creds.userId).digest('hex').substring(0, 24)}`;
    const cfgKey = crypto.pbkdf2Sync(`${creds.apiKey}:${licenseId}:${creds.hardwareId}`, creds.salt, 100000, 32, 'sha256');
    const cfgIv = crypto.randomBytes(12);
    const cfgCipher = crypto.createCipheriv('aes-256-gcm', cfgKey, cfgIv);
    const cfgEnc = cfgCipher.update(JSON.stringify(TEAM_SHIP_CONFIG), 'utf8', 'base64') + cfgCipher.final('base64');
    const shipBody = JSON.stringify({
      encrypted: cfgEnc,
      iv: cfgIv.toString('base64'),
      authTag: cfgCipher.getAuthTag().toString('base64'),
    });

    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
      const m = req.url?.match(/^\/api\/v1\/workflows\/([a-z-]+)$/);
      if (m) workflowRequests.push(m[1]);
      if (m && m[1] === 'ship') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(shipBody);
        return;
      }
      res.writeHead(m ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;

    fs.writeFileSync(
      path.join(home, '.oss', 'config.json'),
      JSON.stringify({ apiKey: creds.apiKey, apiUrl: `https://localhost:${port}` }),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A fresh project dir, so each run's workflow-state is its own. */
  function newProject(): string {
    const dir = fs.mkdtempSync(path.join(home, 'proj-'));
    fs.mkdirSync(path.join(dir, '.oss'));
    return dir;
  }

  async function notify(project: string, event: string, context: string): Promise<string> {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      CLAUDE_PROJECT_DIR: project,
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_NO_WARNINGS: '1',
      OSS_SKIP_WATCHER: '1',
    };
    const { stdout } = await run('/bin/bash', [notifyScript, '--workflow', 'ship', event, context], {
      env,
      cwd: project,
      timeout: 60000,
    });
    return stdout;
  }

  async function runPath(events: Array<{ event: string; context: string }>) {
    const project = newProject();
    const outputs: Array<{ event: string; stdout: string }> = [];
    for (const { event, context } of events) {
      outputs.push({ event, stdout: await notify(project, event, context) });
    }
    const state = JSON.parse(fs.readFileSync(path.join(project, '.oss', 'workflow-state.json'), 'utf8'));
    return { outputs, all: outputs.map((o) => o.stdout).join('\n'), state };
  }

  /**
   * @behavior Control: the hook itself prints the team's chain on `ship complete` and not on `ship merged`.
   * Proves the harness (API stand-in, credentials, chain-trigger) works, so a missing block below
   * is the wrapper's doing, not the harness's.
   */
  it('control: oss-notify.sh prints one chain block for ship complete, none for ship merged', async () => {
    const project = newProject();
    const completeOut = await notify(project, 'complete', '{}');
    const mergedOut = await notify(project, 'merged', '{}');

    expect(count(completeOut, CHAIN_OPEN)).toBe(1);
    expect(completeOut).toContain('CHAIN: /oss:stage (always)');
    expect(count(mergedOut, CHAIN_OPEN)).toBe(0);
  }, 120000);

  /**
   * @behavior A ship that opens a PR for human review (no --merge) runs the team's chain once and shows DONE.
   */
  it('ship without --merge: the documented status-line commands fire the chain exactly once and end on DONE', async () => {
    const lines = documentedShipNotifyLines().filter((l) => l.event !== 'failed' && l.event !== 'merged');
    const { outputs, all, state } = await runPath(lines);

    expect(count(all, CHAIN_OPEN)).toBe(1);
    expect(count(all, 'CHAIN: /oss:stage')).toBe(1);
    // The block arrives on the event the wrapper's chain step tells the model to read.
    const carrier = outputs.find((o) => o.stdout.includes(CHAIN_OPEN))?.event;
    expect(carrier).toBe(eventNamedByChainStep());
    expect(state.workflowComplete).toBe(true);
  }, 240000);

  /**
   * @behavior A ship that merges (--merge) runs the team's chain once, after the merge, and shows DONE.
   */
  it('ship with --merge: the documented status-line commands fire the chain exactly once, after merged, and end on DONE', async () => {
    const lines = documentedShipNotifyLines().filter((l) => l.event !== 'failed');
    const { outputs, all, state } = await runPath(lines);

    expect(count(all, CHAIN_OPEN)).toBe(1);
    expect(count(all, 'CHAIN: /oss:stage')).toBe(1);
    const events = outputs.map((o) => o.event);
    const carrierIdx = outputs.findIndex((o) => o.stdout.includes(CHAIN_OPEN));
    expect(carrierIdx).toBeGreaterThan(events.indexOf('merged'));
    expect(outputs[carrierIdx]?.event).toBe(eventNamedByChainStep());
    // merged resets the chain state; DONE must survive it, so it has to be set after merged.
    expect(state.workflowComplete).toBe(true);
  }, 240000);
});
