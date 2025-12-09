import { exec } from 'child_process';
import { promisify } from 'util';
/**
 * Promisified version of child_process.exec
 * Returns stdout and stderr as strings
 */
export const execAsync = promisify(exec);
//# sourceMappingURL=exec.js.map