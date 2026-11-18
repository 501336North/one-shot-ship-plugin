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
var import_node_child_process4 = require("node:child_process");
var fs10 = __toESM(require("node:fs"), 1);
var os2 = __toESM(require("node:os"), 1);
var path9 = __toESM(require("node:path"), 1);

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
  const git = gitBin();
  if (git === "") return null;
  try {
    const top = (0, import_child_process.execFileSync)(git, ["rev-parse", "--show-toplevel"], {
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
function resultsDir(repo, feature, create) {
  let cur = repo;
  for (const comp of [".oss", "dev", "active", feature, "results"]) {
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
function writeResult(repo, feature, phase, obj, hooks = {}) {
  checkNames(feature, phase);
  const data = JSON.stringify(obj);
  if (Buffer.byteLength(data) > RESULT_CAP) throw new Error("too_large: result over 256 KB");
  const dir = resultsDir(repo, feature, true);
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
function readBack(repo, feature, phase, written) {
  const read = readResult(repo, feature, phase);
  if (!read.ok) return read;
  if (read.dev !== written.dev || read.ino !== written.ino || !read.bytes.equals(written.bytes)) {
    return { ok: false, error: "result_changed" };
  }
  return { ...read, bytes: written.bytes };
}
function clearUnverifiedMarker(repo, feature, phase) {
  checkNames(feature, phase);
  const dir = resultsDir(repo, feature, false);
  if (dir === null) return;
  try {
    fs3.unlinkSync(path2.join(dir, `${phase}.unverified.json`));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
function readResult(repo, feature, phase) {
  checkNames(feature, phase);
  let dir;
  try {
    dir = resultsDir(repo, feature, false);
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
function take(line, start, results) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return true;
  }
  const ts = typeof event.ts === "string" ? Date.parse(event.ts) : NaN;
  if (ts < start) return false;
  if (event.kind === "test-run" && (event.result === "red" || event.result === "green")) results.push(event.result);
  return true;
}
function scanBackwards(fd, size, start, readChunk) {
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
      if (!take(lines[i], start, results)) return { results, truncated: false };
    }
  }
  return { results, truncated: false };
}
function assembleBuild(ctx, opts = {}) {
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
    scan = scanBackwards(fd, st.size, Date.parse(ctx.startedAt), opts.readChunk ?? import_node_fs.default.readSync);
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
function readOpenQuestions(ctx) {
  const raw = readValue(ctx, "open-questions.json");
  const parsed = raw === null ? [] : parseJsonOr(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((q) => typeof q === "string").map((q) => clipText(q, TEXT_CAP) ?? "");
}
function assembleIdeate(ctx) {
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
      openQuestions: readOpenQuestions(ctx)
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
};
function runGit(repo, args, okCodes = [0], raw = false) {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.PATH = "/usr/bin:/bin";
  const git = gitBin();
  if (git === "") throw new GitError("no git");
  const r = (0, import_node_child_process3.spawnSync)(git, ["-c", "core.fsmonitor=", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repo,
    env,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1e4,
    maxBuffer: 1024 * 1024
  });
  if (r.error !== void 0 || r.status === null || !okCodes.includes(r.status)) throw new GitError(args[0]);
  return { status: r.status, out: raw ? r.stdout : r.stdout.trim() };
}
function isLocalBranch(repo, name) {
  if (name === "" || name.startsWith("-")) return false;
  try {
    runGit(repo, ["check-ref-format", "--branch", name]);
    runGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${name}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
function originBranchTip(repo, name) {
  try {
    return runGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/remotes/origin/${name}^{commit}`]).out;
  } catch {
    return null;
  }
}
function hasOriginBranch(repo, name) {
  try {
    runGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/remotes/origin/${name}^{commit}`]);
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
function originDefaultTip(repo) {
  let ref = "refs/remotes/origin/main";
  try {
    const sym = runGit(repo, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]).out;
    if (sym.startsWith("refs/remotes/origin/") && sym !== "refs/remotes/origin/HEAD") ref = sym;
  } catch {
  }
  try {
    return runGit(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]).out;
  } catch {
    return null;
  }
}
function isAncestor(repo, a, b) {
  try {
    return runGit(repo, ["merge-base", "--is-ancestor", "--end-of-options", a, b], [0, 1]).status === 0;
  } catch {
    return false;
  }
}
function reflogCreatedAt(repo, ref) {
  try {
    const lines = runGit(repo, ["reflog", "show", "--date=unix", "--format=%gd", ref]).out.split("\n");
    const m = /@\{(\d+)\}$/.exec(lines[lines.length - 1] ?? "");
    return m === null ? null : Number(m[1]) * 1e3;
  } catch {
    return null;
  }
}
function readDiff(repo, base) {
  if (base.startsWith("-")) throw new GitError("base");
  const branch = runGit(repo, ["check-ref-format", "--branch", base]).out;
  const tip = runGit(repo, ["rev-parse", "--verify", "--end-of-options", `refs/heads/${branch}^{commit}`]).out;
  const headSha2 = runGit(repo, ["rev-parse", "--verify", "HEAD^{commit}"]).out;
  const mergeBase = runGit(repo, ["merge-base", tip, headSha2]).out;
  const sameTree = runGit(repo, ["diff", "--quiet", "--no-ext-diff", "--no-textconv", tip, headSha2], [0, 1]).status === 0;
  const stat = runGit(repo, ["diff", "--shortstat", "--no-renames", "--no-ext-diff", "--no-textconv", mergeBase, headSha2]).out;
  const num2 = (re) => Number(re.exec(stat)?.[1] ?? 0);
  const files = num2(/(\d+) files? changed/);
  return {
    base: mergeBase,
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
function agentRow(row) {
  const f = row.findings;
  const at = typeof row.ts === "string" ? Date.parse(row.ts) : NaN;
  if (typeof row.gate !== "string" || row.verdict !== "pass" && row.verdict !== "fail" || Number.isNaN(at)) return null;
  if (typeof f !== "object" || f === null || Array.isArray(f)) return null;
  const findings = {};
  for (const s of SEVERITIES) {
    const n = f[s];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
    findings[s] = n;
  }
  const hex = (v) => typeof v === "string" && TREE_RE.test(v) ? v : null;
  return {
    gate: row.gate,
    verdict: row.verdict,
    findings,
    at,
    tree: hex(row.tree),
    trackedTree: hex(row.trackedTree),
    headSha: hex(row.headSha),
    startMatch: row.start === "match"
  };
}
var TREE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
function reviewedIsShipped(repo, tree, trackedTree, reviewHead) {
  try {
    const status = runGit(
      repo,
      ["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--end-of-options", tree, "HEAD", "--", ".", ":(exclude).oss"],
      [0],
      true
    ).out.split("\0");
    if (status[status.length - 1] === "") status.pop();
    const deleted = [];
    for (let k = 0; k + 1 < status.length; k += 2) {
      if (status[k] !== "D") return false;
      deleted.push(status[k + 1]);
    }
    if (status.length % 2 !== 0) return false;
    if (deleted.length === 0) return true;
    if (reviewHead === null) return false;
    const listed = (treeish) => runGit(repo, ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", "--end-of-options", treeish, "--", ...deleted], [0], true).out;
    return listed(trackedTree) === "" && listed(reviewHead) === "";
  } catch {
    return false;
  }
}
function timelineGates(ctx, featureDir, gateHashes) {
  const backed = [];
  for (const line of repoLines(path6.join(featureDir, "timeline.ndjson"))) {
    if (!gateHashes.has(sha256(line))) continue;
    const rec = parseJsonObject(line);
    if (rec !== null && rec.kind === "gate" && rec.feature === ctx.feature && typeof rec.round === "number") {
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
var LOW_PLUS_GATES = /* @__PURE__ */ new Set(["security", "pen-test"]);
var CAPTURE_ADDS_GATE = "pen-test";
function ruleVerdict(gate, row, fixed) {
  const counted = LOW_PLUS_GATES.has(gate) ? ["critical", "high", "medium", "low"] : ["critical", "high"];
  const unfixed = counted.reduce((n, s) => n + Math.max(0, row.findings[s] - fixed[s]), 0);
  if (unfixed > 0) return "fail";
  if (counted.some((s) => row.findings[s] > 0)) return "pass";
  return row.verdict;
}
var NOT_RE_REVIEWED = "captured fail, not re-reviewed";
function applyAgentVerdicts(tl, verdictRows, runStart, repo) {
  const byGate = /* @__PURE__ */ new Map();
  const shipped = /* @__PURE__ */ new Map();
  for (const raw of verdictRows) {
    const row = agentRow(raw);
    if (row === null || !(row.at >= runStart)) continue;
    let counts2 = false;
    if (row.verdict === "pass" && row.startMatch && row.tree !== null && row.trackedTree !== null) {
      const key2 = `${row.tree} ${row.trackedTree} ${row.headSha ?? ""}`;
      if (!shipped.has(key2)) shipped.set(key2, reviewedIsShipped(repo, row.tree, row.trackedTree, row.headSha));
      counts2 = shipped.get(key2) === true;
    }
    const blind = row.verdict === "pass" && row.startMatch && row.tree === null && row.headSha !== null;
    if (row.verdict === "fail" || counts2 || blind) byGate.set(row.gate, [...byGate.get(row.gate) ?? [], { row, counts: counts2, blind }]);
  }
  const stale = /* @__PURE__ */ new Set();
  for (const [name, rows] of byGate) {
    const zero = counts({});
    const gate = tl.byName.get(name) ?? (name === CAPTURE_ADDS_GATE ? { gate: name, verdict: "pass", findings: zero, fixed: zero, source: "agent" } : void 0);
    if (gate === void 0) continue;
    rows.sort((a, b) => a.row.at - b.row.at);
    const passes = rows.filter((r) => r.counts).map((r) => r.row);
    const blinds = rows.filter((r) => r.blind).map((r) => r.row);
    const open = rows.filter((r) => r.row.verdict === "fail").map((r) => r.row).filter((f) => !passes.some((p) => p.at > f.at && p.tree !== f.tree)).filter((f) => !blinds.some((b) => b.at > f.at && b.headSha !== f.headSha));
    if (open.length > 0) {
      tl.byName.set(name, { ...gate, verdict: "fail", findings: open[open.length - 1].findings, source: "agent" });
      stale.add(name);
      continue;
    }
    if (passes.length === 0) continue;
    const pick = passes[passes.length - 1];
    tl.byName.set(name, { ...gate, verdict: ruleVerdict(name, pick, gate.fixed), findings: pick.findings, source: "agent" });
  }
  return stale;
}
function readOverrides(ctx, featureDir, decisionRows) {
  const recorded = /* @__PURE__ */ new Map();
  for (const line of repoLines(path6.join(featureDir, "decisions.ndjson"))) {
    const rec = parseJsonObject(line);
    if (rec === null || rec.feature !== ctx.feature || typeof rec.id !== "string") continue;
    const h = sha256(line);
    const ok = decisionRows.some((r) => r.id === rec.id && r.feature === ctx.feature && r.sha256 === h);
    if (ok) recorded.set(rec.id, rec.person);
  }
  const raw = readValue(ctx, "overrides.json");
  const requested = raw === null ? [] : parseJsonOr(raw, null);
  if (!Array.isArray(requested)) return { ok: false, error: "override_unrecorded", detail: "overrides.json" };
  const overrides = [];
  for (const item of requested) {
    const id = item?.decisionId;
    if (typeof id !== "string" || !recorded.has(id)) return { ok: false, error: "override_unrecorded" };
    const person = recorded.get(id);
    overrides.push({
      finding: redactModelText(typeof item?.finding === "string" ? item.finding : ""),
      decisionId: id,
      person: typeof person === "string" ? person : JSON.stringify(person ?? null)
    });
  }
  return { ok: true, overrides };
}
function assembleShip(ctx, opts) {
  let diff;
  try {
    diff = readDiff(ctx.repo, opts.base);
  } catch {
    return { ok: false, error: "diff_unavailable" };
  }
  if (diff.empty) return { ok: false, error: "empty_diff" };
  const featureDir = path6.join(ctx.repo, ".oss", "dev", "active", ctx.feature);
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
  const timeline = timelineGates(ctx, featureDir, gateHashes);
  const notReReviewed = applyAgentVerdicts(timeline, verdictRows, Date.parse(ctx.startedAt), ctx.repo);
  const byName = timeline.byName;
  for (const required of opts.requiredGates ?? DEFAULT_REQUIRED_GATES) {
    if (!byName.has(required)) return { ok: false, error: "gate_missing", detail: required };
  }
  const gates = [...byName.values()];
  const read = readOverrides(ctx, featureDir, decisionRows);
  if (!read.ok) return read;
  const blockers = gates.filter((g) => g.verdict !== "pass").map((g) => notReReviewed.has(g.gate) ? `gate:${g.gate} (${NOT_RE_REVIEWED})` : `gate:${g.gate}`);
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
function resolveFeature(repo) {
  const ref = gitOut2(repo, ["symbolic-ref", "-q", "HEAD"]);
  const branch = ref !== null && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
  const m = BRANCH_RE.exec(branch);
  if (m !== null) {
    const f = m[1];
    const st = fs9.lstatSync(path8.join(repo, ".oss", "dev", "active", f), { throwIfNoEntry: false });
    return FEATURE_RE2.test(f) && st?.isDirectory() ? f : null;
  }
  const active = activeFeatures(repo);
  return active.length === 1 ? active[0] : null;
}

// src/cli/phase-result.ts
var USAGE = "usage: oss-phase-result.sh assemble <ideate|plan|build|ship>\n       oss-phase-result.sh check <ideate|plan|build|ship> [--repo <path>] [--all]\n";
var Refusal = class extends Error {
  id;
  field;
  constructor(id, field) {
    super(id);
    this.id = id;
    this.field = field;
  }
};
function parseArgs(argv) {
  const [verb, phase, ...rest] = argv;
  if (verb !== "assemble" && verb !== "check" || !PHASES.includes(phase ?? "")) return null;
  const args = { verb, phase, repo: null, all: false };
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
  const configured = shipBaseConfig(repo);
  const named = dir === null ? null : readValueFile(dir, "base.txt")?.replace(/\n$/, "");
  if (named != null && !named.includes("\n") && isLocalBranch(repo, named)) {
    if (named === "main" || named === configured || hasOriginBranch(repo, named)) return named;
    throw new Refusal("unsafe_base", "base.txt");
  }
  return configured;
}
function shipBaseConfig(repo) {
  const env = gitEnv();
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.PATH = "/usr/bin:/bin";
  const git = gitBin();
  if (git === "") return "";
  const r = (0, import_node_child_process4.spawnSync)(git, ["config", "--local", "--get", "oss.shipBase"], {
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
function checkShipBase(repo, base, configured, startedAt) {
  if (!isLocalBranch(repo, base)) return;
  const start = Date.parse(startedAt);
  const before = (created) => created !== null && created <= start;
  const tip = branchTip(repo, base);
  if (tip === null) throw new Refusal("unsafe_base", "base");
  const origin = originDefaultTip(repo);
  const onDefault = origin !== null && isAncestor(repo, tip, origin);
  const remote = onDefault ? null : originBranchTip(repo, base);
  const onRemote = remote !== null && isAncestor(repo, tip, remote) && before(reflogCreatedAt(repo, `refs/remotes/origin/${base}`));
  if (!onDefault && !onRemote) throw new Refusal("unsafe_base", "base");
  for (const name of /* @__PURE__ */ new Set([base, configured])) {
    if (!isLocalBranch(repo, name)) continue;
    const created = reflogCreatedAt(repo, `refs/heads/${name}`);
    if (created !== null && !before(created)) throw new Refusal("unsafe_base", "base");
  }
}
function pluginRoot() {
  return path9.resolve(path9.dirname(fs10.realpathSync(process.argv[1] ?? "")), "..", "..", "..");
}
function isDirOf(p, uid) {
  const st = fs10.lstatSync(p, { throwIfNoEntry: false });
  return st !== void 0 && !st.isSymbolicLink() && st.isDirectory() && st.uid === uid;
}
function valueDir(repo) {
  const key2 = ledgerKey(repo);
  if (key2 === null) return null;
  const uid = process.getuid?.();
  const run = path9.join(os2.homedir(), ".oss", "run");
  const dir = path9.join(run, key2);
  return isDirOf(run, uid) && isDirOf(dir, uid) ? fs10.realpathSync(dir) : null;
}
function runStartedAt(ledger, phase) {
  const startedAt = ledger.lastRow(`run/${phase}`)?.startedAt;
  if (typeof startedAt !== "string") throw new Refusal("no_run_started", `run/${phase}`);
  return startedAt;
}
function runAssembler(phase, ctx, base) {
  switch (phase) {
    case "ideate":
      return assembleIdeate(ctx);
    case "plan":
      return assemblePlan(ctx);
    case "build":
      return assembleBuild(ctx);
    case "ship": {
      if (base !== void 0) return assembleShip(ctx, { base });
      const chosen = shipBase(ctx.repo, ctx.valueDir);
      checkShipBase(ctx.repo, chosen, shipBaseConfig(ctx.repo), ctx.startedAt);
      return assembleShip(ctx, { base: chosen });
    }
  }
}
function checkSchema(phase, value) {
  const v = validate(loadPhaseSchema(phase, pluginRoot()), value);
  if (!v.ok) throw new Refusal(`invalid_result (${v.rule})`, v.path);
}
var PREVIOUS = { plan: "ideate", build: "plan", ship: "build" };
function startGate(repo, feature, phase, ledger) {
  const prev = PREVIOUS[phase];
  if (prev === void 0 || parseRunRow(ledger.lastRow(`run/${phase}`))?.feature !== "") return;
  const exists = (p) => fs10.lstatSync(p, { throwIfNoEntry: false }) !== void 0;
  const legacy = !exists(path9.join(repo, ".oss", "dev", "active", feature, "results")) && !exists(path9.join(ledger.dir, "results", feature));
  if (legacy) return;
  try {
    check(repo, feature, prev);
  } catch {
    throw new Refusal("no_prev_result", prev);
  }
}
function assemble(repo, feature, phase) {
  const ledger = openLedger(repo);
  const startedAt = runStartedAt(ledger, phase);
  startGate(repo, feature, phase, ledger);
  const ctx = {
    repo,
    feature,
    startedAt,
    headSha: headSha(repo) ?? "",
    valueDir: valueDir(repo),
    now: () => /* @__PURE__ */ new Date()
  };
  const outcome = runAssembler(phase, ctx);
  if (!outcome.ok) throw new Refusal(outcome.error, outcome.detail ?? phase);
  checkSchema(phase, outcome.result);
  const written = writeResult(repo, feature, phase, outcome.result);
  const read = readBack(repo, feature, phase, written);
  if (!read.ok) throw new Refusal(read.error, `results/${phase}.json`);
  ledger.appendRow(`results/${feature}/${phase}`, {
    sha256: sha256(written.bytes),
    feature,
    phase,
    startedAt,
    headSha: outcome.result.headSha,
    session: process.env.CLAUDE_CODE_SESSION_ID ?? ""
  });
  ledger.clearMarker(`pending/${feature}/${phase}`);
  ledger.clearMarker(`unverified/${feature}/${phase}`);
  clearUnverifiedMarker(repo, feature, phase);
  return outcome.result;
}
function reassemble(repo, feature, phase, stored) {
  let tmp = null;
  let dir = valueDir(repo);
  let base;
  if (phase === "ship") {
    const recorded = stored.diff?.baseRef;
    base = typeof recorded === "string" ? recorded : "";
    tmp = fs10.mkdtempSync(path9.join(os2.tmpdir(), "oss-phase-result-"));
    const requested = Array.isArray(stored.overrides) ? stored.overrides : [];
    const overrides = requested.map((o) => ({ finding: o.finding, decisionId: o.decisionId }));
    fs10.writeFileSync(path9.join(tmp, "overrides.json"), JSON.stringify(overrides), { mode: 384 });
    dir = tmp;
  }
  try {
    return runAssembler(phase, {
      repo,
      feature,
      startedAt: String(stored.startedAt),
      headSha: String(stored.headSha),
      valueDir: dir,
      now: () => /* @__PURE__ */ new Date()
    }, base);
  } finally {
    if (tmp !== null) fs10.rmSync(tmp, { recursive: true, force: true });
  }
}
var CODE_FIELDS = {
  ideate: ["decisions", "decisionsRecorded", "designCommitted"],
  plan: [],
  build: ["testRuns", "evidenceTrust"],
  ship: ["diff", "gateEvidence", "uncapturedGates", "overrides", "blockers", "verdict"]
};
function check(repo, feature, phase) {
  const ledger = openLedger(repo);
  const marker = path9.join(repo, ".oss", "dev", "active", feature, "results", `${phase}.unverified.json`);
  if (fs10.lstatSync(marker, { throwIfNoEntry: false }) !== void 0) throw new Refusal("unverified", "marker");
  for (const kind of ["pending", "unverified"]) {
    if (ledger.hasMarker(`${kind}/${feature}/${phase}`)) throw new Refusal("unverified", `${kind} marker`);
  }
  const read = readResult(repo, feature, phase);
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
  const fresh = reassemble(repo, feature, phase, stored);
  if (!fresh.ok) throw new Refusal("evidence_mismatch", fresh.error);
  for (const field of CODE_FIELDS[phase]) {
    if (JSON.stringify(stored[field]) !== JSON.stringify(fresh.result[field])) {
      throw new Refusal("evidence_mismatch", field);
    }
  }
  return stored;
}
function verdictOf(fn) {
  try {
    fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, id: e.id, field: e.field };
    if (e instanceof LedgerError) return { ok: false, id: e.code, field: "ledger" };
    const msg = e instanceof Error ? e.message : String(e);
    const id = /^([a-z_]+):/.exec(msg)?.[1] ?? "internal_error";
    return { ok: false, id, field: "store" };
  }
}
function refuse(args, id, field) {
  process.stderr.write(
    `phase-result: ${args.verb} ${args.phase}: ${id} (field ${field}); rebuild: oss-phase-result.sh assemble ${args.phase}
`
  );
  return 1;
}
function gateLabel(phase, result) {
  return phase === "ship" ? { gateEvidence: result.gateEvidence, uncapturedGates: result.uncapturedGates } : {};
}
function main(argv) {
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
  const feature = resolveFeature(repo);
  if (feature === null) return refuse(args, "no_feature", "feature");
  if (args.verb === "assemble") {
    let result = {};
    const v2 = verdictOf(() => {
      result = assemble(repo, feature, args.phase);
    });
    if (!v2.ok) return refuse(args, v2.id, v2.field);
    process.stdout.write(`${JSON.stringify({ verification: result.verification, phase: args.phase, ...gateLabel(args.phase, result) })}
`);
    return 0;
  }
  let stored = {};
  const v = verdictOf(() => {
    stored = check(repo, feature, args.phase);
  });
  if (!v.ok) return refuse(args, v.id, v.field);
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
