/**
 * @behavior The decrypt CLI is built with a maintained, vulnerability-free toolchain.
 * @acceptance-criteria The unmaintained `pkg` packer (GHSA-22r3-9w55-cj54, no fix) is gone,
 *           replaced by `@yao-pkg/pkg`; every packed binary targets Node 22 (the oldest line
 *           @yao-pkg/pkg supports); CI builds on Node 22; the bundle is compiled for node22.
 * @boundary Build scripts + release workflow
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
const workflow = readFileSync(
  resolve(__dirname, '../../../.github/workflows/release-cli-decrypt.yml'),
  'utf8'
);

describe('Toolchain: maintained packer on Node 22', () => {
  it('does not depend on the unmaintained `pkg` packer', () => {
    expect(pkgJson.devDependencies).not.toHaveProperty('pkg');
    expect(pkgJson.dependencies ?? {}).not.toHaveProperty('pkg');
  });

  it('packs with @yao-pkg/pkg', () => {
    expect(pkgJson.devDependencies).toHaveProperty('@yao-pkg/pkg');
  });

  it('targets only node22 in the local build:binary script', () => {
    const script: string = pkgJson.scripts['build:binary'];
    const targets = script.match(/--targets\s+(\S+)/)?.[1]?.split(',') ?? [];
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t).toMatch(/^node22-/);
  });

  it('targets only node22 in the release workflow matrix', () => {
    const targets = [...workflow.matchAll(/^\s*target:\s*(\S+)/gm)].map((m) => m[1]);
    expect(targets.length).toBe(4);
    for (const t of targets) expect(t).toMatch(/^node22-/);
  });

  it('builds on Node 22 in CI', () => {
    const versions = [...workflow.matchAll(/node-version:\s*'?([^'\s]+)'?/g)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(v).toBe('22');
  });

  it('never installs the unmaintained `pkg` package in CI', () => {
    expect(workflow).not.toMatch(/npm install -g pkg\b/);
  });

  it('compiles the bundle for node22', () => {
    expect(pkgJson.scripts['build:bundle']).toMatch(/--target=node22(\s|$)/);
  });
});
