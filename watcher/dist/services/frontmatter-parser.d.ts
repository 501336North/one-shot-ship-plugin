/**
 * FrontmatterParser - Extract YAML frontmatter from markdown files
 *
 * @behavior Extracts model and other fields from markdown frontmatter
 * @acceptance-criteria AC-FRONTMATTER.1 through AC-FRONTMATTER.3
 */
/**
 * Data extracted from frontmatter
 */
export interface FrontmatterData {
    /** Prompt name */
    name?: string;
    /** Prompt description */
    description?: string;
    /** Model identifier for this prompt */
    model?: string;
    /** Whether to fallback to Claude on model failure */
    model_fallback?: boolean;
    /** Allow any other fields */
    [key: string]: unknown;
}
/**
 * Parse YAML frontmatter from markdown content
 *
 * @param content - The markdown content to parse
 * @returns Parsed frontmatter data or empty object if no frontmatter
 */
export declare function parseFrontmatter(content: string): FrontmatterData;
//# sourceMappingURL=frontmatter-parser.d.ts.map