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
export function parseSpecItem(line: string, type: SpecItem['type']): SpecItem | null {
  const trimmed = line.trim();

  if (!trimmed || trimmed.length === 0) {
    return null;
  }

  // Check for checkbox pattern: - [x] or - [ ] or - [X]
  const checkboxMatch = trimmed.match(/^-\s*\[([xX ])\]\s*(.+)$/);

  if (checkboxMatch) {
    const isChecked = checkboxMatch[1].toLowerCase() === 'x';
    const content = checkboxMatch[2].trim();

    if (type === 'component') {
      // Component format: ComponentName - Description
      const componentMatch = content.match(/^(\S+)\s*-\s*(.+)$/);
      if (componentMatch) {
        return {
          id: componentMatch[1].trim(),
          description: componentMatch[2].trim(),
          status: isChecked ? 'checked' : 'unchecked',
          type: 'component',
        };
      }
    } else if (type === 'criterion') {
      // Criterion format: SC-001: Description or AC-002: Description
      const criterionMatch = content.match(/^([A-Z]+-\d+):\s*(.+)$/);
      if (criterionMatch) {
        return {
          id: criterionMatch[1],
          description: criterionMatch[2].trim(),
          status: isChecked ? 'checked' : 'unchecked',
          type: 'criterion',
        };
      }
    }
  }

  // For behaviors, check for simple bullet format without checkbox
  if (type === 'behavior') {
    // Try checkbox format first
    if (checkboxMatch) {
      const content = checkboxMatch[2].trim();
      const isChecked = checkboxMatch[1].toLowerCase() === 'x';
      return {
        id: generateBehaviorId(content),
        description: content,
        status: isChecked ? 'checked' : 'unchecked',
        type: 'behavior',
      };
    }

    // Simple bullet format: - Description
    const bulletMatch = trimmed.match(/^-\s+(.+)$/);
    if (bulletMatch) {
      const content = bulletMatch[1].trim();
      return {
        id: generateBehaviorId(content),
        description: content,
        status: 'unchecked',
        type: 'behavior',
      };
    }
  }

  return null;
}

/**
 * Generate a unique ID for a behavior based on its description.
 */
function generateBehaviorId(description: string): string {
  // Create a simple hash-like ID from the description
  const words = description.toLowerCase().split(/\s+/).slice(0, 3);
  return `BEH-${words.join('-').replace(/[^a-z0-9-]/g, '')}`;
}

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
export function extractMarkerContent(content: string, markerName: string): string {
  // Match with optional whitespace: <!-- spec:name --> or <!--  spec:name  -->
  const startPattern = new RegExp(`<!--\\s*spec:${markerName}\\s*-->`, 'i');
  const endPattern = new RegExp(`<!--\\s*/spec:${markerName}\\s*-->`, 'i');

  const startMatch = content.match(startPattern);
  if (!startMatch || startMatch.index === undefined) {
    return '';
  }

  const startIndex = startMatch.index + startMatch[0].length;
  const remainingContent = content.substring(startIndex);

  const endMatch = remainingContent.match(endPattern);
  if (!endMatch || endMatch.index === undefined) {
    return '';
  }

  return remainingContent.substring(0, endMatch.index).trim();
}

/**
 * Determine the item type for a section based on marker name.
 */
function getItemTypeForMarker(marker: string): SpecItem['type'] {
  switch (marker) {
    case 'components':
      return 'component';
    case 'criteria':
      return 'criterion';
    case 'behaviors':
      return 'behavior';
    default:
      return 'component';
  }
}

/**
 * Parse a spec section from extracted content.
 *
 * @param content - The content between markers (not including markers)
 * @param marker - The marker name for this section
 * @returns Parsed SpecSection
 */
export function parseSpecSection(content: string, marker: string): SpecSection {
  const itemType = getItemTypeForMarker(marker);
  const lines = content.split('\n');
  const items: SpecItem[] = [];

  for (const line of lines) {
    const item = parseSpecItem(line, itemType);
    if (item) {
      items.push(item);
    }
  }

  return {
    marker,
    items,
    raw: content,
  };
}

/**
 * Parse a complete spec file.
 *
 * @param content - The full markdown file content
 * @param featureName - The feature name for this spec
 * @returns Parsed specification with all sections
 */
export function parseSpecFile(content: string, featureName: string): ParsedSpec {
  const componentsContent = extractMarkerContent(content, 'components');
  const criteriaContent = extractMarkerContent(content, 'criteria');
  const behaviorsContent = extractMarkerContent(content, 'behaviors');

  return {
    feature: featureName,
    components: parseSpecSection(componentsContent, 'components'),
    criteria: parseSpecSection(criteriaContent, 'criteria'),
    behaviors: parseSpecSection(behaviorsContent, 'behaviors'),
  };
}
