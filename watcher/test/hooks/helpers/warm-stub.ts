import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Budget for a beforeAll that creates warm stubs. The macOS first-exec security scan of a new
// file was measured at 0.3 s to about 60 s under parallel-agent load (TESTING.md T6.b, T6.c),
// so a few stubs warmed in a row need minutes, not vitest's default seconds.
export const WARMUP_TIMEOUT_MS = 180_000;

const GUARD = '[ -n "${OSS_STUB_WARMUP:-}" ] && { : > "$OSS_STUB_WARMUP"; exit 0; }';

/**
 * Write an executable bash stub and exec the file itself once (warm-up), so the first-exec
 * scan happens here and not inside a timed test. The warm-up run skips `body`.
 * `onWarm` sees the marker the warm-up wrote, before it is deleted.
 */
export function writeWarmStub(file: string, body: string, onWarm?: (marker: string) => void): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/bash\n${GUARD}\n${body}`, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  const marker = `${file}.warm`;
  execFileSync(file, { env: { ...process.env, OSS_STUB_WARMUP: marker }, stdio: 'ignore' });
  if (!fs.existsSync(marker)) throw new Error(`warm-up of ${file} did not run its guard`);
  onWarm?.(marker);
  fs.rmSync(marker);
}
