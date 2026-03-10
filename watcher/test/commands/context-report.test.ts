import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const commandPath = join(__dirname, '../../..', 'commands', 'context-report.md');

describe('context-report command wrapper', () => {
  test('should have context-report.md command file', () => {
    expect(existsSync(commandPath)).toBe(true);
  });

  test('should have model: haiku frontmatter', () => {
    const content = readFileSync(commandPath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).not.toBeNull();
    expect(frontmatterMatch![1]).toMatch(/^model:\s*haiku$/m);
  });

  test('should have description frontmatter', () => {
    const content = readFileSync(commandPath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch![1]).toMatch(/^description:/m);
  });

  test('should fetch prompt via oss-decrypt', () => {
    const content = readFileSync(commandPath, 'utf-8');
    expect(content).toContain('oss-decrypt --type commands --name context-report');
  });

  test('should follow standard command wrapper pattern with auth check', () => {
    const content = readFileSync(commandPath, 'utf-8');
    expect(content).toMatch(/Check Authentication/i);
  });

  test('should follow standard command wrapper pattern with logging', () => {
    const content = readFileSync(commandPath, 'utf-8');
    expect(content).toMatch(/oss-log\.sh init context-report/);
  });
});
