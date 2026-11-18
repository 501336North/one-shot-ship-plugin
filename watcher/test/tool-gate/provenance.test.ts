/**
 * @behavior The tool gate's rule values (protected branches, test patterns, source
 *   extensions, protected paths, production hosts) are shipped in one place: the plugin's
 *   `config/tool-gates.json`.
 * @business-rule No list from the base settings is copied into the gate's code, so changing
 *   a value in the settings file changes what the gate does, and nothing else can drift.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_FILE = fileURLToPath(new URL('../../../config/tool-gates.json', import.meta.url));
const GATE_SRC = fileURLToPath(new URL('../../src/tool-gate/', import.meta.url));

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Lists left out of the literal scan: `reviewPrograms` names programs (`grep`, `echo`, `find` …)
 * that other rules name for their own reasons. Its provenance is checked by behaviour instead
 * (gate-agent-write.test.ts: the allowlist follows the setting).
 */
const NOT_SCANNED = new Set(['reviewPrograms']);

function baseListValues(): string[] {
  const base: Record<string, unknown> = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
  return Object.entries(base).flatMap(([key, value]) =>
    Array.isArray(value) && !NOT_SCANNED.has(key) ? value.filter((item): item is string => typeof item === 'string') : [],
  );
}

describe('base settings file', () => {
  it('should ship the design settings, with the gate state folder, the workflow state and git config files protected', () => {
    const base: unknown = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8'));
    expect(base).toEqual({
      version: 1,
      protectedBranches: ['main', 'master'],
      testFilePatterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test_*.sh', '**/*_test.go'],
      testCommandPatterns: [
        'npm test', 'npm run test*', 'pnpm test', 'pnpm run test*', 'yarn test', 'yarn run test*',
        'bun test', 'npx vitest', 'npx jest',
        // fix part K13: common runner spellings, so their runs are recorded
        'pnpm vitest', 'pnpm exec vitest', 'pnpm jest', 'pnpm exec jest', 'yarn vitest', 'yarn jest', 'bunx vitest',
        './node_modules/.bin/vitest', './node_modules/.bin/jest',
        'vitest', 'jest', 'pytest', 'python -m pytest',
        'python3 -m pytest', 'uv run pytest', 'poetry run pytest', 'python -m unittest', 'python3 -m unittest',
        'go test', 'cargo test', 'swift test', 'make test', 'make check', './gradlew test',
        'gradle test', 'mvn test', 'dotnet test', 'rspec', 'bundle exec rspec', 'phpunit',
        'bash *test*.sh',
      ],
      sourceExtensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.sh', '.py', '.go', '.rs', '.swift'],
      // DESIGN.md build amendment 2026-11-09, user pick
      protectedPaths: [
        '.oss/tool-gates.json', '.oss/tool-gates/**', '~/.oss/hooks/**', '~/.oss/node-path',
        // round 14 C (D-R14-3): the review check's own state (tamper marks, ledger, notices, mount baselines)
        '~/.oss/gate-state/**', '.claude/settings*.json',
        '~/.claude/settings*.json', '~/.claude/plugins/**', '.oss/workflow-state.json',
        // ship round 2 (R2b): git's own config files, which can change where a push goes or make git run a command;
        // `**/` so a worktree's shared config (in the main checkout's .git) is covered too
        '**/.git/config', '**/.git/config.worktree', '**/.git/worktrees/*/config.worktree', '~/.gitconfig', '~/.config/git/config',
        // fix round 4 (K2): hooks run on commit and push; the files that decide which repository, branch
        // and settings git uses (a `.git` file, HEAD, refs, commondir) can't be planted by the call that
        // then commits or pushes; a submodule's settings, like a repo's
        '**/.git/hooks/**', '**/.git', '**/.git/HEAD', '**/.git/commondir', '**/.git/refs/**', '**/.git/packed-refs',
        '**/.git/worktrees/*/HEAD', '**/.git/worktrees/*/commondir', '**/.git/worktrees/*/gitdir', '**/.git/modules/**/config',
        // R-257 T18b, D22 (user pick 2026-11-18): the phase-result ledger is protected
        '~/.oss/ledger/**',
      ],
      productionHosts: [],
      // R-266 DESIGN item 3 (AC-004.6): the review agents whose runs the gate tracks
      gateAgents: ['code-reviewer', 'security-auditor', 'penetration-tester', 'performance-auditor'],
      backgroundAgents: ['penetration-tester'],
      // R-266 round 3: what a review agent may run, every stack's checks included
      reviewPrograms: [
        'cat', 'head', 'tail', 'ls', 'tree', 'find', 'grep', 'rg', 'wc', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp',
        'comm', 'stat', 'file', 'du', 'df', 'basename', 'dirname', 'realpath', 'readlink', 'pwd', 'which', 'type',
        'echo', 'printf', 'true', 'false', 'test', '[', 'date', 'env', 'jq', 'yq', 'xxd', 'od', 'hexdump', 'shasum',
        'sha256sum', 'md5', 'md5sum', 'column', 'nl', 'fold', 'expand', 'sed', 'sleep',
        '~/.oss/hooks/ensure-decrypt-cli.sh', '~/.oss/bin/oss-decrypt', 'pytest', 'mypy', 'ruff check',
        'ruff format --check', 'pyright', 'black --check', 'isort --check-only', 'flake8', 'pylint', 'bandit',
        'pip-audit', 'tox', 'mvn test', 'mvn verify', 'mvn compile', 'mvn dependency:tree', 'mvnw test', 'mvnw verify',
        'mvnw compile', 'mvnw dependency:tree', 'gradle test', 'gradle check', 'gradle build', 'gradle dependencies',
        'gradlew test', 'gradlew check', 'gradlew build', 'gradlew dependencies', 'javac', 'ktlint', 'detekt', 'rspec',
        'rubocop', 'rake test', 'brakeman', 'bundler-audit', 'bundle-audit', 'php -l', 'phpunit', 'phpstan', 'psalm',
        'php-cs-fixer fix --dry-run', 'php-cs-fixer check', 'composer validate', 'composer audit', 'composer show',
        'go mod verify', 'golangci-lint run', 'staticcheck', 'govulncheck', 'cargo audit', 'cargo tree',
        'rustc --version', 'xcodebuild test', 'xcodebuild build', 'xcodebuild -list', 'swiftlint', 'swiftformat --lint',
        'flutter test', 'flutter analyze', 'dart analyze', 'dart test', 'dart format --output=none', 'dotnet test',
        'dotnet build', 'dotnet list package', 'playwright test', 'semgrep', 'gitleaks detect', 'trivy fs',
        'osv-scanner', 'shellcheck', 'hadolint', 'docker ps', 'docker images', 'docker inspect', 'docker logs',
        'docker compose ps', 'docker compose config', 'kubectl get', 'kubectl describe', 'kubectl logs',
        'terraform validate', 'terraform plan', 'terraform fmt -check', 'snyk test', 'audit-ci',
        'trufflehog filesystem', 'trufflehog git', 'gofmt -l', 'cargo fmt --check', 'rustfmt --check',
        'dotnet format --verify-no-changes', 'printenv', 'gitleaks git', 'gitleaks dir', 'trivy config', 'snyk code test',
        'xcodebuild -showBuildSettings', 'xcodebuild -version', 'deno test', 'mix test', 'cargo nextest run', 'composer test', 'php artisan test', 'rails test', 'turbo run test',
      ],
      // R-266 round 3: options that make an allowed program write
      reviewWriteOptions: [
        '--fix', '--fix-only', '--write', '--apply', '--apply-unsafe', '--unsafe', '--autofix', '--autocorrect',
        '--autocorrect-all', '--auto-correct', '--alter', '--update-snapshots', '--snapshot-update', 'rubocop -a',
        'rubocop -A', 'ktlint -F', 'ktlint --format', 'swiftlint autocorrect', 'semgrep -o', 'semgrep --output',
        'semgrep --sarif-output', 'semgrep --json-output', 'gitleaks --report-path', 'gitleaks -r', 'trivy -o',
        'trivy --output', 'osv-scanner --output', 'bandit -o', 'bandit --output', 'pylint --output', 'terraform -out',
        'docker --output', 'docker -o', 'phpunit --log-junit', 'phpunit --coverage-html', 'pytest --junitxml',
        'pytest --cov-report', '--write-locks', '--update-locks', 'sort -o', 'sort --output', 'sort -T',
        'sort --temporary-directory', 'sort --compress-program', 'tree -o', 'yq -i', 'yq --inplace', 'file -C',
        'rg --pre', 'rg --pre-glob', 'go -exec', 'go -o', 'go -fuzz', 'go -w', 'go -u',
        'date -s', 'date --set', 'xxd -r', 'xxd -revert', 'ruff --add-noqa', 'ruff -o', 'ruff --output-file',
        'flake8 --output-file', 'pip-audit -o', 'pip-audit --output', 'mypy --junit-xml', 'mypy --install-types',
        'pytest --basetemp', 'pytest --debug', 'eslint -o', 'eslint --output-file', 'mvn -l', 'mvn --log-file',
        'mvnw -l', 'mvnw --log-file', 'rspec --out', 'rspec -o', 'brakeman -o', 'brakeman --output',
        'rubocop --auto-gen-config', 'phpstan --generate-baseline', 'psalm --set-baseline', 'flutter --update-goldens',
        'swiftformat --output', 'gofmt -w', 'snyk --json-file-output', 'snyk --sarif-file-output',
        'go -toolexec', 'go -vettool', 'go -overlay', 'go -modfile', 'go -pgo', 'go -C', 'npm --script-shell', 'pnpm --script-shell',
        'cargo --config', 'node -r', 'node --require', 'node --import', 'node --loader', 'node --experimental-loader', 'file --compile',
        'pyright --writebaseline', 'pyright --createstub', 'mypy --sqlite-cache', 'turbo --summarize',
      ],
      // R-266 round 4: packages npx and bunx may run besides the JS tools
      reviewNpxPackages: [
        'snyk', 'audit-ci', 'playwright', 'turbo',
      ],
      tagsAllowed: true,
    });
  });
});

describe('rule values live only in the settings file', () => {
  it("should find none of the base file's list values as literals in watcher/src/tool-gate/**", () => {
    const values = baseListValues().filter((value) => value.length >= 4);
    expect(values.length).toBeGreaterThan(20);
    const sources = tsFiles(GATE_SRC);
    expect(sources.length).toBeGreaterThan(0);

    const found: string[] = [];
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      for (const value of values) {
        for (const quote of ["'", '"', '`']) {
          if (text.includes(`${quote}${value}${quote}`)) {
            found.push(`${path.relative(GATE_SRC, file)}: ${quote}${value}${quote}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
