/**
 * Spec Parser Tests
 *
 * @behavior Parser extracts spec items from markdown files using HTML comment markers
 * @acceptance-criteria AC-SPEC-PARSER.1 through AC-SPEC-PARSER.8
 */

import { describe, it, expect } from 'vitest';
import {
  parseSpecFile,
  parseSpecSection,
  parseSpecItem,
  extractMarkerContent,
} from '../../../src/services/spec-reconciler/parser.js';

describe('Spec Parser', () => {
  describe('parseSpecItem', () => {
    it('parses checked component item', () => {
      const item = parseSpecItem('- [x] AuthService - Handles authentication', 'component');

      expect(item).toEqual({
        id: 'AuthService',
        description: 'Handles authentication',
        status: 'checked',
        type: 'component',
      });
    });

    it('parses unchecked component item', () => {
      const item = parseSpecItem('- [ ] UserRepo - Database access', 'component');

      expect(item).not.toBeNull();
      expect(item?.status).toBe('unchecked');
      expect(item?.id).toBe('UserRepo');
      expect(item?.description).toBe('Database access');
    });

    it('parses criterion item with ID prefix', () => {
      const item = parseSpecItem('- [ ] SC-001: User can login with valid credentials', 'criterion');

      expect(item).toEqual({
        id: 'SC-001',
        description: 'User can login with valid credentials',
        status: 'unchecked',
        type: 'criterion',
      });
    });

    it('parses checked criterion item', () => {
      const item = parseSpecItem('- [x] AC-002: System validates email format', 'criterion');

      expect(item?.status).toBe('checked');
      expect(item?.id).toBe('AC-002');
    });

    it('parses behavior item as prose', () => {
      const item = parseSpecItem('- System validates email format before submission', 'behavior');

      expect(item).not.toBeNull();
      expect(item?.type).toBe('behavior');
      expect(item?.description).toBe('System validates email format before submission');
      expect(item?.status).toBe('unchecked');
    });

    it('returns null for invalid lines', () => {
      expect(parseSpecItem('Not a valid item', 'component')).toBeNull();
      expect(parseSpecItem('', 'component')).toBeNull();
      expect(parseSpecItem('   ', 'component')).toBeNull();
    });

    it('returns null for lines without checkbox', () => {
      expect(parseSpecItem('* Just a bullet point', 'component')).toBeNull();
    });

    it('handles whitespace around components', () => {
      const item = parseSpecItem('  - [x]   AuthService   -   Handles auth  ', 'component');

      expect(item?.id).toBe('AuthService');
      expect(item?.description).toBe('Handles auth');
    });

    it('handles uppercase X in checkbox', () => {
      const item = parseSpecItem('- [X] Service - Description', 'component');

      expect(item?.status).toBe('checked');
    });
  });

  describe('extractMarkerContent', () => {
    it('extracts content between markers', () => {
      const content = `
# Feature

Some intro text

<!-- spec:components -->
- [x] Service - Does something
- [ ] Repo - Data access
<!-- /spec:components -->

More text
`;
      const extracted = extractMarkerContent(content, 'components');

      expect(extracted).toContain('Service');
      expect(extracted).toContain('Repo');
      expect(extracted).not.toContain('intro text');
      expect(extracted).not.toContain('More text');
    });

    it('returns empty string when marker not found', () => {
      const content = '# No markers here';
      const extracted = extractMarkerContent(content, 'components');

      expect(extracted).toBe('');
    });

    it('returns empty string when closing marker missing', () => {
      const content = `
<!-- spec:components -->
- [x] Service - Description
`;
      const extracted = extractMarkerContent(content, 'components');

      expect(extracted).toBe('');
    });

    it('handles markers with extra whitespace', () => {
      const content = `
<!--  spec:components  -->
- [x] Service - Description
<!--  /spec:components  -->
`;
      const extracted = extractMarkerContent(content, 'components');

      expect(extracted).toContain('Service');
    });
  });

  describe('parseSpecSection', () => {
    it('parses section with multiple items', () => {
      const content = `
- [x] AuthService - Handles authentication
- [ ] UserRepo - Database access
- [x] TokenManager - JWT operations
`;
      const section = parseSpecSection(content, 'components');

      expect(section.marker).toBe('components');
      expect(section.items).toHaveLength(3);
      expect(section.items[0].id).toBe('AuthService');
      expect(section.items[1].id).toBe('UserRepo');
      expect(section.items[2].id).toBe('TokenManager');
    });

    it('preserves raw content', () => {
      const content = `- [x] Service - Description`;
      const section = parseSpecSection(content, 'components');

      expect(section.raw).toBe(content);
    });

    it('handles empty content', () => {
      const section = parseSpecSection('', 'components');

      expect(section.items).toHaveLength(0);
      expect(section.raw).toBe('');
    });

    it('filters out invalid lines', () => {
      const content = `
- [x] Valid - Description
This is not a valid item
- [ ] AlsoValid - Another desc
      `;
      const section = parseSpecSection(content, 'components');

      expect(section.items).toHaveLength(2);
    });

    it('determines item type based on marker', () => {
      const criteriaContent = `- [ ] SC-001: User can login`;
      const section = parseSpecSection(criteriaContent, 'criteria');

      expect(section.items[0].type).toBe('criterion');
    });
  });

  describe('parseSpecFile', () => {
    it('extracts all three sections from complete spec file', () => {
      const content = `
# Feature: User Authentication

This feature handles user login.

<!-- spec:components -->
- [x] AuthService - Handles authentication
- [ ] UserRepo - Database access
<!-- /spec:components -->

## Acceptance Criteria

<!-- spec:criteria -->
- [ ] SC-001: User can login with valid credentials
- [x] SC-002: Invalid credentials show error
<!-- /spec:criteria -->

## Behavioral Specs

<!-- spec:behaviors -->
- System validates email format before submission
- Password must be at least 8 characters
<!-- /spec:behaviors -->
`;
      const spec = parseSpecFile(content, 'user-auth');

      expect(spec.feature).toBe('user-auth');
      expect(spec.components.items).toHaveLength(2);
      expect(spec.criteria.items).toHaveLength(2);
      expect(spec.behaviors.items).toHaveLength(2);
    });

    it('handles missing sections gracefully', () => {
      const content = `
# Feature

<!-- spec:components -->
- [x] Service - Description
<!-- /spec:components -->
`;
      const spec = parseSpecFile(content, 'partial-feature');

      expect(spec.components.items).toHaveLength(1);
      expect(spec.criteria.items).toHaveLength(0);
      expect(spec.behaviors.items).toHaveLength(0);
    });

    it('handles empty file', () => {
      const spec = parseSpecFile('', 'empty-feature');

      expect(spec.feature).toBe('empty-feature');
      expect(spec.components.items).toHaveLength(0);
      expect(spec.criteria.items).toHaveLength(0);
      expect(spec.behaviors.items).toHaveLength(0);
    });

    it('handles file with no markers', () => {
      const content = `
# Feature Documentation

This is just documentation with no spec markers.
      `;
      const spec = parseSpecFile(content, 'docs-only');

      expect(spec.components.items).toHaveLength(0);
      expect(spec.criteria.items).toHaveLength(0);
      expect(spec.behaviors.items).toHaveLength(0);
    });

    it('correctly counts checked vs unchecked items', () => {
      const content = `
<!-- spec:components -->
- [x] Implemented - Done
- [x] AlsoImplemented - Done too
- [ ] NotYet - Pending
<!-- /spec:components -->
`;
      const spec = parseSpecFile(content, 'count-test');
      const checkedCount = spec.components.items.filter((i) => i.status === 'checked').length;
      const uncheckedCount = spec.components.items.filter((i) => i.status === 'unchecked').length;

      expect(checkedCount).toBe(2);
      expect(uncheckedCount).toBe(1);
    });

    it('preserves section raw content for modification', () => {
      const content = `
<!-- spec:components -->
- [x] Service - Description
<!-- /spec:components -->
`;
      const spec = parseSpecFile(content, 'raw-test');

      expect(spec.components.raw).toContain('Service - Description');
    });
  });
});
