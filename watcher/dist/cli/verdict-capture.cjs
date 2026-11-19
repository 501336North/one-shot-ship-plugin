#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/cli/verdict-capture.ts
var fs6 = __toESM(require("node:fs"), 1);

// src/phase-results/verdict-capture.ts
var import_node_child_process3 = require("node:child_process");
var fs5 = __toESM(require("node:fs"), 1);
var os2 = __toESM(require("node:os"), 1);
var path3 = __toESM(require("node:path"), 1);

// src/phase-results/ledger.ts
var import_node_child_process = require("node:child_process");
var import_node_crypto = require("node:crypto");
var fs = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path = __toESM(require("node:path"), 1);
var LedgerError = class extends Error {
  code;
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LedgerError";
    this.code = code;
  }
};
var MAX_ROW_BYTES = 512;
var SMALL_CAP = 1024 * 1024;
var LARGE_CAP = 4 * 1024 * 1024;
var SEGMENT = /^[A-Za-z0-9._-]+$/;
var TAIL_BYTES = 4096;
var GIT_TIMEOUT_MS = 2e3;
function gitBin() {
  for (const p of ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git", "/bin/git"]) {
    try {
      if (!fs.statSync(p).isFile()) continue;
      fs.accessSync(p, fs.constants.X_OK);
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
    const out = (0, import_node_child_process.execFileSync)(gitBin(), args, {
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
    physical = fs.realpathSync(cwd);
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
  return (0, import_node_crypto.createHash)("sha1").update(`blob ${content.length}\0`).update(content).digest("hex").slice(0, 16);
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
  const root = path.join(os.homedir(), ".oss", "ledger");
  const keyDir = path.join(root, key2);
  function ensureDirs(dirParts, create) {
    if (create) fs.mkdirSync(path.dirname(root), { recursive: true, mode: 448 });
    let cur = root;
    for (const seg of [null, key2, ...dirParts]) {
      if (seg !== null) cur = path.join(cur, seg);
      let st;
      try {
        st = fs.lstatSync(cur);
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e;
        if (!create) return false;
        try {
          fs.mkdirSync(cur, { mode: 448 });
        } catch (me) {
          if (!isErrno(me, "EEXIST")) throw me;
        }
        st = fs.lstatSync(cur);
      }
      checkStat(st, uid, true, cur);
    }
    return true;
  }
  function filePath(parts) {
    return path.join(keyDir, ...parts);
  }
  function openChecked(parts, flags) {
    const p = filePath(parts);
    let fd;
    try {
      fd = fs.openSync(p, flags | fs.constants.O_NOFOLLOW, 384);
    } catch (e) {
      if (isErrno(e, "ENOENT")) return null;
      if (isErrno(e, "ELOOP") || isErrno(e, "EMLINK")) throw new LedgerError("unsafe_path", p);
      throw e;
    }
    try {
      checkStat(fs.fstatSync(fd), uid, false, p);
    } catch (e) {
      fs.closeSync(fd);
      throw e;
    }
    return fd;
  }
  function readText(parts) {
    if (!ensureDirs(parts.slice(0, -1), false)) return null;
    const fd = openChecked(parts, fs.constants.O_RDONLY);
    if (fd === null) return null;
    try {
      const size = fs.fstatSync(fd).size;
      if (size > capFor(parts)) throw new LedgerError("ledger_too_large", filePath(parts));
      return fs.readFileSync(fd, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  }
  function writeFile(parts, data, flags) {
    ensureDirs(parts.slice(0, -1), true);
    const fd = openChecked(parts, fs.constants.O_WRONLY | fs.constants.O_CREAT | flags);
    if (fd === null) throw new LedgerError("unsafe_path", filePath(parts));
    try {
      fs.writeSync(fd, data);
    } finally {
      fs.closeSync(fd);
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
      writeFile(parts, line, fs.constants.O_APPEND);
    },
    readRows,
    lastRow(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return null;
      const fd = openChecked(parts, fs.constants.O_RDONLY);
      if (fd === null) return null;
      try {
        const size = fs.fstatSync(fd).size;
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        const lines = buf.toString("utf8").split("\n");
        for (let i = lines.length - 1; i >= (len < size ? 1 : 0); i--) {
          const row = parseObject(lines[i]);
          if (row !== null) return row;
        }
        return null;
      } finally {
        fs.closeSync(fd);
      }
    },
    scanBack(relPath, visit) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return;
      const fd = openChecked(parts, fs.constants.O_RDONLY);
      if (fd === null) return;
      try {
        const size = fs.fstatSync(fd).size;
        const floor = Math.max(0, size - capFor(parts));
        let end = size;
        let rest = Buffer.alloc(0);
        while (end > floor) {
          const start = Math.max(floor, end - TAIL_BYTES);
          const buf = Buffer.alloc(end - start);
          fs.readSync(fd, buf, 0, buf.length, start);
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
        fs.closeSync(fd);
      }
    },
    writeMarker(relPath, obj) {
      writeFile(splitRel(relPath), `${JSON.stringify(obj)}
`, fs.constants.O_TRUNC);
    },
    readMarker(relPath) {
      const text = readText(splitRel(relPath));
      return text === null ? null : parseObject(text.trim());
    },
    clearMarker(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return;
      try {
        fs.unlinkSync(filePath(parts));
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e;
      }
    },
    hasMarker(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return false;
      const fd = openChecked(parts, fs.constants.O_RDONLY);
      if (fd === null) return false;
      fs.closeSync(fd);
      return true;
    }
  };
}

// src/phase-results/feature.ts
var fs3 = __toESM(require("node:fs"), 1);
var path2 = __toESM(require("node:path"), 1);

// src/phase-results/git.ts
var import_node_child_process2 = require("node:child_process");

// src/phase-results/git-bin.ts
var fs2 = __toESM(require("node:fs"), 1);
var CANDIDATES = ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git", "/bin/git"];
function gitBin2() {
  for (const p of CANDIDATES) {
    try {
      if (!fs2.statSync(p).isFile()) continue;
      fs2.accessSync(p, fs2.constants.X_OK);
      return p;
    } catch {
    }
  }
  return "";
}

// src/phase-results/git.ts
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_GRAFT_FILE = "/dev/null";
  return env;
}
function gitOut2(cwd, args) {
  try {
    const out = (0, import_node_child_process2.execFileSync)(gitBin2(), args, {
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

// src/phase-results/feature.ts
var FEATURE_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
var BRANCH_RE = /^[^/]+\/([^/]+)\/[^/]/;
function activeFeatures(repo) {
  const dir = path2.join(repo, ".oss", "dev", "active");
  let names;
  try {
    names = fs3.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => FEATURE_RE.test(n) && fs3.lstatSync(path2.join(dir, n), { throwIfNoEntry: false })?.isDirectory()).sort();
}
function resolveFeature(repo) {
  const ref = gitOut2(repo, ["symbolic-ref", "-q", "HEAD"]);
  const branch = ref !== null && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
  const m = BRANCH_RE.exec(branch);
  if (m !== null) {
    const f = m[1];
    const st = fs3.lstatSync(path2.join(repo, ".oss", "dev", "active", f), { throwIfNoEntry: false });
    return FEATURE_RE.test(f) && st?.isDirectory() ? f : null;
  }
  const active = activeFeatures(repo);
  return active.length === 1 ? active[0] : null;
}

// src/phase-results/store.ts
var fs4 = __toESM(require("fs"), 1);
var import_child_process = require("child_process");

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

// src/phase-results/store.ts
var RESULT_CAP = 256 * 1024;
var VALUE_CAP = 64 * 1024;
var VALUE_MAX_AGE_MS = 10 * 60 * 1e3;
var { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs4.constants;
function resolveRepo(cwd) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  env.PATH = "/usr/bin:/bin";
  const git = gitBin2();
  if (git === "") return null;
  try {
    const top = (0, import_child_process.execFileSync)(git, ["rev-parse", "--show-toplevel"], {
      cwd,
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2e3
    }).trim();
    return top === "" ? null : fs4.realpathSync(top);
  } catch {
    return null;
  }
}

// src/phase-results/verdict-capture.ts
var REVIEW_AGENT_GATES = {
  "oss:code-reviewer": "code-review",
  "oss:performance-auditor": "performance",
  "oss:security-auditor": "security",
  "oss:penetration-tester": "pen-test"
};
var TRANSCRIPT_TAIL_BYTES = 256 * 1024;
var DEADLINE_MS = 3500;
var BIG_FILE_BYTES = 50 * 1024 * 1024;
var MAX_CHANGED_PATHS = 2e4;
var MAX_CHANGED_BYTES = 500 * 1024 * 1024;
var STALE_TMP_MS = 10 * 60 * 1e3;
var COUNT = { type: "integer", minimum: 0 };
var VERDICT_SCHEMA = loadSchema({
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "fail"] },
    findings: {
      type: "object",
      additionalProperties: false,
      required: ["critical", "high", "medium", "low", "info"],
      properties: { critical: COUNT, high: COUNT, medium: COUNT, low: COUNT, info: COUNT }
    }
  }
});
var ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
var OPENER_RE = /^```oss-verdict[ \t]*$/;
function plainId(v) {
  return typeof v === "string" && ID_RE.test(v) ? v : "";
}
function gateForAgent(agentType) {
  if (typeof agentType !== "string") return null;
  return Object.prototype.hasOwnProperty.call(REVIEW_AGENT_GATES, agentType) ? REVIEW_AGENT_GATES[agentType] : null;
}
function projectsTranscript(file) {
  if (typeof file !== "string" || !path3.isAbsolute(file)) return null;
  try {
    const root = fs5.realpathSync(path3.join(os2.homedir(), ".claude", "projects"));
    const real = fs5.realpathSync(file);
    const st = fs5.lstatSync(file);
    return real.startsWith(root + path3.sep) && !st.isSymbolicLink() && st.nlink <= 1 ? real : null;
  } catch {
    return null;
  }
}
function transcriptMessage(input) {
  const file = projectsTranscript(input);
  if (file === null) return null;
  let fd;
  try {
    fd = fs5.openSync(file, fs5.constants.O_RDONLY | fs5.constants.O_NOFOLLOW | fs5.constants.O_NONBLOCK);
  } catch {
    return null;
  }
  let text;
  try {
    const st = fs5.fstatSync(fd);
    if (!st.isFile()) return null;
    const len = Math.min(st.size, TRANSCRIPT_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    const got = fs5.readSync(fd, buf, 0, len, st.size - len);
    text = buf.subarray(0, got).toString("utf8");
  } finally {
    fs5.closeSync(fd);
  }
  const lines = text.split("\n");
  let lastId;
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (typeof entry !== "object" || entry === null) continue;
    const { type, message } = entry;
    if (type !== "assistant") {
      if (lastId !== void 0 && type === "user") break;
      continue;
    }
    const id = message?.id;
    if (lastId === void 0) lastId = id ?? null;
    else if (lastId === null || id !== lastId) break;
    const content = Array.isArray(message?.content) ? message.content : [];
    const texts = content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => c.text);
    parts.unshift(...texts);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}
function finalMessage(input) {
  return transcriptMessage(input.agent_transcript_path);
}
function lastVerdictBlock(text) {
  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");
  if (lines.filter((l) => OPENER_RE.test(l)).length > 1) return "multiple";
  const close = lines.length - 1;
  if (close < 1 || lines[close].trimEnd() !== "```") return "none";
  let open = close - 1;
  while (open >= 0 && !lines[open].startsWith("```")) open--;
  if (open < 0 || !OPENER_RE.test(lines[open])) return "none";
  let value;
  try {
    value = JSON.parse(lines.slice(open + 1, close).join("\n"));
  } catch {
    return "invalid";
  }
  if (!validate(VERDICT_SCHEMA, value).ok) return "invalid";
  return value;
}
var TREE_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
function deadlineOf(opts) {
  const end = (opts.startMs ?? Date.now()) + (opts.deadlineMs ?? DEADLINE_MS);
  return () => end - Date.now();
}
var CAPTURE_GIT_PATH = "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin";
function boundedGit(repo, args, extra, left, input) {
  const git = gitBin2();
  const timeout = Math.floor(left());
  if (git === "" || timeout <= 0) return null;
  const env = { ...gitEnv(), GIT_CONFIG_NOSYSTEM: "1", PATH: CAPTURE_GIT_PATH, ...extra };
  const r = (0, import_node_child_process3.spawnSync)(git, ["-c", "core.fsmonitor=", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repo,
    env,
    input,
    stdio: [input === void 0 ? "ignore" : "pipe", "pipe", "ignore"],
    timeout,
    maxBuffer: 64 * 1024 * 1024
  });
  return r.error === void 0 && r.status === 0 ? r.stdout : null;
}
function gitText(repo, args, left) {
  return boundedGit(repo, args, {}, left)?.toString("utf-8").trim() ?? null;
}
function verdictTreeTmpRoot() {
  return path3.join(os2.tmpdir(), `oss-verdict-trees-${process.getuid?.() ?? 0}`);
}
function treeTmpDir() {
  const root = verdictTreeTmpRoot();
  try {
    fs5.mkdirSync(root, { mode: 448 });
  } catch (e) {
    if (e.code !== "EEXIST") return null;
  }
  const st = fs5.lstatSync(root);
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 63) !== 0) return null;
  for (const name of fs5.readdirSync(root)) {
    const p = path3.join(root, name);
    const e = fs5.lstatSync(p, { throwIfNoEntry: false });
    if (e !== void 0 && Date.now() - e.mtimeMs > STALE_TMP_MS) fs5.rmSync(p, { recursive: true, force: true });
  }
  return fs5.mkdtempSync(path3.join(root, "tree-"));
}
function globalIgnoreFile(repo, left) {
  const xdg = process.env.XDG_CONFIG_HOME;
  const fallback = path3.join(xdg !== void 0 && xdg !== "" ? xdg : path3.join(os2.homedir(), ".config"), "git", "ignore");
  const set = gitText(repo, ["config", "--global", "--includes", "--type=path", "--get", "core.excludesFile"], left);
  const file = path3.resolve(repo, set !== null && set !== "" ? set : fallback);
  return fs5.statSync(file, { throwIfNoEntry: false })?.isFile() === true ? file : null;
}
function hidingBits(repo, index, left) {
  const listed = boundedGit(repo, ["ls-files", "-z", "-v"], { GIT_INDEX_FILE: index }, left);
  if (listed === null) return null;
  const dirOnDisk = /* @__PURE__ */ new Map();
  const present = (dir) => {
    if (dir === ".") return true;
    let known = dirOnDisk.get(dir);
    if (known === void 0) {
      known = present(path3.dirname(dir)) && fs5.lstatSync(path3.join(repo, dir), { throwIfNoEntry: false }) !== void 0;
      dirOnDisk.set(dir, known);
    }
    return known;
  };
  const bits = { assumed: [], skipped: [] };
  for (const e of listed.toString("utf-8").split("\0")) {
    if (e.length < 3) continue;
    const p = e.slice(2);
    if (e[0] !== e[0].toUpperCase()) bits.assumed.push(p);
    if ((e[0] === "S" || e[0] === "s") && present(path3.dirname(p)) && fs5.lstatSync(path3.join(repo, p), { throwIfNoEntry: false }) !== void 0) {
      bits.skipped.push(p);
    }
  }
  return bits;
}
function clearHidingBits(repo, env, bits, left) {
  const clear = (flag, paths) => paths.length === 0 || boundedGit(repo, ["update-index", flag, "-z", "--stdin"], env, left, Buffer.from(paths.join("\0") + "\0")) !== null;
  return clear("--no-assume-unchanged", bits.assumed) && clear("--no-skip-worktree", bits.skipped);
}
function reviewedTree(repo, index, bits, which, dir, left) {
  const tmpIndex = path3.join(dir, `index-${which}`);
  try {
    fs5.copyFileSync(index, tmpIndex);
  } catch {
  }
  const env = { GIT_INDEX_FILE: tmpIndex };
  if (!clearHidingBits(repo, env, bits, left)) return "";
  let list = ["ls-files", "-z", "-m", "-d"];
  if (which === "all") {
    const global = globalIgnoreFile(repo, left);
    list = [
      "-c",
      "core.excludesFile=/dev/null",
      "ls-files",
      "-z",
      "-m",
      "-o",
      "-d",
      "--exclude-per-directory=.gitignore",
      ...global === null ? [] : [`--exclude-from=${global}`],
      "--",
      ".",
      ":(exclude).oss"
    ];
  }
  const changed = boundedGit(repo, list, env, left);
  if (changed === null) return "";
  const paths = new Set(changed.toString("utf-8").split("\0"));
  paths.delete("");
  if (paths.size > MAX_CHANGED_PATHS) return "";
  let total = 0;
  for (const p of paths) {
    const size = fs5.lstatSync(path3.join(repo, p), { throwIfNoEntry: false })?.size ?? 0;
    total += size;
    if (size > BIG_FILE_BYTES || total > MAX_CHANGED_BYTES) return "";
  }
  if (changed.length > 0) {
    const args = ["update-index", "--add", "--remove", "--info-only", "-z", "--stdin"];
    if (boundedGit(repo, args, env, left, changed) === null) return "";
  }
  const tree = boundedGit(repo, ["write-tree", "--missing-ok"], env, left)?.toString("utf-8").trim() ?? null;
  return tree !== null && TREE_RE.test(tree) ? tree : "";
}
function reviewedTrees(repo, left) {
  const none = { tree: "", trackedTree: "" };
  const index = gitText(repo, ["rev-parse", "--path-format=absolute", "--git-path", "index"], left);
  if (index === null || left() <= 0) return none;
  const dir = treeTmpDir();
  if (dir === null) return none;
  try {
    const bits = hidingBits(repo, index, left);
    if (bits === null) return none;
    const trackedTree = reviewedTree(repo, index, bits, "tracked", dir, left);
    return trackedTree === "" ? none : { tree: reviewedTree(repo, index, bits, "all", dir, left), trackedTree };
  } finally {
    fs5.rmSync(dir, { recursive: true, force: true });
  }
}
function captureVerdict(input, opts = {}) {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return { captured: false, reason: "bad_input" };
    const hook = input;
    const gate = gateForAgent(hook.agent_type);
    if (gate === null) return { captured: false, reason: "not_review_agent" };
    const text = finalMessage(hook);
    if (text === null) return { captured: false, reason: "no_message" };
    const block = lastVerdictBlock(text);
    if (block === "none") return { captured: false, reason: "no_block" };
    if (block === "multiple") return { captured: false, reason: "multiple_blocks" };
    if (block === "invalid") return { captured: false, reason: "invalid_block" };
    const left = deadlineOf(opts);
    const cwd = typeof hook.cwd === "string" && path3.isAbsolute(hook.cwd) ? hook.cwd : process.cwd();
    const repo = resolveRepo(cwd);
    const feature = repo === null ? null : resolveFeature(repo);
    if (repo === null || feature === null) return { captured: false, reason: "no_feature" };
    const ledger = openLedger(repo);
    const headSha = gitText(repo, ["rev-parse", "--verify", "HEAD^{commit}"], left) ?? "";
    const trees = reviewedTrees(repo, left);
    if (trees.tree === "" || trees.trackedTree === "") return { captured: false, reason: "no_tree_or_head" };
    ledger.appendRow(`verdicts/${feature}`, {
      gate,
      verdict: block.verdict,
      findings: block.findings,
      agent: plainId(hook.agent_id),
      session: plainId(hook.session_id),
      ts: (opts.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
      // The HEAD at capture: ship commits after its reviews, so HEAD never decides alone; assemble-ship counts a
      // deletion as a change only for a path that was tracked, or in this commit's tree (pen N4).
      headSha,
      // The trees the agent reviewed (all files / tracked only). Passes never count (D45): a fail stays open until the
      // shipped code outside .oss differs from `tree` (the D45 build note's reviewedIsShipped rule).
      ...trees
    });
    return { captured: true, gate, feature };
  } catch {
    return { captured: false, reason: "error" };
  }
}

// src/cli/verdict-capture.ts
var INPUT_CAP = 1024 * 1024;
function readInput(file) {
  if (file === void 0) return null;
  const fd = fs6.openSync(file, fs6.constants.O_RDONLY | fs6.constants.O_NOFOLLOW | fs6.constants.O_NONBLOCK);
  try {
    const st = fs6.fstatSync(fd);
    if (!st.isFile() || st.size > INPUT_CAP) return null;
    return JSON.parse(fs6.readFileSync(fd, "utf8"));
  } finally {
    fs6.closeSync(fd);
  }
}
try {
  const startMs = performance.timeOrigin;
  captureVerdict(readInput(process.argv[2]), { startMs });
} catch {
}
process.exitCode = 0;
