#!/usr/bin/env node
/**
 * The bash blocks OSS's served commands give the main agent and builders (R-266 round 11, D-R11-1):
 * every ```bash block of the plugin's commands/*.md and of the API's served
 * plan / ship / ship-team / build / ideate command prompts, as written.
 *
 * `node scripts/served-command-blocks.mjs` (from watcher/) rewrites
 * test/fixtures/served-command-blocks.json; served-commands.acceptance.test.ts fails when the
 * fixture no longer matches the files. The API checkout is OSS_API_REPO, with no default path
 * (round 12, CR L3); when it is unset, empty or missing, the fixture's API entries are kept, never dropped.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(HERE, '..', '..');
const API_PROMPTS = 'packages/api/src/prompts/commands';
export const API_FILES = ['plan.md', 'ship.md', 'ship-team.md', 'build.md', 'ideate.md'];
export const FIXTURE = path.join(PLUGIN_ROOT, 'watcher', 'test', 'fixtures', 'served-command-blocks.json');

/** Every ```bash block of a markdown text, its fence's indent taken off each line. */
export function bashBlocks(text) {
  const blocks = [];
  let indent = null;
  let lines = [];
  for (const line of text.split('\n')) {
    const fence = /^(\s*)```(\w*)\s*$/.exec(line);
    if (indent === null) {
      if (fence !== null && fence[2] === 'bash') {
        indent = fence[1].length;
        lines = [];
      }
    } else if (fence !== null && fence[2] === '') {
      blocks.push(lines.join('\n'));
      indent = null;
    } else {
      lines.push(line.slice(Math.min(indent, line.length - line.trimStart().length)));
    }
  }
  return blocks;
}

/** The plugin's command files, by name, sorted. */
export function pluginCommandFiles() {
  const dir = path.join(PLUGIN_ROOT, 'commands');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => ({ key: `commands/${f}`, file: path.join(dir, f) }));
}

/** The API's served command prompts folder under OSS_API_REPO; null when it is unset or empty. */
export function apiCommandsDir(env = process.env) {
  const repo = env.OSS_API_REPO;
  return repo === undefined || repo === '' ? null : path.join(repo, API_PROMPTS);
}

/** The API's served command files, when the API checkout is here. */
export function apiCommandFiles(env = process.env) {
  const dir = apiCommandsDir(env);
  if (dir === null || !fs.existsSync(dir)) return [];
  return API_FILES.map((f) => ({ key: `api/commands/${f}`, file: path.join(dir, f) }));
}

const isApiKey = (key) => key.startsWith('api/');

/** The fixture's files: the plugin's blocks, and the API's from the checkout, or the old fixture's when it is missing (null). */
export function fixtureFiles(oldFiles, pluginBlocks, apiBlocks) {
  const api = apiBlocks ?? Object.fromEntries(Object.entries(oldFiles).filter(([key]) => isApiKey(key)));
  return { ...pluginBlocks, ...api };
}

/** What the staleness check says about the API blocks: null when the checkout is here. */
export function apiStatus(apiFiles, fixtureFilesNow) {
  if (apiFiles.length > 0) return null;
  return Object.keys(fixtureFilesNow).some(isApiKey) ? 'API checkout missing; API blocks checked against the fixture only' : 'API checkout missing and the fixture has no API blocks';
}

/** The blocks of each file, by key. */
export function blocksOf(files) {
  return Object.fromEntries(files.map(({ key, file }) => [key, bashBlocks(fs.readFileSync(file, 'utf8'))]));
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const old = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).files : {};
  const api = apiCommandFiles();
  const fixture = {
    source: 'every ```bash block of the plugin commands/*.md and the API prompts/commands/{plan,ship,ship-team,build,ideate}.md; regenerate with `node scripts/served-command-blocks.mjs` (OSS_API_REPO names the API checkout) (R-266 round 11)',
    files: fixtureFiles(old, blocksOf(pluginCommandFiles()), api.length > 0 ? blocksOf(api) : null),
  };
  if (api.length === 0) console.warn(`API checkout missing (${apiCommandsDir() ?? 'OSS_API_REPO not set'}); kept the fixture's API entries`);
  fs.writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${Object.values(fixture.files).flat().length} blocks to ${path.relative(process.cwd(), FIXTURE)}`);
}
