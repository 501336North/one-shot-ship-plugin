#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli/phase-result.ts
var phase_result_exports = {};
__export(phase_result_exports, {
  main: () => main
});
module.exports = __toCommonJS(phase_result_exports);
var import_node_child_process6 = require("node:child_process");
var fs11 = __toESM(require("node:fs"), 1);
var os2 = __toESM(require("node:os"), 1);
var path10 = __toESM(require("node:path"), 1);

// src/phase-results/assemble-build.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);

// src/phase-results/assemble-common.ts
var import_node_crypto = require("node:crypto");

// src/services/redaction.ts
var hasDigit = (match) => /[0-9]/.test(match);
var isAssignedSecret = (value, prefix, atLineEnd, next) => !(/^(?:bearer|basic)$/i.test(value) && /\s/.test(next)) && value.length >= 6 && (/["'=>]\s*$/.test(prefix) || prefix.startsWith("--") || atLineEnd && /:\s*$/.test(prefix) || hasDigit(value));
var SECRET_KEY_NAME = "(?:PASSWORD|PASSWD|PASSPHRASE|(?<!by|com|over|under|sur|tres)PASS|PWD|SECRET|TOKEN|CREDENTIALS|(?:API|SECRET|PRIVATE|ACCESS|SIGNING|ENCRYPTION|[_-])KEY)(?:[_-][A-Za-z0-9]+){0,2}";
function hasJwtShape(run) {
  const segments = run.split(".");
  for (let i = 0; i + 2 < segments.length; i++) {
    const header = segments[i];
    const start = header.indexOf("eyJ");
    if (start !== -1 && header.length - start >= 13 && segments[i + 1].startsWith("eyJ") && segments[i + 1].length >= 13 && segments[i + 2].length >= 10) {
      return true;
    }
  }
  return false;
}
var SECRET_PATTERNS = [
  // RSA/EC/OPENSSH/ENCRYPTED/PGP; through END, or to the end of the text when there is no END.
  {
    name: "private-key-block",
    pattern: /----- *BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)? *-----[\s\S]*?(?:----- *END [A-Z ]*PRIVATE KEY(?: BLOCK)? *-----|$)/gi
  },
  // The whole dotted run is redacted, so two glued JWTs go together and no fragment survives.
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_.-]*/g, isSecret: hasJwtShape },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "github-fine-grained-pat", pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "github-token", pattern: /gh[pousr]_(?:(?!gh[pousr]_)[A-Za-z0-9]){20,}/g },
  { name: "stripe-key", pattern: /[rs]k_(?:live|test)_(?:(?![rs]k_(?:live|test)_)[A-Za-z0-9]){16,}/g },
  { name: "aws-access-key-id", pattern: /A[KS]IA[0-9A-Z]{16}/g },
  { name: "npm-token", pattern: /npm_[A-Za-z0-9]{36}/g },
  { name: "gitlab-pat", pattern: /glpat-[A-Za-z0-9_-]{20,}/g },
  { name: "slack-app-token", pattern: /xapp-[A-Za-z0-9-]+/g },
  { name: "slack-token", pattern: /(?:xoxe\.)?xox[abeprs]-[A-Za-z0-9-]+/g },
  { name: "oss-api-key", pattern: /ak_[0-9a-f]{64}/g },
  {
    // The user may be empty (redis://:pw@host) and the password may hold / or @, so it runs to the
    // LAST @ before the host. The cap keeps a long run of "a://:a://:..." linear. A run of NULs (a token that
    // cleanAndRedactWithRemoved's mask already covers) counts as one character, as the shorter [REDACTED]
    // does in redactString, so the cap cannot stop short of the @ and leave the rest of the password readable.
    name: "connection-string-password",
    // eslint-disable-next-line no-control-regex -- the NUL is maskOf's placeholder, matched on purpose
    pattern: /([a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@]*:)(?:\u0000+(?!\u0000)|[^\s\u0000]){1,256}(?=@)/gi,
    keepPrefix: true
  },
  {
    // A secret-named key, then :, =, =>, :=, ?= or +=, or a --flag. The value decides, not the key: a
    // quoted value (taken whole, \" escapes included), a value after = or a --flag, a lone value ending its
    // line after :, or one holding a digit is a secret; anything else is prose ("Password: see vault").
    // Group 2 is set when the value ends its line. An unquoted value runs to the next space or quote, & included
    // (as in the API): a secret may itself hold "&k=", so ?api_key=x&foo=bar loses foo=bar on purpose.
    name: "secret-assignment",
    pattern: new RegExp(
      `((?<![A-Za-z0-9_-])(?:--[A-Za-z0-9_-]*${SECRET_KEY_NAME}\\s+|[A-Za-z0-9_-]*${SECRET_KEY_NAME}["']?\\s*(?:[:?+]?=>?|:)\\s*)["']?)(?:(?<=")(?:[^"\\\\\\n]|\\\\.)+(?=")|(?<=')(?:[^'\\\\\\n]|\\\\.)+(?=')|[^\\s"']+)(?=([ \\t]*(?:\\n|$))|)`,
      "gi"
    ),
    isSecret: isAssignedSecret,
    keepPrefix: true
  },
  { name: "bearer-token", pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, keepPrefix: true },
  {
    // After an Authorization (or Proxy-Authorization) key the value is always the credential. Elsewhere,
    // base64 of user:password nearly always holds a digit, + / or =; "Basic Authentication" does not.
    name: "basic-auth",
    pattern: /((?:Authorization["']?[ \t]*[:=][ \t]*["']?)?Basic\s+)[A-Za-z0-9+/]{12,}={0,2}/gi,
    isSecret: (value, prefix) => /^Authorization/i.test(prefix) || /[0-9+/=]/.test(value),
    keepPrefix: true
  },
  { name: "slack-webhook", pattern: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/]+/g },
  { name: "discord-webhook", pattern: /https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/(?:v[0-9]+\/)?webhooks\/[0-9]+\/[A-Za-z0-9_-]+/g },
  { name: "google-oauth-token", pattern: /ya29\.(?:(?!ya29\.)[A-Za-z0-9_-]){20,}/g },
  { name: "sendgrid-key", pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g },
  { name: "stripe-webhook-secret", pattern: /whsec_(?:(?!whsec_)[A-Za-z0-9+/=]){32,}/g },
  { name: "huggingface-token", pattern: /hf_(?:(?!hf_)[A-Za-z0-9]){34,}/g },
  { name: "telegram-bot-token", pattern: /[0-9]{8,10}:[A-Za-z0-9_-]{35}/g },
  // sk- refuses only a preceding letter: without it "task-runner-v2-..." would match; "9sk-..." is a glued key.
  { name: "sk-api-key", pattern: /(?<![A-Za-z])sk-[A-Za-z0-9_-]{20,}/g, isSecret: hasDigit },
  // --- the plugin's original list ---
  // Anthropic + generic `sk-` style keys (sk-ant-..., sk-...)
  { name: "sk-key", pattern: /sk-[A-Za-z0-9_-]{12,}/g },
  // Authorization header, ANY scheme (Bearer, Basic, Digest, Token, ...)
  { name: "authorization-header", pattern: /Authorization:\s*[A-Za-z]+\s+[^\s"']+/gi },
  // Bare bearer token
  { name: "bare-bearer", pattern: /Bearer\s+[^\s"']+/g },
  // JWTs: three base64url segments
  { name: "jwt-segments", pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  // Query-string / form secret params (access_token before token to win leftmost)
  { name: "secret-param", pattern: /(?:api[_-]?key|access[_-]?token|token|secret|password)=[^\s"'&]+/gi },
  // GitHub personal access tokens
  { name: "ghp", pattern: /ghp_[A-Za-z0-9]{20,}/g },
  // AWS access key IDs
  { name: "akia", pattern: /AKIA[A-Z0-9]{12,}/g },
  // Slack bot/user tokens
  { name: "slack-bot-user", pattern: /xox[bp]-[A-Za-z0-9-]+/g },
  // Google API keys
  { name: "google-api-key-legacy", pattern: /AIza[A-Za-z0-9_-]{20,}/g }
];
var MARKER = "[REDACTED]";
function applySecretPatterns(value, replace) {
  const removed = [];
  let text = value;
  for (const { pattern, isSecret, keepPrefix } of SECRET_PATTERNS) {
    text = text.replace(pattern, (match, ...groups) => {
      const prefix = keepPrefix ? String(groups[0]) : "";
      const atLineEnd = keepPrefix === true && typeof groups[1] === "string";
      const next = String(groups[groups.length - 1]).charAt(Number(groups[groups.length - 2]) + match.length);
      const secret = match.slice(prefix.length);
      if (isSecret && !isSecret(secret, prefix, atLineEnd, next)) return match;
      removed.push(secret);
      return `${prefix}${replace(secret)}`;
    });
  }
  return { text, removed };
}
function redactStringWithRemoved(value) {
  return applySecretPatterns(value, () => MARKER);
}
function redactString(value) {
  return redactStringWithRemoved(value).text;
}
var REPLACEMENT_CHAR = String.fromCharCode(65533);
var NUL = String.fromCharCode(0);
var NUL_RUN = new RegExp(`${NUL}+`, "g");

// src/phase-results/store.ts
var fs3 = __toESM(require("fs"), 1);
var path2 = __toESM(require("path"), 1);
var crypto = __toESM(require("crypto"), 1);
var import_child_process = require("child_process");

// src/phase-results/git-bin.ts
var fs = __toESM(require("node:fs"), 1);
var CANDIDATES = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git", "/bin/git"];
function gitBin() {
  for (const p of CANDIDATES) {
    try {
      if (!fs.statSync(p).isFile()) continue;
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
    }
  }
  return "";
}

// src/phase-results/schemas.ts
var fs2 = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);

// src/phase-results/validate.ts
var TYPES = ["string", "number", "integer", "boolean", "object", "array", "null"];
var KEYWORDS = /* @__PURE__ */ new Set([
  "type",
  "required",
  "properties",
  "additionalProperties",
  "enum",
  "pattern",
  "maxLength",
  "maxItems",
  "minItems",
  "minimum",
  "items",
  "$ref",
  "$schema",
  "$id",
  "$defs",
  "title",
  "description"
]);
var MAX_PATTERN = 200;
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function fail(code, detail) {
  throw new Error(`${code}: ${detail}`);
}
function num(v, kw) {
  if (typeof v !== "number" || !Number.isFinite(v)) fail("bad_schema", `${kw} must be a number`);
  return v;
}
function parseRef(ref) {
  const m = /^([^#]*)#\/\$defs\/([^/]+)$/.exec(ref);
  if (!m) fail("unresolved_ref", ref);
  return { doc: m[1], def: m[2] };
}
function loadSchema(json, refs = {}) {
  const localRefs = [];
  let root;
  const compile = (node) => {
    if (!isObject(node)) fail("bad_schema", "schema node must be an object");
    const out = {};
    for (const [kw, v] of Object.entries(node)) {
      if (!KEYWORDS.has(kw)) fail("unsupported_keyword", kw);
      switch (kw) {
        case "type": {
          const list = Array.isArray(v) ? v : [v];
          for (const t of list) {
            if (!TYPES.includes(t)) fail("bad_schema", `type ${String(t)}`);
          }
          out.type = list;
          break;
        }
        case "required":
          if (!Array.isArray(v) || !v.every((r) => typeof r === "string")) fail("bad_schema", "required");
          out.required = v;
          break;
        case "properties":
          if (!isObject(v)) fail("bad_schema", "properties");
          out.properties = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, compile(s)]));
          break;
        case "additionalProperties":
          if (v !== false) fail("unsupported_keyword", "additionalProperties (only false is supported)");
          out.closed = true;
          break;
        case "enum":
          if (!Array.isArray(v)) fail("bad_schema", "enum");
          out.enum = v;
          break;
        case "pattern":
          if (typeof v !== "string") fail("bad_schema", "pattern");
          if (v.length > MAX_PATTERN) fail("pattern_too_long", `${v.length} > ${MAX_PATTERN}`);
          out.pattern = new RegExp(`^(?:${v})$`, "u");
          break;
        case "maxLength":
        case "maxItems":
        case "minItems":
        case "minimum":
          out[kw] = num(v, kw);
          break;
        case "items":
          out.items = compile(v);
          break;
        case "$defs":
          if (!isObject(v)) fail("bad_schema", "$defs");
          out.defs = Object.fromEntries(Object.entries(v).map(([k, s]) => [k, compile(s)]));
          break;
        case "$ref": {
          if (typeof v !== "string") fail("bad_schema", "$ref");
          const { doc, def } = parseRef(v);
          if (doc === "") {
            localRefs.push(def);
            out.ref = () => root?.defs?.[def];
          } else {
            const target = refs[doc]?.defs?.[def];
            if (!target) fail("unresolved_ref", v);
            out.ref = () => target;
          }
          break;
        }
        default:
          break;
      }
    }
    return out;
  };
  root = compile(json);
  for (const def of localRefs) {
    if (!root.defs?.[def]) fail("unresolved_ref", `#/$defs/${def}`);
  }
  return root;
}
function typeMatches(t, v) {
  switch (t) {
    case "null":
      return v === null;
    case "array":
      return Array.isArray(v);
    case "object":
      return isObject(v);
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    default:
      return typeof v === t;
  }
}
function tooLong(v, max) {
  if (v.length <= max) return false;
  if (v.length > 2 * max) return true;
  return [...v].length > max;
}
function pathOf(frame, extra) {
  const segs = extra === void 0 ? [] : [extra];
  for (let f = frame; f; f = f.parent) segs.push(f.seg);
  return "$" + segs.reverse().join("");
}
function key(k) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`;
}
function validate(schema, value) {
  const stack = [{ schema, value, seg: "" }];
  while (stack.length > 0) {
    const f = stack.pop();
    let s = f.schema;
    const v = f.value;
    while (s.ref) s = s.ref();
    const bad = (rule, extra) => ({ ok: false, path: pathOf(f, extra), rule });
    if (s.type && !s.type.some((t) => typeMatches(t, v))) return bad("type");
    if (s.enum && !s.enum.some((e) => e === v)) return bad("enum");
    if (typeof v === "string") {
      if (s.maxLength !== void 0 && tooLong(v, s.maxLength)) return bad("maxLength");
      if (s.pattern && !s.pattern.test(v)) return bad("pattern");
    }
    if (typeof v === "number" && s.minimum !== void 0 && v < s.minimum) return bad("minimum");
    if (Array.isArray(v)) {
      if (s.maxItems !== void 0 && v.length > s.maxItems) return bad("maxItems");
      if (s.minItems !== void 0 && v.length < s.minItems) return bad("minItems");
    }
    const children = [];
    if (isObject(v)) {
      for (const r of s.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(v, r)) return bad("required", key(r));
      }
      if (s.closed) {
        for (const k of Object.keys(v)) {
          if (!s.properties || !Object.prototype.hasOwnProperty.call(s.properties, k)) {
            return bad("additionalProperties", key(k));
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
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return { ok: true };
}

// src/phase-results/schemas.ts
var PHASES = ["ideate", "plan", "build", "ship"];
function readSchemaFile(dir, name) {
  const file = fs2.realpathSync(path.join(dir, `${name}.schema.json`));
  if (path.dirname(file) !== dir) throw new Error(`unsafe_path: ${name}.schema.json`);
  return JSON.parse(fs2.readFileSync(file, "utf8"));
}
function loadPhaseSchema(phase, pluginRoot2) {
  if (!PHASES.includes(phase)) throw new Error(`unsafe_path: phase ${String(phase)}`);
  const dir = fs2.realpathSync(path.join(pluginRoot2, "schemas", "phase-results"));
  const common = loadSchema(readSchemaFile(dir, "common"));
  return loadSchema(readSchemaFile(dir, phase), { "common.schema.json": common });
}

// src/phase-results/store.ts
var FEATURE_RE = /^[A-Za-z0-9._-]+$/;
var RESULT_CAP = 256 * 1024;
var VALUE_CAP = 64 * 1024;
var VALUE_MAX_AGE_MS = 10 * 60 * 1e3;
var { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs3.constants;
function resolveRepo(cwd) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  env.PATH = "/usr/bin:/bin";
  const git2 = gitBin();
  if (git2 === "") return null;
  try {
    const top = (0, import_child_process.execFileSync)(git2, ["rev-parse", "--show-toplevel"], {
      cwd,
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2e3
    }).trim();
    return top === "" ? null : fs3.realpathSync(top);
  } catch {
    return null;
  }
}
function checkNames(feature, phase) {
  if (!FEATURE_RE.test(feature) || feature.startsWith(".")) throw new Error(`bad_feature: ${JSON.stringify(feature)}`);
  if (!PHASES.includes(phase)) throw new Error(`unsafe_path: unknown phase ${JSON.stringify(phase)}`);
}
function resultsDir(repo, feature, create, where = { kind: "active", name: feature }) {
  if (!FEATURE_RE.test(where.name) || where.name.startsWith(".")) throw new Error(`bad_feature: ${JSON.stringify(where.name)}`);
  let cur = repo;
  for (const comp of [".oss", "dev", where.kind, where.name, "results"]) {
    cur = path2.join(cur, comp);
    let st;
    try {
      st = fs3.lstatSync(cur);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (!create) return null;
      fs3.mkdirSync(cur, { mode: 448 });
      st = fs3.lstatSync(cur);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`unsafe_path: ${comp}`);
  }
  return cur;
}
function readCapped(fd, cap) {
  const buf = Buffer.alloc(cap + 1);
  let n = 0;
  while (n < buf.length) {
    const got = fs3.readSync(fd, buf, n, buf.length - n, null);
    if (got === 0) break;
    n += got;
  }
  return buf.subarray(0, n);
}
function sameDir(p, realDir, dirStat) {
  try {
    const st = fs3.lstatSync(p);
    return !st.isSymbolicLink() && st.isDirectory() && st.dev === dirStat.dev && st.ino === dirStat.ino && fs3.realpathSync(p) === realDir;
  } catch {
    return false;
  }
}
function isOurFile(p, ours) {
  try {
    const st = fs3.lstatSync(p);
    return st.isFile() && st.dev === ours.dev && st.ino === ours.ino;
  } catch {
    return false;
  }
}
function writeResult(repo, feature, phase, obj, hooks = {}, where) {
  checkNames(feature, phase);
  const data = JSON.stringify(obj);
  if (Buffer.byteLength(data) > RESULT_CAP) throw new Error("too_large: result over 256 KB");
  const dir = resultsDir(repo, feature, true, where);
  const realDir = fs3.realpathSync(dir);
  const dirStat = fs3.lstatSync(dir);
  const target = path2.join(dir, `${phase}.json`);
  try {
    if (fs3.lstatSync(target).isSymbolicLink()) throw new Error(`unsafe_path: ${phase}.json`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const tmp = path2.join(dir, `.${phase}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  const fd = fs3.openSync(tmp, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 384);
  let ours;
  try {
    fs3.writeSync(fd, data);
    fs3.fsyncSync(fd);
    ours = fs3.fstatSync(fd);
  } finally {
    fs3.closeSync(fd);
  }
  try {
    hooks.beforeRename?.(tmp);
  } catch (e) {
    if (isOurFile(tmp, ours)) fs3.unlinkSync(tmp);
    throw e;
  }
  if (!sameDir(path2.dirname(tmp), realDir, dirStat) || !sameDir(path2.dirname(target), realDir, dirStat) || !isOurFile(tmp, ours)) {
    throw new Error("unsafe_path: results/ moved during write");
  }
  try {
    fs3.renameSync(tmp, target);
  } catch (e) {
    if (isOurFile(tmp, ours)) fs3.unlinkSync(tmp);
    throw e;
  }
  const realTarget = fs3.realpathSync(target);
  if (path2.dirname(realTarget) !== realDir) {
    if (isOurFile(realTarget, ours)) fs3.unlinkSync(realTarget);
    throw new Error("unsafe_path: results/ moved during write");
  }
  return { dev: ours.dev, ino: ours.ino, bytes: Buffer.from(data) };
}
function readBack(repo, feature, phase, written, where) {
  const read = readResult(repo, feature, phase, where);
  if (!read.ok) return read;
  if (read.dev !== written.dev || read.ino !== written.ino || !read.bytes.equals(written.bytes)) {
    return { ok: false, error: "result_changed" };
  }
  return { ...read, bytes: written.bytes };
}
function clearUnverifiedMarker(repo, feature, phase, where) {
  checkNames(feature, phase);
  const dir = resultsDir(repo, feature, false, where);
  if (dir === null) return;
  try {
    fs3.unlinkSync(path2.join(dir, `${phase}.unverified.json`));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
function readResult(repo, feature, phase, where) {
  checkNames(feature, phase);
  let dir;
  try {
    dir = resultsDir(repo, feature, false, where);
  } catch {
    return { ok: false, error: "unsafe_path" };
  }
  if (dir === null) return { ok: false, error: "missing" };
  let fd;
  try {
    fd = fs3.openSync(path2.join(dir, `${phase}.json`), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    return { ok: false, error: e.code === "ENOENT" ? "missing" : "unsafe_path" };
  }
  try {
    const st = fs3.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.()) return { ok: false, error: "unsafe_path" };
    const bytes = readCapped(fd, RESULT_CAP);
    if (bytes.length > RESULT_CAP) return { ok: false, error: "too_large" };
    try {
      return { ok: true, bytes, value: JSON.parse(bytes.toString("utf-8")), dev: st.dev, ino: st.ino };
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  } finally {
    fs3.closeSync(fd);
  }
}
function readValueFile(dir, name) {
  let fd;
  try {
    fd = fs3.openSync(path2.join(dir, name), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fs3.fstatSync(fd);
    if (!st.isFile() || Date.now() - st.mtimeMs > VALUE_MAX_AGE_MS) return null;
    const bytes = readCapped(fd, VALUE_CAP);
    return bytes.length > VALUE_CAP ? null : bytes.toString("utf-8");
  } finally {
    fs3.closeSync(fd);
  }
}

// src/phase-results/assemble-common.ts
function baseFields(ctx, phase) {
  return {
    v: 1,
    phase,
    feature: ctx.feature,
    startedAt: ctx.startedAt,
    assembledAt: ctx.now().toISOString(),
    headSha: ctx.headSha,
    verification: "verified",
    claims: [],
    chain: []
  };
}
function parseJsonOr(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
function parseJsonObject(line) {
  const v = parseJsonOr(line, null);
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
}
function readValue(ctx, name) {
  return ctx.valueDir === null ? null : readValueFile(ctx.valueDir, name);
}
function sha256(data) {
  return (0, import_node_crypto.createHash)("sha256").update(data).digest("hex");
}
function redactModelText(s) {
  return redactString(s);
}

// src/phase-results/assemble-build.ts
var CHUNK = 64 * 1024;
var CAP = 8 * 1024 * 1024;
function take(line, start, cutoff, results) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return true;
  }
  const ts = typeof event.ts === "string" ? Date.parse(event.ts) : NaN;
  if (ts < start) return false;
  if (ts > cutoff) return true;
  if (event.kind === "test-run" && (event.result === "red" || event.result === "green")) results.push(event.result);
  return true;
}
function scanBackwards(fd, size, start, cutoff, readChunk) {
  const results = [];
  let position = size;
  let carry = Buffer.alloc(0);
  let read = 0;
  while (position > 0) {
    if (read >= CAP) return { results, truncated: true };
    const length = Math.min(CHUNK, position);
    position -= length;
    const chunk = Buffer.alloc(length);
    const n = readChunk(fd, chunk, 0, length, position);
    read += n;
    let buf = Buffer.concat([chunk.subarray(0, n), carry]);
    if (position > 0) {
      const nl = buf.indexOf(10);
      if (nl === -1) {
        carry = buf;
        continue;
      }
      carry = buf.subarray(0, nl);
      buf = buf.subarray(nl + 1);
    }
    const lines = buf.toString("utf-8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] === "") continue;
      if (!take(lines[i], start, cutoff, results)) return { results, truncated: false };
    }
  }
  return { results, truncated: false };
}
function assembleBuild(ctx, opts = {}) {
  const cutoff = ctx.evidenceCutoff === void 0 ? ctx.now().toISOString() : ctx.evidenceCutoff;
  for (const dir of [import_node_path.default.join(ctx.repo, ".oss"), import_node_path.default.join(ctx.repo, ".oss", "tool-gates")]) {
    const st = import_node_fs.default.lstatSync(dir, { throwIfNoEntry: false });
    if (st === void 0) return { ok: false, error: "no_test_runs" };
    if (!st.isDirectory()) return { ok: false, error: "unsafe_path" };
  }
  const file = import_node_path.default.join(ctx.repo, ".oss", "tool-gates", "events.ndjson");
  const { O_RDONLY: O_RDONLY2, O_NOFOLLOW: O_NOFOLLOW2, O_NONBLOCK: O_NONBLOCK2 } = import_node_fs.default.constants;
  let fd;
  try {
    fd = import_node_fs.default.openSync(file, O_RDONLY2 | O_NOFOLLOW2 | O_NONBLOCK2);
  } catch (err) {
    if (err.code === "ENOENT") return { ok: false, error: "no_test_runs" };
    return { ok: false, error: "unsafe_path" };
  }
  let scan;
  try {
    const st = import_node_fs.default.fstatSync(fd);
    if (!st.isFile()) return { ok: false, error: "unsafe_path" };
    const end = cutoff === null ? Infinity : Date.parse(cutoff);
    scan = scanBackwards(fd, st.size, Date.parse(ctx.startedAt), end, opts.readChunk ?? import_node_fs.default.readSync);
  } finally {
    import_node_fs.default.closeSync(fd);
  }
  const { results, truncated } = scan;
  const sawRed = results.includes("red");
  const lastResult = results[0] ?? "red";
  if (!truncated) {
    if (results.length === 0) return { ok: false, error: "no_test_runs" };
    if (lastResult === "red") return { ok: false, error: "not_green" };
    if (!sawRed) return { ok: false, error: "no_red" };
  }
  const notes = readValue(ctx, "notes.txt");
  const result = {
    ...baseFields(ctx, "build"),
    sources: { testRuns: "code", evidenceTrust: "code", ...notes === null ? {} : { notes: "model" } },
    testRuns: { sawRed, lastResult, count: results.length },
    evidenceTrust: "repo-file",
    ...cutoff === null ? {} : { evidenceCutoff: cutoff },
    ...notes === null ? {} : { notes: redactModelText(notes) }
  };
  if (truncated) {
    result.verification = "unverified";
    result.verificationError = { check: "build-events", errorClass: "events_truncated" };
  }
  return { ok: true, result };
}

// src/phase-results/assemble-ideate.ts
var fs6 = __toESM(require("node:fs"), 1);
var path5 = __toESM(require("node:path"), 1);

// src/phase-results/ledger.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto2 = require("node:crypto");
var fs5 = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path4 = __toESM(require("node:path"), 1);
var LedgerError = class extends Error {
  code;
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LedgerError";
    this.code = code;
  }
};
function parseRunRow(row) {
  if (row === null) return null;
  const { startedAt, session, headSha: headSha2, feature } = row;
  if (typeof startedAt !== "string" || typeof session !== "string" || typeof feature !== "string") return null;
  return { startedAt, session, headSha: typeof headSha2 === "string" ? headSha2 : "", feature };
}
var MAX_ROW_BYTES = 512;
var SMALL_CAP = 1024 * 1024;
var LARGE_CAP = 4 * 1024 * 1024;
var SEGMENT = /^[A-Za-z0-9._-]+$/;
var TAIL_BYTES = 4096;
var GIT_TIMEOUT_MS = 2e3;
function gitBin2() {
  for (const p of ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git", "/bin/git"]) {
    try {
      if (!fs5.statSync(p).isFile()) continue;
      fs5.accessSync(p, fs5.constants.X_OK);
      return p;
    } catch {
    }
  }
  return "";
}
function gitOut(cwd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  env.PATH = "/usr/bin:/bin";
  try {
    const out = (0, import_node_child_process.execFileSync)(gitBin2(), args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS
    });
    const v = out.replace(/\n$/, "");
    return v === "" ? null : v;
  } catch {
    return null;
  }
}
function ledgerKey(cwd) {
  let physical;
  try {
    physical = fs5.realpathSync(cwd);
  } catch {
    return null;
  }
  const top = gitOut(physical, ["rev-parse", "--show-toplevel"]);
  if (top === null) return null;
  const gitDir = gitOut(top, ["rev-parse", "--absolute-git-dir"]);
  if (gitDir === null) return null;
  const content = Buffer.from(`${top}
${gitDir}
`, "utf8");
  return (0, import_node_crypto2.createHash)("sha1").update(`blob ${content.length}\0`).update(content).digest("hex").slice(0, 16);
}
function splitRel(relPath) {
  const parts = relPath.split("/");
  for (const p of parts) {
    if (!SEGMENT.test(p) || p.startsWith(".")) throw new LedgerError("unsafe_path", relPath);
  }
  return parts;
}
function capFor(parts) {
  return parts[0] === "results" || parts[0] === "decisions" ? SMALL_CAP : LARGE_CAP;
}
function checkStat(st, uid, wantDir, where) {
  const kindOk = wantDir ? st.isDirectory() : st.isFile();
  if (st.isSymbolicLink() || !kindOk || st.uid !== uid || (st.mode & 63) !== 0) {
    throw new LedgerError("unsafe_path", where);
  }
}
function isErrno(e, code) {
  return e instanceof Error && e.code === code;
}
function parseObject(line) {
  try {
    const v = JSON.parse(line);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function openLedger(cwd, opts = {}) {
  const key2 = ledgerKey(cwd);
  if (key2 === null) throw new LedgerError("unsafe_path", "not a git repo");
  const uid = (opts.getuid ?? (() => process.getuid ? process.getuid() : -1))();
  const root = path4.join(os.homedir(), ".oss", "ledger");
  const keyDir = path4.join(root, key2);
  function ensureDirs(dirParts, create) {
    if (create) fs5.mkdirSync(path4.dirname(root), { recursive: true, mode: 448 });
    let cur = root;
    for (const seg of [null, key2, ...dirParts]) {
      if (seg !== null) cur = path4.join(cur, seg);
      let st;
      try {
        st = fs5.lstatSync(cur);
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e;
        if (!create) return false;
        try {
          fs5.mkdirSync(cur, { mode: 448 });
        } catch (me) {
          if (!isErrno(me, "EEXIST")) throw me;
        }
        st = fs5.lstatSync(cur);
      }
      checkStat(st, uid, true, cur);
    }
    return true;
  }
  function filePath(parts) {
    return path4.join(keyDir, ...parts);
  }
  function openChecked(parts, flags) {
    const p = filePath(parts);
    let fd;
    try {
      fd = fs5.openSync(p, flags | fs5.constants.O_NOFOLLOW, 384);
    } catch (e) {
      if (isErrno(e, "ENOENT")) return null;
      if (isErrno(e, "ELOOP") || isErrno(e, "EMLINK")) throw new LedgerError("unsafe_path", p);
      throw e;
    }
    try {
      checkStat(fs5.fstatSync(fd), uid, false, p);
    } catch (e) {
      fs5.closeSync(fd);
      throw e;
    }
    return fd;
  }
  function readText(parts) {
    if (!ensureDirs(parts.slice(0, -1), false)) return null;
    const fd = openChecked(parts, fs5.constants.O_RDONLY);
    if (fd === null) return null;
    try {
      const size = fs5.fstatSync(fd).size;
      if (size > capFor(parts)) throw new LedgerError("ledger_too_large", filePath(parts));
      return fs5.readFileSync(fd, "utf8");
    } finally {
      fs5.closeSync(fd);
    }
  }
  function writeFile(parts, data, flags) {
    ensureDirs(parts.slice(0, -1), true);
    const fd = openChecked(parts, fs5.constants.O_WRONLY | fs5.constants.O_CREAT | flags);
    if (fd === null) throw new LedgerError("unsafe_path", filePath(parts));
    try {
      fs5.writeSync(fd, data);
    } finally {
      fs5.closeSync(fd);
    }
  }
  const readRows = (relPath) => {
    const text = readText(splitRel(relPath));
    if (text === null) return [];
    const rows = [];
    for (const line of text.split("\n")) {
      const row = parseObject(line);
      if (row !== null) rows.push(row);
    }
    return rows;
  };
  return {
    dir: keyDir,
    appendRow(relPath, row) {
      const parts = splitRel(relPath);
      const line = `${JSON.stringify(row)}
`;
      if (Buffer.byteLength(line) >= MAX_ROW_BYTES) throw new LedgerError("too_large", relPath);
      writeFile(parts, line, fs5.constants.O_APPEND);
    },
    readRows,
    lastRow(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return null;
      const fd = openChecked(parts, fs5.constants.O_RDONLY);
      if (fd === null) return null;
      try {
        const size = fs5.fstatSync(fd).size;
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        fs5.readSync(fd, buf, 0, len, size - len);
        const lines = buf.toString("utf8").split("\n");
        for (let i = lines.length - 1; i >= (len < size ? 1 : 0); i--) {
          const row = parseObject(lines[i]);
          if (row !== null) return row;
        }
        return null;
      } finally {
        fs5.closeSync(fd);
      }
    },
    scanBack(relPath, visit) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return;
      const fd = openChecked(parts, fs5.constants.O_RDONLY);
      if (fd === null) return;
      try {
        const size = fs5.fstatSync(fd).size;
        const floor = Math.max(0, size - capFor(parts));
        let end = size;
        let rest = Buffer.alloc(0);
        while (end > floor) {
          const start = Math.max(floor, end - TAIL_BYTES);
          const buf = Buffer.alloc(end - start);
          fs5.readSync(fd, buf, 0, buf.length, start);
          const all = Buffer.concat([buf, rest]);
          end = start;
          const cut = start > 0 ? all.indexOf(10) : -1;
          if (start > 0 && cut < 0) {
            rest = all;
            continue;
          }
          rest = cut < 0 ? Buffer.alloc(0) : all.subarray(0, cut);
          const lines = all.subarray(cut + 1).toString("utf8").split("\n");
          for (let i = lines.length - 1; i >= 0; i--) {
            const row = parseObject(lines[i]);
            if (row !== null && !visit(row)) return;
          }
        }
      } finally {
        fs5.closeSync(fd);
      }
    },
    writeMarker(relPath, obj) {
      writeFile(splitRel(relPath), `${JSON.stringify(obj)}
`, fs5.constants.O_TRUNC);
    },
    readMarker(relPath) {
      const text = readText(splitRel(relPath));
      return text === null ? null : parseObject(text.trim());
    },
    clearMarker(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return;
      try {
        fs5.unlinkSync(filePath(parts));
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e;
      }
    },
    hasMarker(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return false;
      const fd = openChecked(parts, fs5.constants.O_RDONLY);
      if (fd === null) return false;
      fs5.closeSync(fd);
      return true;
    }
  };
}

// src/phase-results/assemble-ideate.ts
var FILE_CAP = 1024 * 1024;
var MAX_DECISIONS = 200;
var TEXT_CAP = 4e3;
var KIND_CAP = 64;
function readRepoFile(p) {
  let fd;
  try {
    fd = fs6.openSync(p, fs6.constants.O_RDONLY | fs6.constants.O_NOFOLLOW | fs6.constants.O_NONBLOCK);
  } catch (e) {
    const code = e.code;
    if (code === "ENOENT") return { ok: true, text: null };
    return { ok: false, error: "unsafe_path" };
  }
  try {
    const st = fs6.fstatSync(fd);
    if (!st.isFile()) return { ok: false, error: "unsafe_path" };
    if (st.size > FILE_CAP) return { ok: false, error: "too_large" };
    return { ok: true, text: fs6.readFileSync(fd, "utf8") };
  } finally {
    fs6.closeSync(fd);
  }
}
function clipText(v, cap) {
  return typeof v === "string" ? redactModelText(v).slice(0, cap) : void 0;
}
function ledgerKeys(ctx) {
  const keys = /* @__PURE__ */ new Set();
  for (const row of openLedger(ctx.repo).readRows(`decisions/${ctx.feature}`)) {
    if (row.feature === ctx.feature && typeof row.id === "string" && typeof row.sha256 === "string") {
      keys.add(`${row.id}
${row.sha256}`);
    }
  }
  return keys;
}
function answeredAfter(answeredAt, cutoff) {
  const at = typeof answeredAt === "string" ? Date.parse(answeredAt) : Number.NaN;
  if (Number.isNaN(at)) return true;
  return /\.\d+Z$/.test(cutoff) ? at + 1e3 > Date.parse(cutoff) : at > Date.parse(cutoff);
}
function readOpenQuestions(ctx) {
  const raw = readValue(ctx, "open-questions.json");
  const parsed = raw === null ? [] : parseJsonOr(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((q) => typeof q === "string").map((q) => clipText(q, TEXT_CAP) ?? "");
}
function assembleIdeate(ctx) {
  const cutoff = ctx.evidenceCutoff === void 0 ? ctx.now().toISOString().replace(/\.\d+Z$/, "Z") : ctx.evidenceCutoff;
  const dir = path5.join(ctx.repo, ".oss", "dev", "active", ctx.feature);
  const design = readRepoFile(path5.join(dir, "DESIGN.md"));
  if (!design.ok) return { ok: false, error: design.error };
  const committed = (design.text ?? "").split("\n").some((l) => l.replace(/\r$/, "") === "Status: COMMITTED");
  if (!committed) return { ok: false, error: "design_not_committed" };
  const records = readRepoFile(path5.join(dir, "decisions.ndjson"));
  if (!records.ok) return { ok: false, error: records.error };
  const decisions = [];
  if (records.text !== null) {
    let keys;
    try {
      keys = ledgerKeys(ctx);
    } catch (e) {
      if (e instanceof LedgerError) return { ok: false, error: e.code };
      throw e;
    }
    for (const line of records.text.split("\n")) {
      if (decisions.length >= MAX_DECISIONS) break;
      const rec = parseJsonObject(line);
      if (rec === null || rec.feature !== ctx.feature || typeof rec.id !== "string") continue;
      if (!keys.has(`${rec.id}
${sha256(line)}`)) continue;
      if (cutoff !== null && answeredAfter(rec.answeredAt, cutoff)) continue;
      const d = { id: rec.id };
      const question = clipText(rec.question, TEXT_CAP);
      const answer = clipText(rec.answer, TEXT_CAP);
      const kind = clipText(rec.kind, KIND_CAP);
      if (question !== void 0) d.question = question;
      if (answer !== void 0) d.answer = answer;
      if (kind !== void 0) d.kind = kind;
      decisions.push(d);
    }
  }
  return {
    ok: true,
    result: {
      ...baseFields(ctx, "ideate"),
      sources: { decisions: "code", decisionsRecorded: "code", designCommitted: "code", openQuestions: "model" },
      decisions,
      decisionsRecorded: decisions.length,
      designCommitted: true,
      openQuestions: readOpenQuestions(ctx),
      ...cutoff === null ? {} : { evidenceCutoff: cutoff }
    }
  };
}

// src/phase-results/assemble-plan.ts
function redactIfString(v) {
  return typeof v === "string" ? redactModelText(v) : v;
}
function assemblePlan(ctx) {
  const raw = readValue(ctx, "tasks.json");
  const parsed = raw === null ? null : parseJsonOr(raw, null);
  if (!Array.isArray(parsed)) return { ok: false, error: "no_tasks" };
  const seen = /* @__PURE__ */ new Set();
  const tasks = [];
  for (const item of parsed) {
    const { id, title, testIds } = item ?? {};
    if (seen.has(id)) return { ok: false, error: "duplicate_task", detail: String(id) };
    seen.add(id);
    if (!Array.isArray(testIds) || testIds.length === 0) {
      return { ok: false, error: "task_without_test", detail: String(id) };
    }
    tasks.push({ id, title: redactIfString(title), testIds: testIds.map(redactIfString) });
  }
  return {
    ok: true,
    result: { ...baseFields(ctx, "plan"), sources: { tasks: "model" }, tasks }
  };
}

// src/phase-results/assemble-ship.ts
var import_node_child_process3 = require("node:child_process");
var fs7 = __toESM(require("node:fs"), 1);
var path6 = __toESM(require("node:path"), 1);

// src/phase-results/git.ts
var import_node_child_process2 = require("node:child_process");
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_GRAFT_FILE = "/dev/null";
  return env;
}
function gitOut2(cwd, args) {
  try {
    const out = (0, import_node_child_process2.execFileSync)(gitBin(), args, {
      cwd,
      // git runs helpers (ssh, pager, credential and fsmonitor hooks) from PATH: never the caller's (D33).
      env: { ...gitEnv(), PATH: "/usr/bin:/bin" },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2e3
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

// src/phase-results/assemble-ship.ts
var DEFAULT_REQUIRED_GATES = ["code-review", "performance", "security"];
var SEVERITIES = ["critical", "high", "medium", "low", "info"];
var REPO_FILE_CAP = 4 * 1024 * 1024;
var GitError = class extends Error {
  /**
   * Perf L1 (gate round 11): git's output overflowed the call's buffer (spawnSync's ENOBUFS). Perf F2 (gate round 12):
   * git ran past the call's time limit (ETIMEDOUT).
   */
  constructor(message, overflow = false, timedOut = false) {
    super(message);
    this.overflow = overflow;
    this.timedOut = timedOut;
  }
  overflow;
  timedOut;
};
var callerDeadline = Infinity;
function runGit(repo, args, okCodes = [0], raw = false, maxBuffer = 1024 * 1024, input, timeout = 1e4) {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.PATH = "/usr/bin:/bin";
  const git2 = gitBin();
  if (git2 === "") throw new GitError("no git");
  const left = callerDeadline - Date.now();
  if (left <= 0) throw new GitError(args[0] ?? "git", false, true);
  const r = (0, import_node_child_process3.spawnSync)(git2, ["-c", "core.fsmonitor=", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repo,
    env,
    encoding: "utf-8",
    stdio: [input === void 0 ? "ignore" : "pipe", "pipe", "ignore"],
    input,
    timeout: Math.min(timeout, left),
    maxBuffer
  });
  if (r.error !== void 0 || r.status === null || !okCodes.includes(r.status)) {
    const code = r.error?.code;
    throw new GitError(args[0], code === "ENOBUFS", code === "ETIMEDOUT");
  }
  return { status: r.status, out: raw ? r.stdout : r.stdout.trim() };
}
function rethrowTimeout(e) {
  if (e instanceof GitError && e.timedOut) throw e;
}
var NO_LOCAL_BASE = "create the local branch from its remote (git branch <base> <remote>/<base>)";
function validBranchName(repo, name) {
  if (name === "" || name.startsWith("-")) return false;
  try {
    runGit(repo, ["check-ref-format", "--branch", name]);
    return true;
  } catch {
    return false;
  }
}
function isLocalBranch(repo, name) {
  if (!validBranchName(repo, name)) return false;
  try {
    runGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${name}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
function branchTip(repo, name) {
  try {
    return runGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${name}^{commit}`]).out;
  } catch {
    return null;
  }
}
function containedIn(repo, tip, sha) {
  try {
    return runGit(repo, ["rev-list", "-n", "1", "--end-of-options", tip, `^${sha}`]).out === "";
  } catch (e) {
    rethrowTimeout(e);
    return false;
  }
}
function refPathLinked(repo, base) {
  try {
    const [format, ...dir] = runGit(repo, ["rev-parse", "--show-ref-format", "--git-common-dir"], [0], true).out.replace(/\n$/, "").split("\n");
    const common = path6.resolve(repo, dir.join("\n"));
    const linked = (p2) => {
      try {
        return fs7.lstatSync(p2, { throwIfNoEntry: false })?.isSymbolicLink();
      } catch (e) {
        if (e.code === "ENOTDIR") return void 0;
        throw e;
      }
    };
    if (["refs", "refs/heads", "packed-refs"].some((p2) => linked(path6.join(common, p2)) === true)) return true;
    if (format === "reftable") return false;
    let p = path6.join(common, "refs", "heads");
    for (const seg of base.split("/")) {
      p = path6.join(p, seg);
      const st = linked(p);
      if (st === void 0) return false;
      if (st) return true;
    }
    return false;
  } catch (e) {
    rethrowTimeout(e);
    return true;
  }
}
function shipBaseCheck(repo, base, feature, refs) {
  try {
    return checkBase(repo, base, feature, refs);
  } catch (e) {
    if (e instanceof GitError && e.timedOut) return "timeout";
    throw e;
  }
}
function checkBase(repo, base, feature, refs) {
  if (base === feature || base.includes(`/${feature}/`)) return "refused";
  let current;
  try {
    current = runGit(repo, ["symbolic-ref", "-q", "HEAD"], [0, 1]).out;
  } catch (e) {
    rethrowTimeout(e);
    return "refused";
  }
  if (current === `refs/heads/${base}`) return "refused";
  try {
    if (runGit(repo, ["symbolic-ref", "-q", `refs/heads/${base}`], [0, 1]).status === 0) return "refused";
  } catch (e) {
    rethrowTimeout(e);
    return "refused";
  }
  if (refPathLinked(repo, base)) return "refused";
  const tip = branchTip(repo, base);
  if (tip === null) return "refused";
  for (const [name, sha] of refs) {
    const m = /^refs\/remotes\/[^/]+\/(.+)$/.exec(name);
    if (m?.[1] === base && containedIn(repo, tip, sha)) return "ok";
  }
  return "not_in_snapshot";
}
function mostAdvanced(repo, shas) {
  if (shas.length === 1) return shas[0];
  try {
    const top = runGit(repo, ["merge-base", "--independent", "--end-of-options", ...shas]).out.split("\n");
    return top.length === 1 && shas.includes(top[0]) ? top[0] : null;
  } catch (e) {
    rethrowTimeout(e);
    return null;
  }
}
function diffFrom(repo, branch, tip, head, remoteRefs) {
  const same = [...remoteRefs.keys()].sort().filter((name) => /^refs\/remotes\/[^/]+\/(.+)$/.exec(name)?.[1] === branch).map((name) => remoteRefs.get(name));
  const candidates = [...new Set(same)].filter((sha) => sha !== tip && containedIn(repo, tip, sha) && !containedIn(repo, head, sha));
  const from = candidates.length === 0 ? tip : mostAdvanced(repo, candidates) ?? topologicalBest(repo, candidates, head);
  return liveBase(repo, branch, from, head);
}
function topologicalBest(repo, candidates, head) {
  let best = null;
  for (const c of candidates) {
    try {
      const mb = runGit(repo, ["merge-base", "--end-of-options", c, head]).out;
      if (best === null || mb !== best.mb && runGit(repo, ["merge-base", "--is-ancestor", "--end-of-options", best.mb, mb], [0, 1]).status === 0) {
        best = { sha: c, mb };
      }
    } catch (e) {
      rethrowTimeout(e);
    }
  }
  return best?.sha ?? candidates[0];
}
function liveBase(repo, branch, from, head) {
  const points = /* @__PURE__ */ new Set();
  const out = runGit(repo, ["for-each-ref", `--contains=${from}`, "--format=%(refname)%00%(objectname)%00%(symref)", `refs/remotes/*/${branch}`], [0], true, PATH_LIST_BUFFER).out;
  const tips = /* @__PURE__ */ new Set();
  for (const line of out.split("\n")) {
    const [name, sha, symref] = line.split("\0");
    if (symref !== "" || sha === void 0 || !TREE_RE.test(sha) || sha === from) continue;
    if (/^refs\/remotes\/[^/]+\/(.+)$/.exec(name)?.[1] !== branch) continue;
    tips.add(sha);
  }
  for (const sha of tips) {
    const mb = runGit(repo, ["merge-base", "--end-of-options", sha, head], [0, 1]).out;
    if (mb !== from && TREE_RE.test(mb) && containedIn(repo, from, mb)) points.add(mb);
  }
  return points.size === 0 ? from : mostAdvanced(repo, [...points]) ?? from;
}
var DIFF_BUDGET_MS = 2e4;
var DIFF_TIMEOUT = "diff_timeout: git ran past its time limit (often many loose objects): run git gc, then try again";
function diffBase(repo, base, remoteRefs) {
  if (base.startsWith("-")) throw new GitError("base");
  const branch = runGit(repo, ["check-ref-format", "--branch", base]).out;
  const tip = runGit(repo, ["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`]).out;
  const headSha2 = runGit(repo, ["rev-parse", "--verify", "HEAD^{commit}"]).out;
  const from = diffFrom(repo, branch, tip, headSha2, remoteRefs);
  return { branch, tip, headSha: headSha2, from, mergeBase: runGit(repo, ["merge-base", from, headSha2]).out };
}
function branchAddedPaths(repo, base, remoteRefs, dir, deadline = Infinity) {
  callerDeadline = deadline;
  try {
    const { mergeBase, headSha: headSha2 } = diffBase(repo, base, remoteRefs);
    const out = runGit(repo, [...DIFF, "--name-only", "--diff-filter=A", "-z", mergeBase, headSha2, "--", dir], [0], true, PATH_LIST_BUFFER).out;
    return out.split("\0").filter((p) => p !== "");
  } catch (e) {
    return e instanceof GitError && e.timedOut ? "timeout" : null;
  } finally {
    callerDeadline = Infinity;
  }
}
function readDiff(repo, base, remoteRefs) {
  const { branch, tip, headSha: headSha2, from, mergeBase } = diffBase(repo, base, remoteRefs);
  const deadline = Date.now() + DIFF_BUDGET_MS;
  const left = () => Math.max(1, deadline - Date.now());
  const sameTree = runGit(repo, [...DIFF, "--quiet", tip, headSha2], [0, 1], false, void 0, void 0, left()).status === 0;
  const stat = runGit(repo, [...DIFF, "--shortstat", mergeBase, headSha2], [0], false, void 0, void 0, left()).out;
  const num2 = (re) => Number(re.exec(stat)?.[1] ?? 0);
  const files = num2(/(\d+) files? changed/);
  return {
    base: mergeBase,
    from,
    baseRef: branch,
    files,
    insertions: num2(/(\d+) insertions?\(\+\)/),
    deletions: num2(/(\d+) deletions?\(-\)/),
    headSha: headSha2,
    empty: sameTree || files === 0
  };
}
function repoLines(file) {
  let fd;
  try {
    fd = fs7.openSync(file, fs7.constants.O_RDONLY | fs7.constants.O_NOFOLLOW | fs7.constants.O_NONBLOCK);
  } catch {
    return [];
  }
  try {
    const st = fs7.fstatSync(fd);
    if (!st.isFile() || st.size > REPO_FILE_CAP) return [];
    return fs7.readFileSync(fd, "utf-8").split("\n").filter((l) => l !== "");
  } finally {
    fs7.closeSync(fd);
  }
}
function counts(v) {
  const src = typeof v === "object" && v !== null ? v : {};
  const out = {};
  for (const s of SEVERITIES) out[s] = typeof src[s] === "number" ? src[s] : 0;
  return out;
}
function failRow(row) {
  const f = row.findings;
  const at = typeof row.ts === "string" ? Date.parse(row.ts) : NaN;
  if (typeof row.gate !== "string" || row.verdict !== "fail" || Number.isNaN(at)) return null;
  if (typeof f !== "object" || f === null || Array.isArray(f)) return null;
  const findings = {};
  for (const s of SEVERITIES) {
    const n = f[s];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
    findings[s] = n;
  }
  if ([row.tree, row.trackedTree, row.headSha].every((v) => v === void 0 || v === "")) return null;
  const hex = (v) => typeof v === "string" && TREE_RE.test(v) ? v : null;
  return { gate: row.gate, findings, at, tree: hex(row.tree), trackedTree: hex(row.trackedTree), headSha: hex(row.headSha) };
}
var TREE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
function rowKey(f) {
  return `${f.tree}|${f.trackedTree}|${f.headSha}`;
}
var PATH_LIST_BUFFER = 64 * 1024 * 1024;
var SHIPPED_CODE = ["--", ".", ":(exclude).oss"];
var DIFF_OPTIONS = ["--no-renames", "--no-ext-diff", "--no-textconv", "--ignore-submodules=none", "--no-color", "--diff-algorithm=myers"];
var DIFF = ["diff", ...DIFF_OPTIONS];
var ABSENT = /^0{6} /;
var BATCH_LOOKUPS = 64;
var BATCH_ROWS = 16;
var ARGV_PATH_BYTES = 128 * 1024;
var NO_CHANGES = /* @__PURE__ */ new Map();
function argvChunks(paths) {
  const chunks = [];
  let size = Infinity;
  for (const p of paths) {
    const bytes = Buffer.byteLength(p) + 1;
    if (size + bytes > ARGV_PATH_BYTES) {
      chunks.push([]);
      size = 0;
    }
    chunks[chunks.length - 1].push(p);
    size += bytes;
  }
  return chunks;
}
function parseRaw(parts, out = /* @__PURE__ */ new Map()) {
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const m = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]+) ([0-9a-f]+) [A-Z]/.exec(parts[i]);
    if (m === null) throw new GitError("raw");
    out.set(parts[i + 1], { from: `${m[1]} ${m[3]}`, to: `${m[2]} ${m[4]}` });
  }
  return out;
}
var FailComparer = class {
  constructor(repo, from, mergeBase) {
    this.repo = repo;
    this.from = from;
    this.mergeBase = mergeBase;
  }
  repo;
  from;
  mergeBase;
  missing = /* @__PURE__ */ new Map();
  /** The merge base's diff to HEAD (the feature's own paths), read once. */
  own = null;
  reviewBases = /* @__PURE__ */ new Map();
  /**
   * The current batch's diff-tree output, unparsed (each pair parsed when used, so a batch of whole-tree diffs costs
   * its text, not a map per pair): reviewed trees to HEAD, and D67's review bases to the merge base. Replaced by the
   * next batch (perf low 2: rows' own diffs are not kept).
   */
  rowText = /* @__PURE__ */ new Map();
  upstreamText = /* @__PURE__ */ new Map();
  /** D67: the last review base's upstream changes, parsed (rows sharing a review base are usually adjacent). */
  upstreamHit = null;
  prefetched = /* @__PURE__ */ new Set();
  added = /* @__PURE__ */ new Map();
  /** Perf low (gate round 9): each `<tree-ish>:<path>` lookup, once per assemble. */
  entries = /* @__PURE__ */ new Map();
  /** Perf L1 (gate round 11): set when a batched tree diff overflowed; later batches leave diffs to each row's calls. */
  diffOverflowed = false;
  /** True when prefetch already tried this row. */
  isPrefetched(f) {
    return this.prefetched.has(rowKey(f));
  }
  /**
   * Perf L3 (gate round 10): reads, for `rows`, every tree diff not yet read (each reviewed tree to HEAD and each review
   * base to the merge base, one `diff-tree --stdin`). Best effort: anything a batch call cannot answer is left for the
   * row's own git calls, which decide it as before. Perf L1 (gate round 11): none once a batched diff overflowed.
   */
  prefetch(rows) {
    for (const f of rows) this.prefetched.add(rowKey(f));
    this.rowText.clear();
    this.upstreamText.clear();
    if (this.diffOverflowed) return;
    try {
      const bases = [...new Set(rows.map((f) => f.headSha === null ? null : this.reviewBases.get(f.headSha)))].filter((b) => typeof b === "string" && b !== this.mergeBase);
      const trees = this.treesOf(["HEAD", this.mergeBase, ...bases]);
      const head = trees.get("HEAD");
      const mb = trees.get(this.mergeBase);
      if (head === void 0 || mb === void 0) return;
      const pairs = /* @__PURE__ */ new Map();
      for (const f of rows) {
        const tree = f.tree;
        if (tree !== null) pairs.set(`${tree} ${head}`, (t) => this.rowText.set(tree, t));
      }
      for (const b of bases) {
        const t = trees.get(b);
        if (t !== void 0) pairs.set(`${t} ${mb}`, (text) => this.upstreamText.set(b, text));
      }
      if (pairs.size > 0) this.diffTrees(pairs);
    } catch (e) {
      if (e instanceof GitError && e.overflow) this.diffOverflowed = true;
    }
  }
  /**
   * Perf I2 (gate round 11): the review bases of every row's review head, from one history walk before the first batch
   * (batchReviewBases' answer for a head does not depend on the other heads walked with it). Best effort: a head git
   * cannot walk leaves its rows to merge-base each. Perf F1 (gate round 12): only the heads git has are walked (one
   * `cat-file --batch-check`), so one pruned head no longer fails the walk for all; never `--ignore-missing`, which
   * would leave a missing head unlisted, and an unlisted head counts as its own base.
   */
  walkReviewBases(rows) {
    try {
      const heads = [...new Set(rows.map((f) => f.headSha).filter((h) => h !== null && !this.reviewBases.has(h)))];
      if (heads.length === 0) return;
      const found = runGit(this.repo, ["cat-file", "--batch-check=%(objecttype)"], [0], true, PATH_LIST_BUFFER, `${heads.join("\n")}
`).out.split("\n");
      heads.forEach((h, i) => {
        if (found[i]?.endsWith(" missing") === true) {
          this.reviewBases.set(h, null);
          this.missing.set(h, true);
        }
      });
      this.batchReviewBases(heads.filter((_, i) => found[i] === "commit"));
    } catch {
    }
  }
  /**
   * Perf L3: review bases for many review heads from one `rev-list --boundary --parents <heads> ^from`. A head not
   * listed is reachable from `from`, so it is its own merge base with it. A listed head whose listed history reaches
   * exactly one boundary commit has that commit as its merge base (every common ancestor lies behind the first commit
   * of `from`'s history on any path from the head). Heads reaching none or several are left to `merge-base`.
   */
  batchReviewBases(heads) {
    const distinct = [...new Set(heads)];
    if (distinct.length === 0) return;
    const out = runGit(
      this.repo,
      ["rev-list", "--topo-order", "--boundary", "--parents", "--stdin"],
      [0],
      true,
      PATH_LIST_BUFFER,
      `${distinct.join("\n")}
^${this.from}
`
    ).out;
    const parents = /* @__PURE__ */ new Map();
    const order = [];
    for (const line of out.split("\n")) {
      if (line === "" || line.startsWith("-")) continue;
      const [c, ...ps] = line.split(" ");
      if (c === void 0 || !TREE_RE.test(c)) throw new GitError("rev-list");
      parents.set(c, ps);
      order.push(c);
    }
    const reach = /* @__PURE__ */ new Map();
    for (let i = order.length - 1; i >= 0; i--) {
      const c = order[i];
      const set = /* @__PURE__ */ new Set();
      for (const p of parents.get(c) ?? []) {
        for (const b of parents.has(p) ? reach.get(p) ?? [] : [p]) if (set.size < 2) set.add(b);
      }
      reach.set(c, [...set]);
    }
    for (const h of distinct) {
      if (!parents.has(h)) this.reviewBases.set(h, h);
      else {
        const r = reach.get(h) ?? [];
        if (r.length === 1) this.reviewBases.set(h, r[0]);
      }
    }
  }
  /** The tree of each commit-ish, from one `cat-file --batch-check`; a missing one is left out. */
  treesOf(commits) {
    const out = runGit(
      this.repo,
      ["cat-file", "--batch-check=%(objectname)"],
      [0],
      true,
      PATH_LIST_BUFFER,
      commits.map((c) => `${c}^{tree}`).join("\n") + "\n"
    ).out.split("\n");
    const trees = /* @__PURE__ */ new Map();
    commits.forEach((c, i) => {
      const t = out[i] ?? "";
      if (TREE_RE.test(t)) trees.set(c, t);
    });
    return trees;
  }
  /**
   * One `diff-tree --stdin -r -z --raw` over tree pairs (`<a> <b>` lines), each pair's record text (`-z` raw records,
   * parsed when used) handed to its callback. git prints each pair's `<a> <b>` line before its records and nothing for
   * a pair it cannot read, so a pair with no header line is left unanswered. A record starts with `:` and holds two
   * NUL-terminated fields, so a path can never be taken for a header.
   */
  diffTrees(pairs) {
    const out = runGit(
      this.repo,
      ["diff-tree", "--stdin", "-r", "-z", "--raw", "--no-abbrev", ...DIFF_OPTIONS, ...SHIPPED_CODE],
      [0],
      true,
      PATH_LIST_BUFFER,
      `${[...pairs.keys()].join("\n")}
`
    ).out;
    const done = /* @__PURE__ */ new Map();
    let header = null;
    let start = 0;
    let i = 0;
    const close = () => {
      if (header !== null) done.set(header, out.slice(start, i));
    };
    while (i < out.length) {
      if (out[i] === ":") {
        const meta = out.indexOf("\0", i);
        const name = meta === -1 ? -1 : out.indexOf("\0", meta + 1);
        if (header === null || name === -1) throw new GitError("diff-tree");
        i = name + 1;
      } else {
        close();
        const nl = out.indexOf("\n", i);
        header = nl === -1 ? "" : out.slice(i, nl);
        if (!pairs.has(header) || done.has(header)) throw new GitError("diff-tree header");
        i = nl + 1;
        start = i;
      }
    }
    close();
    for (const [h, text] of done) pairs.get(h)?.(text);
  }
  /**
   * D45: a fail is cleared only when the shipped code differs from the code that failed: its reviewed trees, else its
   * headSha's tree. A fail that cannot be compared (a malformed or partial row, or a git error) stays open; one with
   * neither is dropped (D48). D55: trees git no longer has (gc) fall back to the headSha's tree; when that commit is
   * gone too, or a headSha-only row's commit is gone, 'ignored' (neither opens nor clears). D67: 'upstream' is open
   * because upstream changed a flagged feature path since review.
   */
  state(f) {
    const hasTrees = f.tree !== null && f.trackedTree !== null;
    if (f.tree !== null && f.trackedTree !== null) {
      const r2 = this.compare(f.tree, f.trackedTree, f.headSha, f.headSha);
      if (r2 !== "unknown") return r2;
      if (!this.gone(f.tree) && !this.gone(f.trackedTree)) return "open";
    }
    if (f.headSha === null) return hasTrees ? "ignored" : "open";
    const headTree = `${f.headSha}^{tree}`;
    const r = this.compare(headTree, headTree, null, f.headSha);
    if (r !== "unknown") return r;
    return this.gone(f.headSha) ? "ignored" : "open";
  }
  /**
   * D45 + D58 + D67: whether the shipped code differs from what the agent reviewed, on the feature's own paths only:
   * those the feature changed since the merge base (`git diff <merge-base> HEAD`), plus those the reviewed tree changed
   * against the review-time merge base (merge-base(from, review headSha)), so a flagged edit the feature has since
   * dropped still counts. A teammate's upstream change brought in by a rebase or merge is on neither list. With no
   * usable review headSha (null or pruned) only the first list counts (code-review info 1). D67: a path upstream changed
   * between the review-time base and the merge base (content, mode, deletion, or either side of a rename, which a
   * no-renames diff lists as a deletion and an addition) never clears, whatever it holds now; when it is a feature path
   * the row is 'upstream' (its own blocker text) unless another feature path clears it (D49). Ship's reviews run on the
   * uncommitted tree and ship commits afterwards (only the files it picks), so `tree` (the reviewed working tree,
   * untracked files included) is compared with HEAD: an added or modified path differs; a deleted path differs only
   * when it was tracked at review (`trackedTree`) or in the commit HEAD was at review (`reviewHead`, pen N4); an
   * untracked file the reviewer saw and ship left out does not (pen M3a). All are strict hex tree-ishes, checked by the
   * caller. 'unknown' on any git error (an object git does not have included).
   */
  compare(tree, trackedTree, reviewHead, at) {
    try {
      const changes = this.rowDiff(tree);
      const own = this.ownPaths();
      const reviewBase = this.reviewBase(at);
      const up = reviewBase === null || reviewBase === this.mergeBase ? NO_CHANGES : this.upstreamSince(reviewBase);
      let upstream = false;
      for (const [p, u] of up) {
        if (own.has(p) || (changes.get(p)?.from ?? u.to) !== u.from) {
          upstream = true;
          break;
        }
      }
      const gone = [];
      for (const [p, c] of changes) {
        if (up.has(p)) continue;
        if (reviewBase === null && !own.has(p)) continue;
        if (!ABSENT.test(c.to)) return "cleared";
        gone.push(p);
      }
      if (gone.length > 0 && this.trackedAtReview(gone, trackedTree, reviewHead)) return "cleared";
      return upstream ? "upstream" : "open";
    } catch {
      return "unknown";
    }
  }
  /** `diff --raw` from a tree-ish to another outside .oss, by path. */
  rawDiff(a, b) {
    return parseRaw(runGit(this.repo, [...DIFF, "--raw", "-z", "--no-abbrev", "--end-of-options", a, b, ...SHIPPED_CODE], [0], true, PATH_LIST_BUFFER).out.split("\0"));
  }
  /** A reviewed tree's diff to HEAD: from the current batch, else its own call. */
  rowDiff(tree) {
    const text = this.rowText.get(tree);
    return text === void 0 ? this.rawDiff(tree, "HEAD") : parseRaw(text.split("\0"));
  }
  /** The merge base's diff to HEAD: the feature's own paths, read once. */
  ownPaths() {
    this.own ??= this.rawDiff(this.mergeBase, "HEAD");
    return this.own;
  }
  /** D67: what upstream changed from a review base to the merge base: from the current batch, else its own call. */
  upstreamSince(reviewBase) {
    if (this.upstreamHit?.base !== reviewBase) {
      const text = this.upstreamText.get(reviewBase);
      const diff = text === void 0 ? this.rawDiff(reviewBase, this.mergeBase) : parseRaw(text.split("\0"));
      this.upstreamHit = { base: reviewBase, diff };
    }
    return this.upstreamHit.diff;
  }
  /**
   * Whether any deleted path was tracked at review: in `trackedTree` or in the review's HEAD commit. Up to
   * BATCH_LOOKUPS paths: one `ls-tree` per tree-ish (lookup, cached). More, or a git that cannot list entries: git's
   * path lookup scans each folder per name (40,000 names in one folder took 47 s), so the paths each tree-ish adds over
   * HEAD are listed once and cached.
   */
  trackedAtReview(gone, trackedTree, reviewHead) {
    const treeishes = [trackedTree, ...reviewHead === null ? [] : [reviewHead]];
    if (gone.length <= BATCH_LOOKUPS) {
      let listed = true;
      for (const t of treeishes) {
        const found = this.tryLookup(t, gone);
        if (found === null) {
          listed = false;
          break;
        }
        if (found.some((state) => state !== null)) return true;
      }
      if (listed) return false;
    }
    const sets = treeishes.map((t) => this.addedOverHead(t));
    return gone.some((p) => sets.some((set) => set.has(p)));
  }
  /** lookup, or null when git cannot list the entries (the caller then takes the diff-list route). */
  tryLookup(treeish, paths) {
    try {
      return this.lookup(treeish, paths);
    } catch {
      return null;
    }
  }
  /**
   * Each path's `<mode> <object>` in `treeish` (as in diff --raw; a submodule is `160000 <commit>`), null when it has no
   * such entry. `ls-tree -z --full-tree` with literal pathspecs works on every git (cat-file's %(objectmode) needs
   * 2.53, code-review high, gate round 9); the paths go on argv in bounded chunks, and each `<tree-ish>:<path>` is
   * looked up once per assemble (perf low, gate round 9).
   */
  lookup(treeish, paths) {
    let known = this.entries.get(treeish);
    if (known === void 0) {
      known = /* @__PURE__ */ new Map();
      this.entries.set(treeish, known);
    }
    const missing = [...new Set(paths.filter((p) => !known.has(p)))];
    for (const chunk of argvChunks(missing)) {
      const out = runGit(this.repo, ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", treeish, "--", ...chunk], [0], true, PATH_LIST_BUFFER).out;
      const listed = /* @__PURE__ */ new Map();
      for (const entry of out.split("\0")) {
        const m = /^([0-7]{6}) [a-z]+ ([0-9a-f]{40}(?:[0-9a-f]{24})?)\t(.*)$/s.exec(entry);
        if (m !== null) listed.set(m[3], `${m[1]} ${m[2]}`);
        else if (entry !== "") throw new GitError("ls-tree");
      }
      for (const p of chunk) known.set(p, listed.get(p) ?? null);
    }
    return paths.map((p) => known.get(p) ?? null);
  }
  /** Paths `treeish` has that HEAD does not (outside .oss), cached per tree-ish. */
  addedOverHead(treeish) {
    let hit = this.added.get(treeish);
    if (hit === void 0) {
      hit = new Set(
        runGit(this.repo, [...DIFF, "--name-only", "-z", "--diff-filter=A", "--end-of-options", "HEAD", treeish, ...SHIPPED_CODE], [0], true, PATH_LIST_BUFFER).out.split("\0").filter((p) => p !== "")
      );
      this.added.set(treeish, hit);
    }
    return hit;
  }
  /**
   * The merge base at review: merge-base(from, the review's HEAD), from prefetch's batch or its own call. null when
   * there is no headSha or git pruned it (the review-time base is unknown).
   */
  reviewBase(at) {
    if (at === null) return null;
    const hit = this.reviewBases.get(at);
    if (hit !== void 0) return hit;
    let base;
    try {
      base = runGit(this.repo, ["merge-base", "--end-of-options", this.from, at]).out;
    } catch (e) {
      if (!this.gone(at)) throw e;
      base = null;
    }
    this.reviewBases.set(at, base);
    return base;
  }
  /**
   * D55: true only when git says the object is not in the repo (`cat-file -e` exits 1); any other git error is not a
   * missing object, so the caller keeps the fail open. Once per SHA.
   */
  gone(sha) {
    const hit = this.missing.get(sha);
    if (hit !== void 0) return hit;
    let r;
    try {
      r = runGit(this.repo, ["cat-file", "-e", sha], [0, 1]).status === 1;
    } catch {
      r = false;
    }
    this.missing.set(sha, r);
    return r;
  }
};
function timelineGates(ctx, featureDir, gateHashes) {
  const backed = [];
  const runStart = Math.floor(Date.parse(ctx.startedAt) / 1e3) * 1e3;
  for (const line of repoLines(path6.join(featureDir, "timeline.ndjson"))) {
    if (!gateHashes.has(sha256(line))) continue;
    const rec = parseJsonObject(line);
    if (rec === null || typeof rec.ts !== "string" || !(Date.parse(rec.ts) >= runStart)) continue;
    if (rec.kind === "gate" && rec.feature === ctx.feature && typeof rec.round === "number") {
      backed.push(rec);
    }
  }
  const latest = Math.max(0, ...backed.map((r) => r.round));
  const byName = /* @__PURE__ */ new Map();
  const rounds = /* @__PURE__ */ new Map();
  for (const rec of backed) {
    if (typeof rec.gate !== "string") continue;
    const at = typeof rec.ts === "string" ? Date.parse(rec.ts) : NaN;
    if (!Number.isNaN(at)) rounds.set(rec.gate, [...rounds.get(rec.gate) ?? [], { round: rec.round, at }]);
    if (rec.round !== latest) continue;
    byName.set(rec.gate, {
      gate: rec.gate,
      verdict: rec.verdict === "pass" ? "pass" : "fail",
      findings: counts(rec.findings),
      fixed: counts(rec.fixed),
      source: "model"
    });
  }
  return { byName, rounds };
}
var CAPTURE_ADDS_GATE = "pen-test";
var NOT_RE_REVIEWED = "captured fail, not re-reviewed: a tracked code change is needed to clear it";
var UPSTREAM_CHANGED = "captured fail, not re-reviewed: upstream changed a file this feature changes; a recorded override or a fix elsewhere in the feature clears it";
function applyAgentVerdicts(tl, verdictRows, comparer, overriddenAt) {
  const rows = verdictRows.map(failRow).filter((f) => f !== null).reverse().sort((a, b) => b.at - a.at);
  const states = /* @__PURE__ */ new Map();
  const newestOpen = /* @__PURE__ */ new Map();
  const decided = (gate) => newestOpen.get(gate)?.why === "open";
  comparer.walkReviewBases(rows);
  rows.forEach((f, i) => {
    if (decided(f.gate)) return;
    if (!states.has(rowKey(f))) {
      if (!comparer.isPrefetched(f)) {
        const batch = /* @__PURE__ */ new Map();
        for (const r of rows.slice(i)) {
          if (batch.size === BATCH_ROWS) break;
          if (!decided(r.gate) && !states.has(rowKey(r)) && !batch.has(rowKey(r))) batch.set(rowKey(r), r);
        }
        comparer.prefetch([...batch.values()]);
      }
      states.set(rowKey(f), comparer.state(f));
    }
    const s = states.get(rowKey(f));
    if (s === "upstream" && f.at < (overriddenAt.get(f.gate) ?? -Infinity)) return;
    if (s === "open" || s === "upstream") {
      const prev = newestOpen.get(f.gate);
      newestOpen.set(f.gate, { row: prev?.row ?? f, why: s === "open" ? "open" : prev?.why ?? "upstream" });
    }
  });
  const open = /* @__PURE__ */ new Map();
  for (const [name, { row: f, why }] of newestOpen) {
    const zero = counts({});
    const gate = tl.byName.get(name) ?? (name === CAPTURE_ADDS_GATE ? { gate: name, verdict: "fail", findings: zero, fixed: zero, source: "agent" } : void 0);
    if (gate === void 0) continue;
    tl.byName.set(name, { ...gate, verdict: "fail", findings: f.findings, source: "agent" });
    open.set(name, why);
  }
  return open;
}
function readOverrides(ctx, featureDir, decisionRows, gates) {
  const recorded = /* @__PURE__ */ new Map();
  for (const line of repoLines(path6.join(featureDir, "decisions.ndjson"))) {
    const rec = parseJsonObject(line);
    if (rec === null || rec.feature !== ctx.feature || typeof rec.id !== "string") continue;
    const h = sha256(line);
    const ok = decisionRows.some((r) => r.id === rec.id && r.feature === ctx.feature && r.sha256 === h);
    if (ok) recorded.set(rec.id, rec);
  }
  const raw = readValue(ctx, "overrides.json");
  const requested = raw === null ? [] : parseJsonOr(raw, null);
  if (!Array.isArray(requested)) return { ok: false, error: "override_unrecorded", detail: "overrides.json" };
  const overrides = [];
  const clearsBefore = /* @__PURE__ */ new Map();
  for (const item of requested) {
    const id = item?.decisionId;
    if (typeof id !== "string" || !recorded.has(id)) return { ok: false, error: "override_unrecorded" };
    const gate = item?.gate;
    if (gate !== void 0 && (typeof gate !== "string" || !gates.has(gate))) return { ok: false, error: "override_unrecorded", detail: "gate" };
    const rec = recorded.get(id);
    const person = rec.person;
    const at = typeof rec.answeredAt === "string" ? Date.parse(rec.answeredAt) : NaN;
    if (typeof gate === "string") {
      if (rec.command !== "ship" || rec.choice !== `Override ${gate}` || Number.isNaN(at)) return { ok: false, error: "override_unrecorded", detail: "gate" };
      clearsBefore.set(gate, Math.max(at, clearsBefore.get(gate) ?? -Infinity));
    } else if (rec.command !== "ship" || typeof rec.choice !== "string" || !rec.choice.startsWith("Override ")) {
      return { ok: false, error: "override_unrecorded", detail: "decisionId" };
    }
    overrides.push({
      finding: redactModelText(typeof item?.finding === "string" ? item.finding : ""),
      decisionId: id,
      person: typeof person === "string" ? person : JSON.stringify(person ?? null),
      ...gate === void 0 ? {} : { gate }
    });
  }
  return { ok: true, overrides, clearsBefore };
}
function assembleShip(ctx, opts) {
  let diff;
  try {
    diff = readDiff(ctx.repo, opts.base, opts.remoteRefs ?? /* @__PURE__ */ new Map());
  } catch (e) {
    if (e instanceof GitError && e.timedOut) return { ok: false, error: "diff_unavailable", detail: DIFF_TIMEOUT };
    return isLocalBranch(ctx.repo, opts.base) || !validBranchName(ctx.repo, opts.base) ? { ok: false, error: "diff_unavailable" } : { ok: false, error: "diff_unavailable", detail: NO_LOCAL_BASE };
  }
  if (diff.empty) return { ok: false, error: "empty_diff" };
  const featureDir = ctx.featureDir ?? path6.join(ctx.repo, ".oss", "dev", "active", ctx.feature);
  let gateHashes;
  let decisionRows;
  let verdictRows;
  try {
    const ledger = openLedger(ctx.repo);
    gateHashes = new Set(ledger.readRows(`gates/${ctx.feature}`).map((r) => r.sha256));
    decisionRows = ledger.readRows(`decisions/${ctx.feature}`);
    verdictRows = ledger.readRows(`verdicts/${ctx.feature}`);
  } catch (e) {
    return { ok: false, error: e instanceof LedgerError ? e.code : "unsafe_path" };
  }
  const required = opts.requiredGates ?? DEFAULT_REQUIRED_GATES;
  const read = readOverrides(ctx, featureDir, decisionRows, /* @__PURE__ */ new Set([...required, CAPTURE_ADDS_GATE]));
  const timeline = timelineGates(ctx, featureDir, gateHashes);
  const notReReviewed = applyAgentVerdicts(
    timeline,
    verdictRows,
    new FailComparer(ctx.repo, diff.from, diff.base),
    read.ok ? read.clearsBefore : /* @__PURE__ */ new Map()
  );
  const byName = timeline.byName;
  for (const name of required) {
    if (!byName.has(name)) return { ok: false, error: "gate_missing", detail: name };
  }
  const gates = [...byName.values()];
  if (!read.ok) return read;
  const blockers = gates.filter((g) => g.verdict !== "pass").map((g) => {
    const why = notReReviewed.get(g.gate);
    return why === void 0 ? `gate:${g.gate}` : `gate:${g.gate} (${why === "upstream" ? UPSTREAM_CHANGED : NOT_RE_REVIEWED})`;
  });
  const uncapturedGates = gates.filter((g) => g.source !== "agent").map((g) => g.gate);
  const gateEvidence = uncapturedGates.length === 0 ? "agent" : uncapturedGates.length === gates.length ? "model" : "partial";
  const summary = readValue(ctx, "summary.txt");
  return {
    ok: true,
    result: {
      ...baseFields(ctx, "ship"),
      headSha: diff.headSha,
      sources: {
        diff: "code",
        gates: "model",
        gateEvidence: "code",
        uncapturedGates: "code",
        overrides: "code",
        blockers: "code",
        verdict: "code",
        summary: "model"
      },
      diff: { base: diff.base, baseRef: diff.baseRef, files: diff.files, insertions: diff.insertions, deletions: diff.deletions },
      gates,
      gateEvidence,
      uncapturedGates,
      overrides: read.overrides,
      blockers,
      verdict: blockers.length === 0 ? "ready_to_merge" : "blocked",
      summary: summary === null ? "" : redactModelText(summary)
    }
  };
}

// src/phase-results/archivable.ts
var import_node_crypto3 = require("node:crypto");
var fs8 = __toESM(require("node:fs"), 1);
var path7 = __toESM(require("node:path"), 1);
function laterShipRun(ledger, feature, resultStart) {
  const start = typeof resultStart === "string" ? Date.parse(resultStart) : NaN;
  let stale = false;
  ledger.scanBack("run/ship", (row) => {
    if (row.feature === feature) {
      stale = row.startedAt !== resultStart;
      return false;
    }
    if (row.feature !== "" && row.feature !== void 0) return true;
    if (row.startedAt === resultStart) return false;
    const rowStart = typeof row.startedAt === "string" ? Date.parse(row.startedAt) : NaN;
    stale = !(rowStart <= start);
    return !stale;
  });
  return stale;
}
function shipArchivable(repo, feature, pluginRoot2) {
  const marker = path7.join(repo, ".oss", "dev", "active", feature, "results", "ship.unverified.json");
  if (fs8.lstatSync(marker, { throwIfNoEntry: false }) !== void 0) return { ok: false, reason: "unverified" };
  const read = readResult(repo, feature, "ship");
  if (!read.ok) return { ok: false, reason: read.error };
  const ledger = openLedger(repo);
  for (const kind of ["pending", "unverified"]) {
    if (ledger.hasMarker(`${kind}/${feature}/ship`)) return { ok: false, reason: "unverified" };
  }
  const sha = (0, import_node_crypto3.createHash)("sha256").update(read.bytes).digest("hex");
  if (ledger.lastRow(`results/${feature}/ship`)?.sha256 !== sha) return { ok: false, reason: "unbound_result" };
  const v = validate(loadPhaseSchema("ship", pluginRoot2), read.value);
  if (!v.ok) return { ok: false, reason: "invalid_result" };
  const stored = read.value;
  if (stored.verification !== "verified") return { ok: false, reason: "unverified" };
  if (laterShipRun(ledger, feature, stored.startedAt)) return { ok: false, reason: "stale_result" };
  if (stored.verdict !== "ready_to_merge") return { ok: false, reason: "not_ready_to_merge" };
  return { ok: true };
}

// src/phase-results/feature.ts
var import_node_child_process4 = require("node:child_process");
var fs9 = __toESM(require("node:fs"), 1);
var path8 = __toESM(require("node:path"), 1);
var FEATURE_RE2 = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
var BRANCH_RE = /^[^/]+\/([^/]+)\/[^/]/;
function activeFeatures(repo) {
  const dir = path8.join(repo, ".oss", "dev", "active");
  let names;
  try {
    names = fs9.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => FEATURE_RE2.test(n) && fs9.lstatSync(path8.join(dir, n), { throwIfNoEntry: false })?.isDirectory()).sort();
}
function branchName(repo) {
  const ref = gitOut2(repo, ["symbolic-ref", "-q", "HEAD"]);
  return ref !== null && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
}
function resolveFeature(repo) {
  const m = BRANCH_RE.exec(branchName(repo));
  if (m !== null) {
    const f = m[1];
    const st = fs9.lstatSync(path8.join(repo, ".oss", "dev", "active", f), { throwIfNoEntry: false });
    return FEATURE_RE2.test(f) && st?.isDirectory() ? f : null;
  }
  const active = activeFeatures(repo);
  return active.length === 1 ? active[0] : null;
}
var COMPLETED_RE = /^\.oss\/dev\/completed\/([^/]+)\//;
var ARCHIVED_RE = /^([A-Za-z0-9_-][A-Za-z0-9._-]*)-(\d{4}-\d{2}-\d{2})$/;
function archivedFeature(repo, base, remoteRefs, deadline = Infinity) {
  const named = BRANCH_RE.exec(branchName(repo))?.[1];
  if (named === void 0) return { ok: false, reason: "unnamed" };
  const added = branchAddedPaths(repo, base, remoteRefs, ".oss/dev/completed/", deadline);
  if (added === "timeout") return { ok: false, reason: "timeout" };
  if (added === null) return { ok: false, reason: "none" };
  const folders = [...new Set(added.map((p) => COMPLETED_RE.exec(p)?.[1]))].filter((n) => n !== void 0 && ARCHIVED_RE.exec(n)?.[1] === named);
  if (folders.length > 1) return { ok: false, reason: "several" };
  const folder = folders[0];
  if (folder === void 0) return { ok: false, reason: ignoredArchive(repo) ? "ignored" : "none" };
  const st = fs9.lstatSync(path8.join(repo, ".oss", "dev", "completed", folder), { throwIfNoEntry: false });
  return st?.isDirectory() === true ? { ok: true, feature: named, folder } : { ok: false, reason: "none" };
}
function ignoredArchive(repo) {
  return [".oss/dev/completed/", ".oss/dev/completed/x"].some((p) => (0, import_node_child_process4.spawnSync)(gitBin(), ["check-ignore", "-q", "--", p], {
    cwd: repo,
    env: { ...gitEnv(), PATH: "/usr/bin:/bin" },
    stdio: "ignore",
    timeout: 2e3
  }).status === 0);
}

// src/phase-results/merge-ready.ts
var import_node_child_process5 = require("node:child_process");
var import_node_crypto4 = require("node:crypto");
var fs10 = __toESM(require("node:fs"), 1);
var path9 = __toESM(require("node:path"), 1);
var READY_ROW = "merge/ready";
var TESTED_ROW = "merge/tested";
var SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
var FEATURE_RE3 = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
var DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
var MAX_RESULT_BYTES = 4 * 1024 * 1024;
var MERGED_BUDGET_MS = 9e3;
function git(repo, args, deadline = Date.now() + MERGED_BUDGET_MS) {
  const bin = gitBin();
  const left = deadline - Date.now();
  if (bin === "" || left <= 0) return { status: null, out: "" };
  const r = (0, import_node_child_process5.spawnSync)(bin, ["-c", "core.fsmonitor=", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repo,
    env: { ...gitEnv(), GIT_CONFIG_NOSYSTEM: "1", PATH: "/usr/bin:/bin" },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: left,
    maxBuffer: 16 * 1024 * 1024
  });
  return { status: r.error === void 0 ? r.status : null, out: r.stdout ?? "" };
}
function readyRow(ledger) {
  const r = ledger.lastRow(READY_ROW);
  if (r === null) return null;
  const { feature, headSha: headSha2, sha256: sha2562, startedAt, at } = r;
  if (typeof feature !== "string" || !FEATURE_RE3.test(feature)) return null;
  if (typeof headSha2 !== "string" || !SHA.test(headSha2) || typeof sha2562 !== "string" || !/^[0-9a-f]{64}$/.test(sha2562)) return null;
  if (typeof startedAt !== "string" || typeof at !== "string") return null;
  return { feature, headSha: headSha2, sha256: sha2562, startedAt, at };
}
function onlyOssAfter(repo, from, to, deadline) {
  if (!SHA.test(from) || !SHA.test(to)) return false;
  if (from === to) return true;
  if (git(repo, ["merge-base", "--is-ancestor", "--end-of-options", from, to], deadline).status !== 0) return false;
  const r = git(repo, ["log", "--no-renames", "--no-show-signature", "--diff-merges=separate", "--format=", "--name-only", "-z", "--end-of-options", `${from}..${to}`], deadline);
  if (r.status !== 0) return false;
  return r.out.split("\0").filter((p) => p !== "").every((p) => p.startsWith(".oss/"));
}
function testedRow(ledger, runStartedAt2) {
  const r = ledger.lastRow(TESTED_ROW);
  if (r === null || r.startedAt !== runStartedAt2) return null;
  const { head, main: main2 } = r;
  return typeof head === "string" && SHA.test(head) && typeof main2 === "string" && SHA.test(main2) ? { head, main: main2 } : null;
}
function archivedResult(repo, feature, sha2562) {
  const done = path9.join(repo, ".oss", "dev", "completed");
  let names;
  try {
    names = fs10.readdirSync(done).filter((n) => n.startsWith(`${feature}-`) && DATE_DIR.test(n.slice(feature.length + 1))).sort();
  } catch {
    return null;
  }
  for (const folder of names) {
    const bytes = resultBytes(path9.join(done, folder, "results", "ship.json"));
    if (bytes !== null && (0, import_node_crypto4.createHash)("sha256").update(bytes).digest("hex") === sha2562) return bytes;
  }
  return null;
}
function resultBytes(file) {
  let fd;
  try {
    fd = fs10.openSync(file, fs10.constants.O_RDONLY | fs10.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const st = fs10.fstatSync(fd);
    return st.isFile() && st.size <= MAX_RESULT_BYTES ? fs10.readFileSync(fd) : null;
  } finally {
    fs10.closeSync(fd);
  }
}
function parseObject2(bytes) {
  try {
    const v = JSON.parse(bytes.toString("utf8"));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function field(o, key2) {
  return typeof o === "object" && o !== null ? o[key2] : void 0;
}
var GH_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
function githubName(repo, deadline) {
  const r = git(repo, ["config", "--get-all", "remote.origin.url"], deadline);
  const urls = r.out.split("\n").filter((l) => l !== "");
  if (r.status !== 0 || urls.length !== 1) return null;
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(.+?)(?:\.git)?$/.exec(urls[0]);
  return m !== null && GH_NAME.test(m[1]) ? m[1] : null;
}
function ghBin(repo) {
  const top = fs10.realpathSync(repo);
  const dirs = (process.env.OSS_GH_PATH ?? "").split(":").filter((d) => {
    if (!path9.isAbsolute(d)) return false;
    try {
      const real = fs10.realpathSync(d);
      return real !== top && !real.startsWith(`${top}/`);
    } catch {
      return false;
    }
  });
  for (const d of dirs) {
    const bin = path9.join(d, "gh");
    try {
      if (!fs10.statSync(bin).isFile()) continue;
      fs10.accessSync(bin, fs10.constants.X_OK);
      return { bin, dirs: dirs.join(":") };
    } catch {
    }
  }
  return null;
}
function prMerged(repo, head, base, deadline) {
  if (!/^[0-9a-f]{40}$/.test(head)) return "no_proof";
  const name = githubName(repo, deadline);
  if (name === null) return Date.now() >= deadline ? "timeout" : "not_github";
  const gh = ghBin(repo);
  if (gh === null) return "gh_unavailable";
  const left = deadline - Date.now();
  if (left <= 0) return "gh_unreachable";
  const r = (0, import_node_child_process5.spawnSync)(gh.bin, ["api", "--hostname", "github.com", `repos/${name}/commits/${head}/pulls`], {
    cwd: "/",
    env: { ...process.env, PATH: gh.dirs, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" },
    encoding: "utf-8",
    // D88: stderr is read into memory only, to tell an HTTP access error from a network failure; it is never logged.
    stdio: ["ignore", "pipe", "pipe"],
    timeout: left,
    maxBuffer: 16 * 1024 * 1024
  });
  if (r.error === void 0 && r.status === 4) return "gh_unavailable";
  if (r.error === void 0 && r.status !== 0 && /\bHTTP (401|403|404|422)\b/.test(r.stderr)) return "gh_denied";
  if (r.error !== void 0 || r.status !== 0) return "gh_unreachable";
  let prs;
  try {
    prs = JSON.parse(r.stdout);
  } catch {
    return "gh_unreachable";
  }
  if (!Array.isArray(prs)) return "gh_unreachable";
  const merged = prs.some((p) => typeof field(p, "merged_at") === "string" && field(field(p, "head"), "sha") === head && field(field(p, "base"), "ref") === base);
  return merged ? "merged" : "not_merged";
}
function mergedReady(repo, ledger, runStartedAt2, deadline = Date.now() + MERGED_BUDGET_MS) {
  const no = { ok: false, reason: "no_proof" };
  const row = readyRow(ledger);
  if (row === null) return no;
  if (fs10.lstatSync(path9.join(repo, ".oss", "dev", "active", row.feature), { throwIfNoEntry: false }) !== void 0) return no;
  const stale = { ok: false, reason: "ready_stale" };
  if (row.startedAt !== runStartedAt2) return stale;
  const at = Date.parse(row.at);
  const started = Date.parse(runStartedAt2);
  if (Number.isNaN(at) || Number.isNaN(started) || at < started) return stale;
  if (ledger.lastRow(`results/${row.feature}/ship`)?.sha256 !== row.sha256) return stale;
  const bytes = archivedResult(repo, row.feature, row.sha256);
  const result = bytes === null ? null : parseObject2(bytes);
  if (result === null) return no;
  const tested = testedRow(ledger, runStartedAt2);
  if (tested === null) return no;
  if (!onlyOssAfter(repo, row.headSha, tested.head, deadline)) return Date.now() >= deadline ? { ok: false, reason: "timeout" } : no;
  const base = field(result.diff, "baseRef");
  if (typeof base !== "string") return no;
  const proof = prMerged(repo, tested.head, base, deadline);
  return proof === "merged" ? { ok: true, result } : { ok: false, reason: proof };
}

// src/cli/phase-result.ts
var USAGE = "usage: oss-phase-result.sh assemble <ideate|plan|build|ship>\n       oss-phase-result.sh check <ideate|plan|build|ship> [--repo <path>] [--all]\n       oss-phase-result.sh check ship --record-ready\n";
var Refusal = class extends Error {
  id;
  field;
  detail;
  constructor(id, field2, detail) {
    super(id);
    this.id = id;
    this.field = field2;
    this.detail = detail;
  }
};
var HINT_ERRORS = /* @__PURE__ */ new Set(["diff_unavailable"]);
var NOT_IN_SNAPSHOT = "the base tip is not in the ship-start remote snapshot: update or push the base, then run ship start again";
function parseArgs(argv) {
  const [verb, phase, ...rest] = argv;
  if (verb !== "assemble" && verb !== "check" || !PHASES.includes(phase ?? "")) return null;
  const args = { verb, phase, repo: null, all: false, recordReady: false };
  if (verb === "check" && phase === "ship" && rest.length === 1 && rest[0] === "--record-ready") {
    args.recordReady = true;
    return args;
  }
  for (let i = 0; i < rest.length; i++) {
    if (verb === "check" && rest[i] === "--all") args.all = true;
    else if (verb === "check" && rest[i] === "--repo" && rest[i + 1] !== void 0) args.repo = rest[++i];
    else return null;
  }
  return args;
}
function headSha(repo) {
  return gitOut2(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
}
function shipBase(repo, dir) {
  const named = dir === null ? null : readValueFile(dir, "base.txt")?.replace(/\n$/, "");
  if (named != null && !named.includes("\n") && isLocalBranch(repo, named)) return named;
  return shipBaseConfig(repo);
}
function shipBaseConfig(repo) {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.PATH = "/usr/bin:/bin";
  const git2 = gitBin();
  if (git2 === "") return "";
  const r = (0, import_node_child_process6.spawnSync)(git2, ["config", "--local", "--get", "oss.shipBase"], {
    cwd: repo,
    env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1e4,
    maxBuffer: 64 * 1024
  });
  if (r.error === void 0 && r.status === 1) return "main";
  if (r.error === void 0 && r.status === 0) return r.stdout.replace(/\n$/, "");
  return "";
}
var MAX_ORIGIN_REFS = 1e3;
var SHA2 = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
var REMOTE_REF = "refs/remotes/";
function originSnapshot(ledger, startedAt) {
  const m = ledger.readMarker("run/ship.origin");
  const refs = m?.refs;
  if (m?.startedAt !== startedAt || typeof refs !== "object" || refs === null || Array.isArray(refs)) {
    throw new Refusal("no_base_snapshot", "run/ship.origin");
  }
  const entries = Object.entries(refs);
  if (entries.length > MAX_ORIGIN_REFS || !entries.every(([name, sha]) => name.startsWith(REMOTE_REF) && typeof sha === "string" && SHA2.test(sha))) {
    throw new Refusal("no_base_snapshot", "run/ship.origin");
  }
  return new Map(entries);
}
function checkShipBase(repo, base, feature, snapshot) {
  if (!isLocalBranch(repo, base)) return;
  const verdict = shipBaseCheck(repo, base, feature, snapshot);
  if (verdict === "timeout") throw new Refusal("diff_unavailable", "", DIFF_TIMEOUT);
  if (verdict !== "ok") throw new Refusal("unsafe_base", "base", verdict === "not_in_snapshot" ? NOT_IN_SNAPSHOT : void 0);
}
var NOT_ARCHIVED = "no completed folder of this branch's feature was added: update the local <base> branch (git fetch origin <base>, or update it in the worktree that has it checked out)";
var SEVERAL_ARCHIVED = "this branch added several completed folders";
var UNNAMED_BRANCH = "name the branch <type>/<feature>/<phase> (for example feat/<feature>/build) to re-run an archived feature";
var IGNORED_ARCHIVE = ".oss/dev/completed is git-ignored, so the branch diff cannot show this feature's archive: move .oss/dev/completed/<feature>-<date> back to .oss/dev/active/<feature>, then run /oss:ship again";
var ARCHIVED_HINTS = {
  none: NOT_ARCHIVED,
  several: SEVERAL_ARCHIVED,
  unnamed: UNNAMED_BRANCH,
  ignored: IGNORED_ARCHIVE
};
function runSnapshot(repo) {
  try {
    const ledger = openLedger(repo);
    return originSnapshot(ledger, runStartedAt(ledger, "ship"));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
var BASE_MARKER = "run/ship.base";
function recordedBase(repo) {
  try {
    const ledger = openLedger(repo);
    const m = ledger.readMarker(BASE_MARKER);
    return m?.startedAt === runStartedAt(ledger, "ship") && typeof m.base === "string" ? m.base : null;
  } catch {
    return null;
  }
}
function pluginRoot() {
  return path10.resolve(path10.dirname(fs11.realpathSync(process.argv[1] ?? "")), "..", "..", "..");
}
function isDirOf(p, uid) {
  const st = fs11.lstatSync(p, { throwIfNoEntry: false });
  return st !== void 0 && !st.isSymbolicLink() && st.isDirectory() && st.uid === uid;
}
function valueDir(repo) {
  const key2 = ledgerKey(repo);
  if (key2 === null) return null;
  const uid = process.getuid?.();
  const run = path10.join(os2.homedir(), ".oss", "run");
  const dir = path10.join(run, key2);
  return isDirOf(run, uid) && isDirOf(dir, uid) ? fs11.realpathSync(dir) : null;
}
function runStartedAt(ledger, phase) {
  const startedAt = ledger.lastRow(`run/${phase}`)?.startedAt;
  if (typeof startedAt !== "string") throw new Refusal("no_run_started", `run/${phase}`);
  return startedAt;
}
function runAssembler(phase, ctx, base, remoteRefs) {
  switch (phase) {
    case "ideate":
      return assembleIdeate(ctx);
    case "plan":
      return assemblePlan(ctx);
    case "build":
      return assembleBuild(ctx);
    case "ship": {
      if (base !== void 0) return assembleShip(ctx, { base, remoteRefs });
      const chosen = shipBase(ctx.repo, ctx.valueDir);
      const snapshot = originSnapshot(openLedger(ctx.repo), ctx.startedAt);
      checkShipBase(ctx.repo, chosen, ctx.feature, snapshot);
      return assembleShip(ctx, { base: chosen, remoteRefs: snapshot });
    }
  }
}
function checkSchema(phase, value) {
  const v = validate(loadPhaseSchema(phase, pluginRoot()), value);
  if (!v.ok) throw new Refusal(`invalid_result (${v.rule})`, v.path);
}
var PREVIOUS = { plan: "ideate", build: "plan", ship: "build" };
function startGate(repo, feature, phase, ledger, where) {
  const prev = PREVIOUS[phase];
  if (prev === void 0 || parseRunRow(ledger.lastRow(`run/${phase}`))?.feature !== "") return;
  const exists = (p) => fs11.lstatSync(p, { throwIfNoEntry: false }) !== void 0;
  const legacy = !exists(path10.join(repo, ".oss", "dev", where.kind, where.name, "results")) && !exists(path10.join(ledger.dir, "results", feature));
  if (legacy) return;
  try {
    check(repo, feature, prev, where);
  } catch {
    throw new Refusal("no_prev_result", prev);
  }
}
function assemble(repo, feature, phase, where) {
  const ledger = openLedger(repo);
  const startedAt = runStartedAt(ledger, phase);
  startGate(repo, feature, phase, ledger, where);
  const ctx = {
    repo,
    feature,
    startedAt,
    headSha: headSha(repo) ?? "",
    valueDir: valueDir(repo),
    now: () => /* @__PURE__ */ new Date(),
    featureDir: path10.join(repo, ".oss", "dev", where.kind, where.name)
  };
  const outcome = runAssembler(phase, ctx);
  if (!outcome.ok) {
    if (outcome.detail !== void 0 && HINT_ERRORS.has(outcome.error)) throw new Refusal(outcome.error, "", outcome.detail);
    throw new Refusal(outcome.error, outcome.detail ?? phase);
  }
  checkSchema(phase, outcome.result);
  const written = writeResult(repo, feature, phase, outcome.result, {}, where);
  const read = readBack(repo, feature, phase, written, where);
  if (!read.ok) throw new Refusal(read.error, `results/${phase}.json`);
  ledger.appendRow(`results/${feature}/${phase}`, {
    sha256: sha256(written.bytes),
    feature,
    phase,
    startedAt,
    headSha: outcome.result.headSha,
    session: process.env.CLAUDE_CODE_SESSION_ID ?? ""
  });
  const baseRef = outcome.result.diff?.baseRef;
  if (phase === "ship" && typeof baseRef === "string") ledger.writeMarker(BASE_MARKER, { startedAt, base: baseRef });
  ledger.clearMarker(`pending/${feature}/${phase}`);
  ledger.clearMarker(`unverified/${feature}/${phase}`);
  clearUnverifiedMarker(repo, feature, phase, where);
  return outcome.result;
}
function reassemble(repo, feature, phase, stored, where) {
  let tmp = null;
  let dir = valueDir(repo);
  let base;
  let remoteRefs;
  if (phase === "ship") {
    try {
      remoteRefs = originSnapshot(openLedger(repo), String(stored.startedAt));
    } catch {
      remoteRefs = void 0;
    }
    const recorded = stored.diff?.baseRef;
    base = typeof recorded === "string" ? recorded : "";
    tmp = fs11.mkdtempSync(path10.join(os2.tmpdir(), "oss-phase-result-"));
    const requested = Array.isArray(stored.overrides) ? stored.overrides : [];
    const overrides = requested.map((o) => ({ finding: o.finding, decisionId: o.decisionId, ...o.gate === void 0 ? {} : { gate: o.gate } }));
    fs11.writeFileSync(path10.join(tmp, "overrides.json"), JSON.stringify(overrides), { mode: 384 });
    dir = tmp;
  }
  try {
    return runAssembler(phase, {
      repo,
      feature,
      startedAt: String(stored.startedAt),
      headSha: String(stored.headSha),
      valueDir: dir,
      evidenceCutoff: typeof stored.evidenceCutoff === "string" ? stored.evidenceCutoff : null,
      featureDir: path10.join(repo, ".oss", "dev", where.kind, where.name),
      // D51: ship reads every fail row, so a stored verdictsFrom (D47, results from rounds 6-7) is ignored.
      now: () => /* @__PURE__ */ new Date()
    }, base, remoteRefs);
  } finally {
    if (tmp !== null) fs11.rmSync(tmp, { recursive: true, force: true });
  }
}
var CODE_FIELDS = {
  ideate: ["decisions", "decisionsRecorded", "designCommitted"],
  plan: [],
  build: ["testRuns", "evidenceTrust"],
  ship: ["diff", "gateEvidence", "uncapturedGates", "overrides", "blockers", "verdict"]
};
function check(repo, feature, phase, where = { kind: "active", name: feature }) {
  const ledger = openLedger(repo);
  const marker = path10.join(repo, ".oss", "dev", where.kind, where.name, "results", `${phase}.unverified.json`);
  if (fs11.lstatSync(marker, { throwIfNoEntry: false }) !== void 0) throw new Refusal("unverified", "marker");
  for (const kind of ["pending", "unverified"]) {
    if (ledger.hasMarker(`${kind}/${feature}/${phase}`)) throw new Refusal("unverified", `${kind} marker`);
  }
  const read = readResult(repo, feature, phase, where);
  if (!read.ok) throw new Refusal(read.error, `results/${phase}.json`);
  const value = read.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Refusal("invalid_result", "$");
  const stored = value;
  if (stored.feature !== feature) throw new Refusal("stale_result", "feature");
  if (stored.phase !== phase) throw new Refusal("stale_result", "phase");
  if (ledger.lastRow(`results/${feature}/${phase}`)?.sha256 !== sha256(read.bytes)) {
    throw new Refusal("unbound_result", "sha256");
  }
  checkSchema(phase, stored);
  if (stored.startedAt !== runStartedAt(ledger, phase)) throw new Refusal("stale_result", "startedAt");
  if (phase === "ship" && stored.headSha !== headSha(repo)) {
    throw new Refusal("stale_result", "headSha");
  }
  if (stored.verification !== "verified") throw new Refusal("unverified", "verification");
  const fresh = reassemble(repo, feature, phase, stored, where);
  if (!fresh.ok) throw new Refusal("evidence_mismatch", fresh.error);
  for (const field2 of CODE_FIELDS[phase]) {
    if (JSON.stringify(stored[field2]) !== JSON.stringify(fresh.result[field2])) {
      throw new Refusal("evidence_mismatch", field2);
    }
  }
  return stored;
}
function verdictOf(fn) {
  try {
    fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, id: e.id, field: e.field, detail: e.detail };
    if (e instanceof LedgerError) return { ok: false, id: e.code, field: "ledger" };
    const msg = e instanceof Error ? e.message : String(e);
    const id = /^([a-z_]+):/.exec(msg)?.[1] ?? "internal_error";
    return { ok: false, id, field: "store" };
  }
}
function refuse(args, id, field2, detail, rebuild = true) {
  const reason = `${id}${detail === void 0 ? "" : `: ${detail}`}${field2 === "" ? "" : ` (field ${field2})`}`;
  process.stderr.write(`phase-result: ${args.verb} ${args.phase}: ${reason}${rebuild ? `; rebuild: oss-phase-result.sh assemble ${args.phase}` : ""}
`);
  return 1;
}
function gateLabel(phase, result) {
  return phase === "ship" ? { gateEvidence: result.gateEvidence, uncapturedGates: result.uncapturedGates } : {};
}
function recordReady(args, repo, feature, where, missing) {
  const v = feature === null ? missing : verdictOf(() => {
    const stored = check(repo, feature, "ship", where);
    if (stored.verdict !== "ready_to_merge") throw new Refusal("not_ready_to_merge", "verdict");
    const ledger = openLedger(repo);
    const bound = ledger.lastRow(`results/${feature}/ship`)?.sha256;
    if (typeof bound !== "string" || !/^[0-9a-f]{64}$/.test(bound)) throw new Refusal("unbound_result", "sha256");
    ledger.appendRow(READY_ROW, { feature, headSha: stored.headSha, sha256: bound, startedAt: stored.startedAt, at: (/* @__PURE__ */ new Date()).toISOString() });
  });
  if (!v.ok) {
    const revoked = verdictOf(() => openLedger(repo).appendRow(READY_ROW, { revoked: v.id, at: (/* @__PURE__ */ new Date()).toISOString() }));
    return refuse(args, v.id, v.field, revoked.ok ? v.detail : `${v.detail === void 0 ? "" : `${v.detail}; `}${NOT_REVOKED}`);
  }
  process.stdout.write("READY_RECORDED\n");
  return 0;
}
var NOT_REVOKED = "the earlier ready row could not be revoked (the ledger append failed)";
var MERGE_HINTS = {
  not_github: "complete after merged needs a github.com origin to confirm the merge; this repo's origin is not on github.com",
  gh_unavailable: "gh is not installed or not logged in: run gh auth login, then send complete again",
  gh_unreachable: "GitHub could not be reached: send complete again when online",
  gh_denied: "gh could not read this pull request: check gh auth status and access to the origin repository",
  not_merged: "GitHub does not show this PR as merged yet: merge it, then send complete again",
  ready_stale: "the ready row no longer matches the ship result: run oss-phase-result.sh check ship --record-ready, then send complete again"
};
function mergeProof(repo, deadline) {
  try {
    const ledger = openLedger(repo);
    return mergedReady(repo, ledger, runStartedAt(ledger, "ship"), deadline);
  } catch {
    return { ok: false, reason: "no_proof" };
  }
}
function mergedOrRefuse(args, repo, v, deadline, merged = false) {
  if (args.phase === "ship" && args.verb === "check") {
    const proof = mergeProof(repo, deadline);
    if (proof.ok) {
      process.stdout.write(`${JSON.stringify({ verification: "verified", ...gateLabel("ship", proof.result), verdict: "ready_to_merge", merged: true })}
`);
      return 0;
    }
    if (proof.reason === "timeout") return refuse(args, "diff_unavailable", "", DIFF_TIMEOUT, false);
    if (proof.reason !== "no_proof") return refuse(args, v.id, v.field, MERGE_HINTS[proof.reason], !merged);
    if (merged) return refuse(args, v.id, v.field, v.id === "no_feature" ? void 0 : v.detail, false);
  }
  return refuse(args, v.id, v.field, v.detail);
}
function main(argv) {
  const deadline = Date.now() + MERGED_BUDGET_MS;
  const args = parseArgs(argv);
  if (args === null) {
    process.stderr.write(USAGE);
    return 2;
  }
  const repo = resolveRepo(args.repo ?? process.cwd());
  if (repo === null) return refuse(args, "no_repo", "repo");
  if (args.all) {
    for (const feature2 of activeFeatures(repo)) {
      const v2 = verdictOf(() => {
        if (args.phase !== "ship") {
          check(repo, feature2, args.phase);
          return;
        }
        const a = shipArchivable(repo, feature2, pluginRoot());
        if (!a.ok) throw new Refusal(a.reason, "archive");
      });
      process.stdout.write(`${feature2} ${v2.ok ? "ok" : v2.id}
`);
    }
    return 0;
  }
  let feature = resolveFeature(repo);
  let where = { kind: "active", name: feature ?? "" };
  let missing = { ok: false, id: "no_feature", field: "feature" };
  if (feature === null && args.phase === "ship") {
    const archived = archivedFeature(repo, recordedBase(repo) ?? shipBase(repo, valueDir(repo)), runSnapshot(repo), deadline);
    if (archived.ok) {
      feature = archived.feature;
      where = { kind: "completed", name: archived.folder };
    } else {
      missing = archived.reason === "timeout" ? { ok: false, id: "diff_unavailable", field: "", detail: DIFF_TIMEOUT } : { ok: false, id: "no_feature", field: "feature", detail: ARCHIVED_HINTS[archived.reason] };
    }
  }
  if (args.recordReady) return recordReady(args, repo, feature, where, missing);
  if (feature === null) return missing.id === "diff_unavailable" ? refuse(args, missing.id, missing.field, missing.detail) : mergedOrRefuse(args, repo, missing, deadline, true);
  if (args.verb === "assemble") {
    let result = {};
    const v2 = verdictOf(() => {
      result = assemble(repo, feature, args.phase, where);
    });
    if (!v2.ok) return refuse(args, v2.id, v2.field, v2.detail);
    const outcome = args.phase === "ship" ? { verdict: result.verdict, blockers: result.blockers } : {};
    process.stdout.write(`${JSON.stringify({ verification: result.verification, phase: args.phase, ...gateLabel(args.phase, result), ...outcome })}
`);
    return 0;
  }
  let stored = {};
  const v = verdictOf(() => {
    stored = check(repo, feature, args.phase, where);
  });
  if (!v.ok) return mergedOrRefuse(args, repo, v, deadline, where.kind === "completed");
  if (args.phase === "ship" && where.kind === "completed") return mergedOrRefuse(args, repo, { ok: false, id: "not_merged", field: "" }, deadline, true);
  const verdict = args.phase === "ship" ? { verdict: stored.verdict } : {};
  process.stdout.write(`${JSON.stringify({ verification: "verified", ...gateLabel(args.phase, stored), ...verdict })}
`);
  return 0;
}
process.exitCode = main(process.argv.slice(2));
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
