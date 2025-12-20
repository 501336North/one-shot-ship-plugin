/**
 * Plugin Command File Integration Tests
 * Tests validation of debug.md command file structure
 */

import { describe, it, expect } from 'vitest';
import { validateCommandFile } from '../../src/debug/plugin.js';

describe('Plugin Command File Validation', () => {
  describe('validateCommandFile', () => {
    it('should validate command file has all required sections', () => {
      const content = `
---
description: Systematic debugging workflow
---

# /oss:debug

## Context Management
Context gate section

## Step 1: Check Authentication
Auth check section

## Step 2: Initialize Logging
Logging init section

## Step 3: Fetch IRON LAWS (MANDATORY)
IRON LAWS fetch section

## Step 4: Send Start Notification
Start notification section

## Step 5: Fetch Prompt from API
API prompt fetch section

## Step 6: Send Milestone Notifications
Notification hooks section

## Command Chain
debug → build → ship

## Error Handling
Error handling section
`;

      const result = validateCommandFile(content);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should include context management gate', () => {
      const contentWithoutGate = `
---
description: Test
---

# /oss:debug

## Step 1: Check Authentication
Auth section

## Error Handling
Error section
`;

      const result = validateCommandFile(contentWithoutGate);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing section: Context Management');
    });

    it('should include command chain documentation', () => {
      const contentWithoutChain = `
---
description: Test
---

# /oss:debug

## Context Management
Gate section

## Step 1: Check Authentication
Auth section

## Error Handling
Error section
`;

      const result = validateCommandFile(contentWithoutChain);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing section: Command Chain');
    });

    it('should reject if missing IRON LAWS fetch section', () => {
      const contentWithoutIronLaws = `
---
description: Test
---

# /oss:debug

## Context Management
Gate section

## Step 1: Check Authentication
Auth section

## Command Chain
Chain section

## Error Handling
Error section
`;

      const result = validateCommandFile(contentWithoutIronLaws);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing section: Fetch IRON LAWS');
    });

    it('should reject if missing notification sections', () => {
      const contentWithoutNotifications = `
---
description: Test
---

# /oss:debug

## Context Management
Gate section

## Step 1: Check Authentication
Auth section

## Step 3: Fetch IRON LAWS (MANDATORY)
IRON LAWS section

## Command Chain
Chain section

## Error Handling
Error section
`;

      const result = validateCommandFile(contentWithoutNotifications);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing section: Send Start Notification');
    });
  });
});
