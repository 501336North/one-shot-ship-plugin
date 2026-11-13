/**
 * Phase result schema loader (R-257 T2, amended S8).
 *
 * Schemas load only from `<pluginRoot>/schemas/phase-results/`. The caller passes the plugin root
 * derived from the bundle's own location, never the repo or cwd, so a repo cannot plant looser
 * schemas. Each file's realpath must stay inside that directory's realpath (no links out).
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadSchema, type Schema } from './validate.js';

export const PHASES = ['ideate', 'plan', 'build', 'ship'] as const;
export type Phase = (typeof PHASES)[number];

function readSchemaFile(dir: string, name: string): unknown {
  const file = fs.realpathSync(path.join(dir, `${name}.schema.json`));
  if (path.dirname(file) !== dir) throw new Error(`unsafe_path: ${name}.schema.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

export function loadPhaseSchema(phase: Phase, pluginRoot: string): Schema {
  if (!(PHASES as readonly string[]).includes(phase)) throw new Error(`unsafe_path: phase ${String(phase)}`);
  const dir = fs.realpathSync(path.join(pluginRoot, 'schemas', 'phase-results'));
  const common = loadSchema(readSchemaFile(dir, 'common'));
  return loadSchema(readSchemaFile(dir, phase), { 'common.schema.json': common });
}
