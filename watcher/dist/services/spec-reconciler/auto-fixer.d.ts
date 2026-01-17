/**
 * Auto-Fixer
 *
 * Performs automatic fixes for simple drift cases, such as checking
 * checkboxes in spec files when the corresponding implementation exists.
 *
 * @behavior AutoFixer updates spec files to reflect implementation state
 * @acceptance-criteria AC-AUTO-FIXER.1 through AC-AUTO-FIXER.7
 */
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
export declare function autoFixCheckbox(specPath: string, itemId: string): Promise<AutoFixResult>;
//# sourceMappingURL=auto-fixer.d.ts.map