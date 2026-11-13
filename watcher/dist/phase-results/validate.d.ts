/**
 * Keyword-subset JSON Schema validator (R-257 D5, S8). No dependency.
 *
 * Supported: type, required, properties, additionalProperties (false only), enum, pattern,
 * maxLength, maxItems, minItems, minimum, items, $ref. Annotations: $schema, $id, $defs,
 * title, description. Anything else is refused at load with `unsupported_keyword`.
 *
 * $ref forms: "#/$defs/<name>" (same document) and "<doc>#/$defs/<name>", where <doc> is a key
 * of the `refs` map given to loadSchema (e.g. "common.schema.json").
 *
 * Patterns compile as ^(?:p)$ with the `u` flag, at most 200 characters. The walk is iterative and
 * driven by the schema, so value depth never grows the call stack.
 */
declare const TYPES: readonly ["string", "number", "integer", "boolean", "object", "array", "null"];
type TypeName = (typeof TYPES)[number];
export interface Schema {
    type?: TypeName[];
    required?: string[];
    properties?: Record<string, Schema>;
    closed?: boolean;
    enum?: unknown[];
    pattern?: RegExp;
    maxLength?: number;
    maxItems?: number;
    minItems?: number;
    minimum?: number;
    items?: Schema;
    ref?: () => Schema;
    defs?: Record<string, Schema>;
}
export type ValidationResult = {
    ok: true;
} | {
    ok: false;
    path: string;
    rule: string;
};
export declare function loadSchema(json: unknown, refs?: Record<string, Schema>): Schema;
export declare function validate(schema: Schema, value: unknown): ValidationResult;
export {};
//# sourceMappingURL=validate.d.ts.map