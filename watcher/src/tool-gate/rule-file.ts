/**
 * Rule file loader for the tool gate. The rule values, including the one list of review (gate)
 * agents, live only in the plugin's config/tool-gates.json; a repo's .oss/tool-gates.json may add to the lists (except
 * testFilePatterns and testCommandPatterns: only the plugin decides what a test file and a test
 * run are) or set tagsAllowed to false.
 * A repo file that drops a base value, adds a test-file or test-command pattern or more than 64 values to a list,
 * loosens tagsAllowed, or is malformed is ignored as a whole, with a one-line reason that never echoes the file.
 * A missing or invalid base file, or a plugin root that is not absolute, throws (a gate error).
 */

import path from 'node:path';

export interface GateSettings {
  version: 1;
  protectedBranches: string[];
  testFilePatterns: string[];
  testCommandPatterns: string[];
  sourceExtensions: string[];
  protectedPaths: string[];
  productionHosts: string[];
  gateAgents: string[];
  tagsAllowed: boolean;
}

/** The file's text, or null when it is missing. Throws for a file it won't read (a pipe, a folder, too big). */
export type ReadFile = (absPath: string) => string | null;

export interface LoadedSettings {
  settings: GateSettings;
  /** One-line reason the repo file was ignored. */
  rejected?: string;
}

type ListKey = Exclude<keyof GateSettings, 'version' | 'tagsAllowed'>;

const LIST_KEYS: readonly ListKey[] = [
  'protectedBranches',
  'testFilePatterns',
  'testCommandPatterns',
  'sourceExtensions',
  'protectedPaths',
  'productionHosts',
  'gateAgents',
];
const KNOWN_KEYS: ReadonlySet<string> = new Set(['version', 'tagsAllowed', ...LIST_KEYS]);
const MAX_REPO_BYTES = 64 * 1024;
/**
 * Most values a repo file may add to one list (a reading limit, not a rule value): every added
 * glob is matched against every word of a call, and a gate slower than its time limit allows
 * the call, so thousands of added globs would switch the rules off.
 */
const MAX_REPO_ADDED = 64;

type Parsed = { ok: true; value: Partial<GateSettings> } | { ok: false; reason: string };

function parse(text: string, requireAll: boolean): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, reason: 'not a JSON object' };
  }
  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !KNOWN_KEYS.has(key))) return { ok: false, reason: 'has an unknown key' };
  if (record.version !== 1) return { ok: false, reason: 'version must be 1' };

  const value: Partial<GateSettings> = { version: 1 };
  if ('tagsAllowed' in record) {
    if (typeof record.tagsAllowed !== 'boolean') return { ok: false, reason: 'tagsAllowed must be true or false' };
    value.tagsAllowed = record.tagsAllowed;
  } else if (requireAll) {
    return { ok: false, reason: 'tagsAllowed is missing' };
  }
  for (const key of LIST_KEYS) {
    if (!(key in record)) {
      if (requireAll) return { ok: false, reason: `${key} is missing` };
      continue;
    }
    const list = record[key];
    if (!Array.isArray(list) || !list.every((item) => typeof item === 'string' && item.length > 0)) {
      return { ok: false, reason: `${key} must be a list of non-empty strings` };
    }
    value[key] = list;
  }
  return { ok: true, value };
}

function merge(base: GateSettings, repo: Partial<GateSettings>): GateSettings | string {
  const merged: GateSettings = { ...base };
  for (const key of LIST_KEYS) {
    const added = repo[key];
    if (added === undefined) continue;
    if (!base[key].every((value) => added.includes(value))) return `${key} drops a base value`;
    if (new Set(added.filter((value) => !base[key].includes(value))).size > MAX_REPO_ADDED) {
      return `${key} adds more than ${MAX_REPO_ADDED} values`;
    }
    // A repo could add `**/*` and so turn every source file into a test file (no RED rule),
    // or add `*` and so record any failing command (`false`) as a red test run.
    if ((key === 'testFilePatterns' || key === 'testCommandPatterns') && !added.every((value) => base[key].includes(value))) {
      return `${key} is set by the plugin only`;
    }
    merged[key] = [...new Set([...base[key], ...added])];
  }
  if (repo.tagsAllowed === true && !base.tagsAllowed) return 'tagsAllowed true loosens the base false';
  if (repo.tagsAllowed === false) merged.tagsAllowed = false;
  return merged;
}

export function loadSettings(readFile: ReadFile, pluginRoot: string, repoRoot: string): LoadedSettings {
  // A relative root would read the base file from the working folder, which the repo controls.
  if (!path.isAbsolute(pluginRoot)) throw new Error('tool-gate plugin root is not an absolute path');
  const baseText = readFile(path.join(pluginRoot, 'config', 'tool-gates.json'));
  if (baseText === null) throw new Error('tool-gate base settings file is missing');
  const baseParsed = parse(baseText, true);
  if (!baseParsed.ok) throw new Error(`tool-gate base settings file is invalid: ${baseParsed.reason}`);
  const base = baseParsed.value as GateSettings;

  const reject = (reason: string): LoadedSettings => ({
    settings: base,
    rejected: `.oss/tool-gates.json ignored: ${reason}`,
  });
  let repoText: string | null;
  try {
    repoText = readFile(path.join(repoRoot, '.oss', 'tool-gates.json'));
  } catch {
    return reject('not a regular file under 1 MB');
  }
  if (repoText === null) return { settings: base };
  if (Buffer.byteLength(repoText, 'utf8') > MAX_REPO_BYTES) return reject('larger than 64 KB');
  const repoParsed = parse(repoText, false);
  if (!repoParsed.ok) return reject(repoParsed.reason);
  const merged = merge(base, repoParsed.value);
  if (typeof merged === 'string') return reject(merged);
  return { settings: merged };
}
