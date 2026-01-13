/**
 * @behavior Commands provide comprehensive help documentation
 * @acceptance-criteria All commands have standardized help sections
 * @business-rule HELP-001: Every command must be self-documenting
 * @boundary Command markdown files
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Commands directory is two levels up from watcher/test
const COMMANDS_DIR = path.join(__dirname, '../../commands');

// Phase 1: Core workflow commands
const PHASE_1_COMMANDS = ['ideate', 'plan', 'build', 'ship'];

// Phase 2: TDD cycle commands
const PHASE_2_COMMANDS = ['red', 'green', 'refactor', 'mock', 'acceptance', 'integration'];

// Phase 3: Design commands
const PHASE_3_COMMANDS = ['requirements', 'api-design', 'data-model', 'adr', 'contract'];

// Phase 4: Quality commands
const PHASE_4_COMMANDS = ['test', 'review', 'bench', 'load', 'audit', 'a11y', 'tech-debt'];

// Phase 5: Deployment commands
const PHASE_5_COMMANDS = ['stage', 'deploy', 'release', 'smoke'];

// Phase 6: Operations commands
const PHASE_6_COMMANDS = ['monitor', 'incident', 'rollback', 'debug', 'trace', 'postmortem'];

// Phase 7: Utility commands
const PHASE_7_COMMANDS = ['login', 'status', 'models', 'settings', 'telegram', 'webhook', 'watcher', 'queue', 'legend', 'docs'];

// Phase 8: Specialized commands
const PHASE_8_COMMANDS = ['iterate', 'chaos', 'cost', 'design-review', 'experiment', 'feature-flag', 'license', 'privacy', 'retro', 'oss', 'oss-audio'];

// All phases
const ALL_PHASE_COMMANDS = [
  ...PHASE_3_COMMANDS,
  ...PHASE_4_COMMANDS,
  ...PHASE_5_COMMANDS,
  ...PHASE_6_COMMANDS,
  ...PHASE_7_COMMANDS,
  ...PHASE_8_COMMANDS,
];

// Required fields in every help section
const REQUIRED_HELP_FIELDS = [
  '**Command:**',
  '**Description:**',
  '**Workflow Position:**',
  '**Usage:**',
  '**Options:**',
  '**Examples:**',
  '**Related Commands:**'
];

describe('Command Help Documentation - Phase 1: Core Workflow', () => {
  let commandContents: Map<string, string>;

  beforeAll(() => {
    commandContents = new Map();
    for (const cmd of PHASE_1_COMMANDS) {
      const filePath = path.join(COMMANDS_DIR, `${cmd}.md`);
      if (fs.existsSync(filePath)) {
        commandContents.set(cmd, fs.readFileSync(filePath, 'utf-8'));
      }
    }
  });

  PHASE_1_COMMANDS.forEach(commandName => {
    describe(`/oss:${commandName}`, () => {
      it('should have ## Help section', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        expect(content).toContain('## Help');
      });

      REQUIRED_HELP_FIELDS.forEach(field => {
        it(`should have ${field} in help section`, () => {
          const content = commandContents.get(commandName);
          expect(content).toBeDefined();
          // Extract the help section (between ## Help and the closing ---)
          // The help section ends with a --- on its own line (not in code blocks)
          const helpStart = content!.indexOf('## Help');
          const afterHelp = content!.slice(helpStart);
          // Find the closing --- that's not in a code block
          // Look for \n---\n pattern after the help header
          const closingIndex = afterHelp.search(/\n---\s*\n/);
          const helpSection = closingIndex > 0 ? afterHelp.slice(0, closingIndex) : afterHelp;
          expect(helpSection).toContain(field);
        });
      });

      it('should document --help flag in options table', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        // Should have --help | -h pattern in options
        expect(content).toMatch(/\|\s*`?--help`?\s*\|\s*`?-h`?\s*\|/);
      });

      it('should show workflow position indicator', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        // Should show the workflow position with arrow notation
        expect(content).toMatch(/\*\*Workflow Position:\*\*.*→.*→/);
      });

      it('should list related commands', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        // Should have related commands section with links
        expect(content).toMatch(/\*\*Related Commands:\*\*/);
        expect(content).toMatch(/`\/oss:[a-z-]+`/);
      });
    });
  });
});

