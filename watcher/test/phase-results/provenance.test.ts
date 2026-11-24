/**
 * Provenance of phase decisions (R-257 Task 16, AC-006.3, AC-006.4).
 * @behavior A phase is judged passed, archivable or complete only from its code-built result file
 *           (results/<phase>.json), so a model writing "Current Phase: ship" or ticking `- [x]` boxes in
 *           PROGRESS.md can never make a skipped phase count as done.
 * @business-rule No hook or watcher source decides on a PROGRESS.md `Current Phase` grep or an `[x]` count.
 *           Every known decision site is listed here and in DESIGN.md, and the two lists agree. The dead
 *           iron-law log parser (no importer) stays deleted.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** DESIGN.md in the active dev docs, else in the one archived `phase-results-YYYY-MM-DD` folder. */
function designPath(): string {
  const active = path.join(ROOT, '.oss', 'dev', 'active', 'phase-results', 'DESIGN.md');
  if (fs.existsSync(active)) return active;
  const completed = path.join(ROOT, '.oss', 'dev', 'completed');
  const archived = fs.existsSync(completed)
    ? fs.readdirSync(completed).filter((d) => /^phase-results-\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  if (archived.length !== 1) {
    throw new Error(`expected one archived phase-results-YYYY-MM-DD folder, found ${archived.length}: ${archived.join(', ')}`);
  }
  return path.join(completed, archived[0], 'DESIGN.md');
}

const DECISION_SITES: readonly string[] = [
  'hooks/oss-archive-check.sh',
  'watcher/src/healthchecks/archive.ts',
  'hooks/checkpoint.sh',
  'hooks/oss-notify.sh',
  'hooks/oss-stop-dispatch.sh',
];

/** A PROGRESS.md phase grep, or a checkbox match in any spelling: `[x]`, `\[x\]`, `[xX]`. */
const PROSE_DECISION = /Current Phase|\\*\[x\\*\]|\[xX\]/;

/** Known matches that are not decisions on phase output, keyed `<file>: <trimmed line>`. */
const ALLOWLIST: Readonly<Record<string, string>> = {
  'watcher/src/debug/progress-update.ts: content += `## Current Phase: debug\\n\\n`;':
    'writer: /oss:debug writes the PROGRESS.md heading, it never reads it back',
  'watcher/src/services/spec-reconciler/parser.ts: * - Components: `- [x] ComponentName - Description`':
    'doc comment of the DESIGN.md spec-drift reconciler, not phase output',
  'watcher/src/services/spec-reconciler/parser.ts: // Check for checkbox pattern: - [x] or - [ ] or - [X]':
    'spec-drift reconciler parses DESIGN.md component checkboxes, not phase completion',
  'watcher/src/services/spec-reconciler/auto-fixer.ts: * Auto-fix a checkbox in a spec file by changing - [ ] to - [x].':
    'writer: the spec auto-fixer ticks DESIGN.md boxes, it decides nothing',
  "watcher/src/services/spec-reconciler/auto-fixer.ts: const checkedPattern = new RegExp(`^\\\\s*-\\\\s*\\\\[[xX]\\\\]\\\\s*${escapeRegExp(itemId)}\\\\s*-`, 'm');":
    'writer: the spec auto-fixer checks a DESIGN.md box is already ticked before writing it',
  "watcher/src/services/spec-reconciler/auto-fixer.ts: const updatedContent = content.replace(uncheckedPattern, '$1[x]$2');":
    'writer: the spec auto-fixer ticks a DESIGN.md box',
};

const EXCLUDED_DIRS = new Set(['__tests__', 'test', 'tests', 'fixtures', 'node_modules']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function proseDecisionMatches(): string[] {
  const matches: string[] = [];
  for (const top of ['hooks', 'watcher/src']) {
    for (const file of sourceFiles(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file);
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (PROSE_DECISION.test(line)) matches.push(`${rel}: ${line.trim()}`);
      }
    }
  }
  return matches;
}

function designDecisionSites(): string[] {
  const text = fs.readFileSync(designPath(), 'utf8');
  const section = /<!-- provenance-decision-sites:start -->([\s\S]*?)<!-- provenance-decision-sites:end -->/.exec(text);
  if (!section) return [];
  return [...section[1].matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
}

describe('phase decision provenance', () => {
  it('no hook or watcher source decides on a PROGRESS.md Current Phase grep or an [x] count', () => {
    const unlisted = proseDecisionMatches().filter((m) => !(m in ALLOWLIST));
    expect(unlisted).toEqual([]);
  });

  it('every allowlist entry still matches a real line, so the list cannot go stale', () => {
    const found = new Set(proseDecisionMatches());
    expect(Object.keys(ALLOWLIST).filter((k) => !found.has(k))).toEqual([]);
  });

  it('the dead iron-law log parser stays deleted, source and built output', () => {
    const paths = [
      'watcher/src/monitors/iron-law-log-parser.ts',
      'watcher/dist/monitors/iron-law-log-parser.js',
      'watcher/dist/monitors/iron-law-log-parser.d.ts',
      'watcher/dist/monitors/iron-law-log-parser.js.map',
      'watcher/dist/monitors/iron-law-log-parser.d.ts.map',
    ];
    expect(paths.filter((p) => fs.existsSync(path.join(ROOT, p)))).toEqual([]);
  });

  it('the decision-site list matches the one in DESIGN.md', () => {
    expect(designDecisionSites()).toEqual([...DECISION_SITES]);
  });

  it('every decision site exists and reads phase results', () => {
    const notReading = DECISION_SITES.filter((site) => {
      const file = path.join(ROOT, site);
      if (!fs.existsSync(file)) return true;
      return !/oss-phase-result\.sh|phase-results\//.test(fs.readFileSync(file, 'utf8'));
    });
    expect(notReading).toEqual([]);
  });
});
