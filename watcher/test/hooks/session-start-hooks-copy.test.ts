/**
 * @behavior Session start copies all required hooks to ~/.oss/hooks/
 * @user-story All hooks referenced by commands are available at session start
 * @boundary Plugin hooks (shell script content)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('oss-session-start.sh: HOOKS_TO_COPY', () => {
  const sessionStartPath = path.resolve(__dirname, '../../../hooks/oss-session-start.sh');

  it('should include oss-onboard-check.sh in HOOKS_TO_COPY', () => {
    const content = fs.readFileSync(sessionStartPath, 'utf-8');
    expect(content).toContain('"oss-onboard-check.sh"');
  });

  // verify-decrypt-setup.sh gates the /oss:login success banner and the
  // ensure-decrypt-cli.sh "ready" message. login.md calls it at
  // ~/.oss/hooks/verify-decrypt-setup.sh, so it MUST be copied at session start.
  it('should include verify-decrypt-setup.sh in HOOKS_TO_COPY', () => {
    const content = fs.readFileSync(sessionStartPath, 'utf-8');
    expect(content).toContain('"verify-decrypt-setup.sh"');
  });
  // ensure-decrypt-cli.sh runs from ~/.oss/hooks and verifies the downloaded binary against the
  // committed hash manifest beside it. If the manifest is not copied, every fresh install fails closed.
  it('should copy oss-decrypt-checksums.txt alongside ensure-decrypt-cli.sh', () => {
    const content = fs.readFileSync(sessionStartPath, 'utf-8');
    expect(content).toContain('"oss-decrypt-checksums.txt"');
  });
  // /oss:login saves the key with ~/.oss/hooks/oss-login.sh (kept out of the allowlist, R5-8),
  // so it must be installed with the other hooks.
  it('should copy oss-login.sh', () => {
    const content = fs.readFileSync(sessionStartPath, 'utf-8');
    expect(content).toContain('"oss-login.sh"');
  });

  // A command runs ~/.oss/hooks/<name>.sh, which exists only if session start copied it there.
  // A hook missing from HOOKS_TO_COPY works in the repo and is "No such file" for every user.
  it('should copy every hook a command runs from ~/.oss/hooks', () => {
    const content = fs.readFileSync(sessionStartPath, 'utf-8');
    const commandsDir = path.resolve(__dirname, '../../../commands');
    const named = new Set<string>();
    for (const f of fs.readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(commandsDir, f), 'utf-8');
      for (const m of text.matchAll(/~\/\.oss\/hooks\/([a-z0-9-]+\.sh)/g)) named.add(m[1]);
    }
    expect(named.size).toBeGreaterThan(5);
    const missing = [...named].filter((h) => !content.includes(`"${h}"`));
    expect(missing).toEqual([]);
  });
});