describe('Command Help Documentation - Phase 2: TDD Cycle', () => {
  let commandContents: Map<string, string>;

  beforeAll(() => {
    commandContents = new Map();
    for (const cmd of PHASE_2_COMMANDS) {
      const filePath = path.join(COMMANDS_DIR, `${cmd}.md`);
      if (fs.existsSync(filePath)) {
        commandContents.set(cmd, fs.readFileSync(filePath, 'utf-8'));
      }
    }
  });

  PHASE_2_COMMANDS.forEach(commandName => {
    describe(`/oss:${commandName}`, () => {
      it('should have ## Help section', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        expect(content).toContain('## Help');
      });

      REQUIRED_HELP_FIELDS.forEach(field => {
        it(`should have ${field} in help section`, () => {
          const content = commandContents.get(commandName);
          expect(content).toBeDefined();
          const helpStart = content!.indexOf('## Help');
          const afterHelp = content!.slice(helpStart);
          const closingIndex = afterHelp.search(/\n---\s*\n/);
          const helpSection = closingIndex > 0 ? afterHelp.slice(0, closingIndex) : afterHelp;
          expect(helpSection).toContain(field);
        });
      });

      it('should document --help flag in options table', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        expect(content).toMatch(/\|\s*`?--help`?\s*\|\s*`?-h`?\s*\|/);
      });

      it('should show workflow position indicator', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        // Workflow position should have arrows (→ or ->) OR indicate utility/any-time/meta position OR show deprecated
        expect(content).toMatch(/\*\*Workflow Position:\*\*.*(→|->|any time|DEPRECATED|\[any\]|meta)/);
      });

      it('should list related commands', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        expect(content).toMatch(/\*\*Related Commands:\*\*/);
        expect(content).toMatch(/`\/oss:[a-z-]+`/);
      });
    });
  });
});

describe('Command Help Documentation - Phases 3-8', () => {
  let commandContents: Map<string, string>;

  beforeAll(() => {
    commandContents = new Map();
    for (const cmd of ALL_PHASE_COMMANDS) {
      const filePath = path.join(COMMANDS_DIR, `${cmd}.md`);
      if (fs.existsSync(filePath)) {
        commandContents.set(cmd, fs.readFileSync(filePath, 'utf-8'));
      }
    }
  });

  ALL_PHASE_COMMANDS.forEach(commandName => {
    describe(`/oss:${commandName}`, () => {
      it('should have ## Help section', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        expect(content).toContain('## Help');
      });

      REQUIRED_HELP_FIELDS.forEach(field => {
        it(`should have ${field} in help section`, () => {
          const content = commandContents.get(commandName);
          expect(content).toBeDefined();
          const helpStart = content!.indexOf('## Help');
          const afterHelp = content!.slice(helpStart);
          const closingIndex = afterHelp.search(/\n---\s*\n/);
          const helpSection = closingIndex > 0 ? afterHelp.slice(0, closingIndex) : afterHelp;
          expect(helpSection).toContain(field);
        });
      });

      it('should document --help flag in options table', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        expect(content).toMatch(/\|\s*`?--help`?\s*\|\s*`?-h`?\s*\|/);
      });

      it('should show workflow position indicator', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        // Workflow position should have arrows (→ or ->) OR indicate utility/any-time/meta position OR show deprecated
        expect(content).toMatch(/\*\*Workflow Position:\*\*.*(→|->|any time|DEPRECATED|\[any\]|meta)/);
      });

      it('should list related commands', () => {
        const content = commandContents.get(commandName);
        expect(content).toBeDefined();
        expect(content).toMatch(/\*\*Related Commands:\*\*/);
        expect(content).toMatch(/`\/oss:[a-z-]+`/);
      });
    });
  });
});

describe('Command Help Documentation - All Commands Baseline', () => {
  let allCommands: string[];

  beforeAll(() => {
    // Get all command files
    allCommands = fs.readdirSync(COMMANDS_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
  });

  it('should have correct number of commands (53)', () => {
    expect(allCommands.length).toBe(53);
  });

  it('commands directory should exist', () => {
    expect(fs.existsSync(COMMANDS_DIR)).toBe(true);
  });
});
