/**
 * Spec Parser
 *
 * Parses specification files with HTML comment markers to extract
 * components, acceptance criteria, and behavioral specifications.
 *
 * @behavior Parser extracts spec items from markdown files using HTML comment markers
 * @acceptance-criteria AC-SPEC-PARSER.1 through AC-SPEC-PARSER.8
 */
import { SpecItem, SpecSection, ParsedSpec } from './types.js';
/**
 * Parse a single line into a SpecItem.
 *
 * Supported formats:
 * - Components: `- [x] ComponentName - Description`
 * - Criteria: `- [ ] SC-001: Description`
 * - Behaviors: `- Behavior description in prose`
 *
 * @param line - The line to parse
 * @param type - The expected item type based on section
 * @returns SpecItem or null if line is invalid
 */
export declare function parseSpecItem(line: string, type: SpecItem['type']): SpecItem | null;
/**
 * Extract content between spec markers.
 *
 * Markers have the format:
 * <!-- spec:name -->
 * content
 * <!-- /spec:name -->
 *
 * @param content - The full file content
 * @param markerName - The marker name (e.g., "components")
 * @returns The content between markers, or empty string if not found
 */
export declare function extractMarkerContent(content: string, markerName: string): string;
/**
 * Parse a spec section from extracted content.
 *
 * @param content - The content between markers (not including markers)
 * @param marker - The marker name for this section
 * @returns Parsed SpecSection
 */
export declare function parseSpecSection(content: string, marker: string): SpecSection;
/**
 * Parse a complete spec file.
 *
 * @param content - The full markdown file content
 * @param featureName - The feature name for this spec
 * @returns Parsed specification with all sections
 */
export declare function parseSpecFile(content: string, featureName: string): ParsedSpec;
//# sourceMappingURL=parser.d.ts.map