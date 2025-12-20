/**
 * Debug Documentation Generator
 * Generates DEBUG.md from investigation results
 */
import type { ConfirmedBug } from './reproduction.js';
export interface DebugData {
    bug: ConfirmedBug;
    testPath: string;
    investigation: string;
}
/**
 * Generate DEBUG.md content from debug data
 */
export declare function generateDebugDoc(data: DebugData): string;
//# sourceMappingURL=documentation.d.ts.map