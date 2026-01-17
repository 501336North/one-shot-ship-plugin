/**
 * Auto-Fixer Tests
 *
 * @behavior AutoFixer performs automatic fixes for simple drift cases
 * @acceptance-criteria AC-AUTO-FIXER.1 through AC-AUTO-FIXER.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { autoFixCheckbox } from '../../../src/services/spec-reconciler/auto-fixer.js';

describe('AutoFixer', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-fixer-test-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('autoFixCheckbox', () => {
    /**
     * @behavior autoFixCheckbox changes - [ ] to - [x] in spec file
     * @acceptance-criteria AC-AUTO-FIXER.1
     */
    it('changes - [ ] to - [x] in spec file', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      fs.writeFileSync(
        specPath,
        `# Feature

<!-- spec:components -->
- [ ] AuthService - Handles authentication
<!-- /spec:components -->
`,
      );

      const result = await autoFixCheckbox(specPath, 'AuthService');

      expect(result.success).toBe(true);
      expect(result.action).toBe('checkbox_checked');

      const updatedContent = fs.readFileSync(specPath, 'utf-8');
      expect(updatedContent).toContain('- [x] AuthService');
      expect(updatedContent).not.toContain('- [ ] AuthService');
    });

    /**
     * @behavior autoFixCheckbox preserves other content in file
     * @acceptance-criteria AC-AUTO-FIXER.2
     */
    it('preserves other content in file', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      const originalContent = `# Feature Title

Some description here.

<!-- spec:components -->
- [x] ExistingService - Already done
- [ ] TargetService - To be checked
- [ ] OtherService - Leave unchecked
<!-- /spec:components -->

## Notes

Additional notes that should be preserved.
`;
      fs.writeFileSync(specPath, originalContent);

      const result = await autoFixCheckbox(specPath, 'TargetService');

      expect(result.success).toBe(true);

      const updatedContent = fs.readFileSync(specPath, 'utf-8');

      // Check other content is preserved
      expect(updatedContent).toContain('# Feature Title');
      expect(updatedContent).toContain('Some description here.');
      expect(updatedContent).toContain('## Notes');
      expect(updatedContent).toContain('Additional notes that should be preserved.');

      // Check other checkboxes are not affected
      expect(updatedContent).toContain('- [x] ExistingService');
      expect(updatedContent).toContain('- [ ] OtherService');

      // Check target was updated
      expect(updatedContent).toContain('- [x] TargetService');
    });

    /**
     * @behavior autoFixCheckbox returns success result with details
     * @acceptance-criteria AC-AUTO-FIXER.3
     */
    it('returns success result with details', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      fs.writeFileSync(
        specPath,
        `<!-- spec:components -->
- [ ] MyComponent - Description
<!-- /spec:components -->
`,
      );

      const result = await autoFixCheckbox(specPath, 'MyComponent');

      expect(result.success).toBe(true);
      expect(result.action).toBe('checkbox_checked');
      expect(result.details).toContain('MyComponent');
    });

    /**
     * @behavior autoFixCheckbox returns failure when item not found
     * @acceptance-criteria AC-AUTO-FIXER.4
     */
    it('returns failure when item not found', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      fs.writeFileSync(
        specPath,
        `<!-- spec:components -->
- [ ] SomeOtherComponent - Description
<!-- /spec:components -->
`,
      );

      const result = await autoFixCheckbox(specPath, 'NonExistentComponent');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not found');
      expect(result.action).toBeUndefined();
    });

    /**
     * @behavior autoFixCheckbox returns failure when file does not exist
     * @acceptance-criteria AC-AUTO-FIXER.5
     */
    it('returns failure when file does not exist', async () => {
      const specPath = path.join(testDir, 'NONEXISTENT.md');

      const result = await autoFixCheckbox(specPath, 'SomeComponent');

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not');
    });

    /**
     * @behavior autoFixCheckbox does not modify already checked items
     * @acceptance-criteria AC-AUTO-FIXER.6
     */
    it('does not modify already checked items', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      const originalContent = `<!-- spec:components -->
- [x] AlreadyChecked - Description
<!-- /spec:components -->
`;
      fs.writeFileSync(specPath, originalContent);

      const result = await autoFixCheckbox(specPath, 'AlreadyChecked');

      // Should still succeed but no change needed
      expect(result.success).toBe(true);

      const updatedContent = fs.readFileSync(specPath, 'utf-8');
      expect(updatedContent).toBe(originalContent);
    });

    /**
     * @behavior autoFixCheckbox handles uppercase X correctly
     * @acceptance-criteria AC-AUTO-FIXER.7
     */
    it('handles mixed case component names', async () => {
      const specPath = path.join(testDir, 'DESIGN.md');
      fs.writeFileSync(
        specPath,
        `<!-- spec:components -->
- [ ] UserAuthenticationService - Handles user auth
<!-- /spec:components -->
`,
      );

      const result = await autoFixCheckbox(specPath, 'UserAuthenticationService');

      expect(result.success).toBe(true);
      expect(result.action).toBe('checkbox_checked');

      const updatedContent = fs.readFileSync(specPath, 'utf-8');
      expect(updatedContent).toContain('- [x] UserAuthenticationService');
    });
  });
});
