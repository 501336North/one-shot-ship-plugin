/**
 * Auto-Fixer
 *
 * Performs automatic fixes for simple drift cases, such as checking
 * checkboxes in spec files when the corresponding implementation exists.
 *
 * @behavior AutoFixer updates spec files to reflect implementation state
 * @acceptance-criteria AC-AUTO-FIXER.1 through AC-AUTO-FIXER.7
 */

import * as fs from 'fs';
import { AutoFixResult } from './types.js';

/**
 * Auto-fix a checkbox in a spec file by changing - [ ] to - [x].
 *
 * This is used when a component is marked as unchecked in the spec
 * but the implementation file already exists.
 *
 * @param specPath - Path to the spec file (e.g., DESIGN.md)
 * @param itemId - The ID of the item to check (e.g., "AuthService")
 * @returns Result of the auto-fix operation
 */
export async function autoFixCheckbox(specPath: string, itemId: string): Promise<AutoFixResult> {
  // Check if file exists
  if (!fs.existsSync(specPath)) {
    return {
      success: false,
      reason: `Spec file does not exist: ${specPath}`,
    };
  }

  // Read the spec file
  let content: string;
  try {
    content = await fs.promises.readFile(specPath, 'utf-8');
  } catch {
    return {
      success: false,
      reason: `Failed to read spec file: ${specPath}`,
    };
  }

  // Create a regex to find the unchecked item
  // Pattern: - [ ] ItemId - Description
  // We need to match specifically the item ID followed by a space and dash
  const uncheckedPattern = new RegExp(`^(\\s*-\\s*)\\[ \\](\\s*${escapeRegExp(itemId)}\\s*-)`, 'm');

  // Check if the item is already checked
  const checkedPattern = new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*${escapeRegExp(itemId)}\\s*-`, 'm');
  if (checkedPattern.test(content)) {
    // Already checked, no change needed
    return {
      success: true,
      action: 'checkbox_checked',
      details: `Item "${itemId}" was already checked`,
    };
  }

  // Check if the item exists at all
  if (!uncheckedPattern.test(content)) {
    return {
      success: false,
      reason: `Item "${itemId}" not found in spec file`,
    };
  }

  // Replace the unchecked box with checked
  const updatedContent = content.replace(uncheckedPattern, '$1[x]$2');

  // Write the updated content
  try {
    await fs.promises.writeFile(specPath, updatedContent, 'utf-8');
  } catch {
    return {
      success: false,
      reason: `Failed to write spec file: ${specPath}`,
    };
  }

  return {
    success: true,
    action: 'checkbox_checked',
    details: `Checked checkbox for "${itemId}" in spec file`,
  };
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
