/**
 * Plugin Command File Validation
 * Validates debug.md command file structure
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const REQUIRED_SECTIONS = [
  'Context Management',
  'Check Authentication',
  'Initialize Logging',
  'Fetch IRON LAWS',
  'Send Start Notification',
  'Fetch Prompt from API',
  'Send Milestone Notifications',
  'Command Chain',
  'Error Handling',
];

/**
 * Validate command file has all required sections
 */
export function validateCommandFile(content: string): ValidationResult {
  const errors: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      errors.push(`Missing section: ${section}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
