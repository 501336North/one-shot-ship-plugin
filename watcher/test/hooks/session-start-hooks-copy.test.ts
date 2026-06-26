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
});
