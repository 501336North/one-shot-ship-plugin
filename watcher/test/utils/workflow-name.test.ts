/**
 * @behavior A workflow or command name is accepted only when it is a lowercase slug that starts
 *           with a letter and is at most 41 characters: `build`, `visual-test`. Anything else
 *           (uppercase, a path, a leading digit, a newline, a query string, a prototype key, an
 *           over-long name, an empty string) is refused before it reaches a URL, a file path or
 *           a CHAIN line.
 * @business-rule There is ONE workflow-name rule across the plugin. The bash hooks
 *           (oss_valid_workflow_name in hooks/oss-safe-path.sh) and the TypeScript watcher
 *           (isValidWorkflowName) must accept exactly the same names, so the two runtimes cannot
 *           drift (IRON LAW #1b).
 * @boundary hooks/oss-safe-path.sh is read as text; the TS rule is exercised directly.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  WORKFLOW_NAME_PATTERN,
  isValidWorkflowName,
  assertValidWorkflowName,
} from '../../src/utils/workflow-name';

const SAFE_PATH_SH = path.resolve(__dirname, '../../../hooks/oss-safe-path.sh');

const ACCEPTED = ['build', 'visual-test', 'a', 'a'.repeat(41)];
const REJECTED = ['Build', 'build/../ship', '1adr', 'a'.repeat(42), '', 'build\n', 'ship?x=1', '__proto__'];

/** Every `local re='...'` inside the body of oss_valid_workflow_name() in a bash source */
function bashWorkflowNameLiterals(source: string): string[] {
  const body = /^oss_valid_workflow_name\(\) \{\n([\s\S]*?)\n\}/m.exec(source);
  if (!body) return [];
  return [...body[1].matchAll(/local re='([^']*)'/g)].map((m) => m[1]);
}

describe('isValidWorkflowName', () => {
  it.each(ACCEPTED)('accepts %j', (name) => {
    expect(isValidWorkflowName(name)).toBe(true);
  });

  it.each(REJECTED)('rejects %j', (name) => {
    expect(isValidWorkflowName(name)).toBe(false);
  });
});

describe('assertValidWorkflowName', () => {
  it.each(REJECTED)('throws on %j', (name) => {
    expect(() => assertValidWorkflowName(name)).toThrow();
  });

  it.each(ACCEPTED)('returns on %j', (name) => {
    expect(() => assertValidWorkflowName(name)).not.toThrow();
  });
});

describe('one rule across bash and TypeScript', () => {
  const bashSource = fs.readFileSync(SAFE_PATH_SH, 'utf8');

  it('finds exactly one regex literal inside oss_valid_workflow_name (control)', () => {
    expect(bashWorkflowNameLiterals(bashSource)).toHaveLength(1);
  });

  it('the TS pattern source is identical to the bash literal', () => {
    expect(WORKFLOW_NAME_PATTERN.source).toBe(bashWorkflowNameLiterals(bashSource)[0]);
  });

  it('a drifted bash literal is detected (control: the comparison is not vacuous)', () => {
    const drifted = bashSource.replace("local re='^[a-z][a-z0-9-]{0,40}$'", () => "local re='^[a-z][a-z0-9-]{0,41}$'");
    expect(drifted).not.toBe(bashSource);
    expect(bashWorkflowNameLiterals(drifted)).toHaveLength(1);
    expect(WORKFLOW_NAME_PATTERN.source).not.toBe(bashWorkflowNameLiterals(drifted)[0]);
  });
});
