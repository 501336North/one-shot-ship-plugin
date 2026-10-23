/**
 * @behavior The watcher ships no Telegram code; escalations go through a
 *           channel-agnostic port that nothing implements yet.
 * @business-rule Customer Telegram was removed (telegram-removal Task 7): no
 *                watcher source may import a Telegram module or read the
 *                OSS_TELEGRAM_BRIDGE_URL bridge, but the EscalationNotifier
 *                port stays so a future channel can be wired in.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  EscalationNotifier,
  EscalationPayload,
} from '../src/intervention/generator.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const IMPORT_FROM_TELEGRAM = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*telegram[^'"]*['"]/i;

describe('watcher has no Telegram code', () => {
  const files = tsFiles(SRC);

  it('scans the real source tree', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no source file imports from a Telegram module', () => {
    const offenders = files.filter((f) => IMPORT_FROM_TELEGRAM.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no source file reads the OSS_TELEGRAM_BRIDGE_URL bridge', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('OSS_TELEGRAM_BRIDGE_URL'));
    expect(offenders).toEqual([]);
  });

  it('keeps the EscalationNotifier port exported for a future channel', async () => {
    const sent: EscalationPayload[] = [];
    const notifier: EscalationNotifier = {
      sendErrorEscalation: async (payload) => {
        sent.push(payload);
      },
    };
    await notifier.sendErrorEscalation({ code: 'X', severity: 'HIGH', message: 'm', recovery: [] });
    expect(sent).toHaveLength(1);
    expect(readFileSync(join(SRC, 'intervention', 'generator.ts'), 'utf8')).toMatch(
      /export interface EscalationNotifier\b/
    );
  });
});
