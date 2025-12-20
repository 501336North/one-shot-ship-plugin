/**
 * Plugin Command File Validation
 * Validates debug.md command file structure
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * Validate command file has all required sections
 */
export declare function validateCommandFile(content: string): ValidationResult;
//# sourceMappingURL=plugin.d.ts.map