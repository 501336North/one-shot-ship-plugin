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
const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
const KEYWORDS = new Set([
    'type', 'required', 'properties', 'additionalProperties', 'enum', 'pattern', 'maxLength',
    'maxItems', 'minItems', 'minimum', 'items', '$ref', '$schema', '$id', '$defs', 'title', 'description',
]);
const MAX_PATTERN = 200;
function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function fail(code, detail) {
    throw new Error(`${code}: ${detail}`);
}
function num(v, kw) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        fail('bad_schema', `${kw} must be a number`);
    return v;
}
function parseRef(ref) {
    const m = /^([^#]*)#\/\$defs\/([^/]+)$/.exec(ref);
    if (!m)
        fail('unresolved_ref', ref);
    return { doc: m[1], def: m[2] };
}
export function loadSchema(json, refs = {}) {
    const localRefs = [];
    let root;
    const compile = (node) => {
        if (!isObject(node))
            fail('bad_schema', 'schema node must be an object');
        const out = {};
        for (const [kw, v] of Object.entries(node)) {
            if (!KEYWORDS.has(kw))
                fail('unsupported_keyword', kw);
            switch (kw) {
                case 'type': {
                    const list = Array.isArray(v) ? v : [v];
                    for (const t of list) {
                        if (!TYPES.includes(t))
                            fail('bad_schema', `type ${String(t)}`);
                    }
                    out.type = list;
                    break;
                }
                case 'required':
                    if (!Array.isArray(v) || !v.every((r) => typeof r === 'string'))
                        fail('bad_schema', 'required');
                    out.required = v;
                    break;
                case 'properties':
                    if (!isObject(v))
                        fail('bad_schema', 'properties');
                    out.properties = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, compile(s)]));
                    break;
                case 'additionalProperties':
                    if (v !== false)
                        fail('unsupported_keyword', 'additionalProperties (only false is supported)');
                    out.closed = true;
                    break;
                case 'enum':
                    if (!Array.isArray(v))
                        fail('bad_schema', 'enum');
                    out.enum = v;
                    break;
                case 'pattern':
                    if (typeof v !== 'string')
                        fail('bad_schema', 'pattern');
                    if (v.length > MAX_PATTERN)
                        fail('pattern_too_long', `${v.length} > ${MAX_PATTERN}`);
                    out.pattern = new RegExp(`^(?:${v})$`, 'u');
                    break;
                case 'maxLength':
                case 'maxItems':
                case 'minItems':
                case 'minimum':
                    out[kw] = num(v, kw);
                    break;
                case 'items':
                    out.items = compile(v);
                    break;
                case '$defs':
                    if (!isObject(v))
                        fail('bad_schema', '$defs');
                    out.defs = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, compile(s)]));
                    break;
                case '$ref': {
                    if (typeof v !== 'string')
                        fail('bad_schema', '$ref');
                    const { doc, def } = parseRef(v);
                    if (doc === '') {
                        localRefs.push(def);
                        out.ref = () => root?.defs?.[def];
                    }
                    else {
                        const target = refs[doc]?.defs?.[def];
                        if (!target)
                            fail('unresolved_ref', v);
                        out.ref = () => target;
                    }
                    break;
                }
                default:
                    break; // annotations: $schema, $id, title, description
            }
        }
        return out;
    };
    root = compile(json);
    for (const def of localRefs) {
        if (!root.defs?.[def])
            fail('unresolved_ref', `#/$defs/${def}`);
    }
    return root;
}
function typeMatches(t, v) {
    switch (t) {
        case 'null': return v === null;
        case 'array': return Array.isArray(v);
        case 'object': return isObject(v);
        case 'integer': return Number.isInteger(v);
        case 'number': return typeof v === 'number' && Number.isFinite(v);
        default: return typeof v === t;
    }
}
/** Length in code points; avoids spreading a huge string (UTF-16 length is at most 2x). */
function tooLong(v, max) {
    if (v.length <= max)
        return false;
    if (v.length > 2 * max)
        return true;
    return [...v].length > max;
}
function pathOf(frame, extra) {
    const segs = extra === undefined ? [] : [extra];
    for (let f = frame; f; f = f.parent)
        segs.push(f.seg);
    return '$' + segs.reverse().join('');
}
function key(k) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
}
export function validate(schema, value) {
    const stack = [{ schema, value, seg: '' }];
    while (stack.length > 0) {
        const f = stack.pop();
        let s = f.schema;
        const v = f.value;
        while (s.ref)
            s = s.ref();
        const bad = (rule, extra) => ({ ok: false, path: pathOf(f, extra), rule });
        if (s.type && !s.type.some((t) => typeMatches(t, v)))
            return bad('type');
        if (s.enum && !s.enum.some((e) => e === v))
            return bad('enum');
        if (typeof v === 'string') {
            if (s.maxLength !== undefined && tooLong(v, s.maxLength))
                return bad('maxLength');
            if (s.pattern && !s.pattern.test(v))
                return bad('pattern');
        }
        if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum)
            return bad('minimum');
        if (Array.isArray(v)) {
            if (s.maxItems !== undefined && v.length > s.maxItems)
                return bad('maxItems');
            if (s.minItems !== undefined && v.length < s.minItems)
                return bad('minItems');
        }
        const children = [];
        if (isObject(v)) {
            for (const r of s.required ?? []) {
                if (!Object.prototype.hasOwnProperty.call(v, r))
                    return bad('required', key(r));
            }
            if (s.closed) {
                for (const k of Object.keys(v)) {
                    if (!s.properties || !Object.prototype.hasOwnProperty.call(s.properties, k)) {
                        return bad('additionalProperties', key(k));
                    }
                }
            }
            for (const [k, sub] of Object.entries(s.properties ?? {})) {
                if (Object.prototype.hasOwnProperty.call(v, k)) {
                    children.push({ schema: sub, value: v[k], parent: f, seg: key(k) });
                }
            }
        }
        if (Array.isArray(v) && s.items) {
            const items = s.items;
            v.forEach((item, i) => children.push({ schema: items, value: item, parent: f, seg: `[${i}]` }));
        }
        // Push in reverse so the first child is checked first.
        for (let i = children.length - 1; i >= 0; i--)
            stack.push(children[i]);
    }
    return { ok: true };
}
//# sourceMappingURL=validate.js.map