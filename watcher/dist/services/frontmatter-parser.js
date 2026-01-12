/**
 * FrontmatterParser - Extract YAML frontmatter from markdown files
 *
 * @behavior Extracts model and other fields from markdown frontmatter
 * @acceptance-criteria AC-FRONTMATTER.1 through AC-FRONTMATTER.3
 */
/**
 * Frontmatter delimiter
 */
const DELIMITER = '---';
/**
 * Parse YAML frontmatter from markdown content
 *
 * @param content - The markdown content to parse
 * @returns Parsed frontmatter data or empty object if no frontmatter
 */
export function parseFrontmatter(content) {
    if (!content || content.length === 0) {
        return {};
    }
    // Normalize line endings
    const normalizedContent = content.replace(/\r\n/g, '\n');
    // Check if content starts with frontmatter delimiter
    if (!normalizedContent.startsWith(DELIMITER)) {
        return {};
    }
    // Find the closing delimiter
    const endIndex = normalizedContent.indexOf(`\n${DELIMITER}`, DELIMITER.length);
    if (endIndex === -1) {
        return {};
    }
    // Extract the YAML content between delimiters
    const yamlContent = normalizedContent.substring(DELIMITER.length + 1, // Skip opening delimiter and newline
    endIndex);
    // Parse YAML manually (simple key-value pairs)
    return parseSimpleYaml(yamlContent);
}
/**
 * Parse simple YAML content (key: value pairs)
 * This is a lightweight parser that handles common frontmatter patterns
 */
function parseSimpleYaml(yamlContent) {
    const result = {};
    const lines = yamlContent.split('\n');
    let currentKey = null;
    let currentArray = null;
    for (const line of lines) {
        const trimmedLine = line.trim();
        // Skip empty lines
        if (!trimmedLine) {
            continue;
        }
        // Check if this is an array item
        if (trimmedLine.startsWith('- ') && currentKey && currentArray) {
            const value = trimmedLine.substring(2).trim();
            currentArray.push(parseValue(value));
            continue;
        }
        // Check for key: value pattern
        const colonIndex = trimmedLine.indexOf(':');
        if (colonIndex === -1) {
            continue;
        }
        // Check if this looks like a valid key (no colons before the first one)
        const key = trimmedLine.substring(0, colonIndex).trim();
        if (!key || key.includes(':')) {
            // This might be malformed YAML, skip it
            continue;
        }
        const valueStr = trimmedLine.substring(colonIndex + 1).trim();
        // Finalize previous array if we were building one
        if (currentKey && currentArray) {
            result[currentKey] = currentArray;
            currentArray = null;
        }
        currentKey = key;
        // Check if this starts an array
        if (!valueStr) {
            currentArray = [];
            continue;
        }
        // Parse the value
        result[key] = parseValue(valueStr);
        currentKey = null;
        currentArray = null;
    }
    // Finalize any remaining array
    if (currentKey && currentArray) {
        result[currentKey] = currentArray;
    }
    return result;
}
/**
 * Parse a YAML value string
 */
function parseValue(valueStr) {
    // Handle booleans
    if (valueStr === 'true') {
        return true;
    }
    if (valueStr === 'false') {
        return false;
    }
    // Handle numbers
    const num = Number(valueStr);
    if (!isNaN(num) && valueStr !== '') {
        return num;
    }
    // Handle null
    if (valueStr === 'null' || valueStr === '~') {
        return null;
    }
    // Handle quoted strings
    if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
        return valueStr.slice(1, -1);
    }
    // Return as string
    return valueStr;
}
//# sourceMappingURL=frontmatter-parser.js.map