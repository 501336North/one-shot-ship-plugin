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
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
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

// src/cli/stop-dispatch.ts
var fs7 = __toESM(require("node:fs"), 1);
var path8 = __toESM(require("node:path"), 1);

// src/stop/dispatch.ts
var path7 = __toESM(require("node:path"), 1);

// src/phase-results/feature.ts
var fs2 = __toESM(require("node:fs"), 1);
var path = __toESM(require("node:path"), 1);

// src/phase-results/git.ts
var import_node_child_process = require("node:child_process");

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

// src/phase-results/git.ts
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GIT_")) env[k] = v;
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_GRAFT_FILE = "/dev/null";
  return env;
}
function gitOut(cwd, args) {
  try {
    const out = (0, import_node_child_process.execFileSync)(gitBin(), args, {
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
  const dir = path.join(repo, ".oss", "dev", "active");
  let names;
  try {
    names = fs2.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => FEATURE_RE.test(n) && fs2.lstatSync(path.join(dir, n), { throwIfNoEntry: false })?.isDirectory()).sort();
}
function resolveFeature(repo) {
  const ref = gitOut(repo, ["symbolic-ref", "-q", "HEAD"]);
  const branch = ref !== null && ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
  const m = BRANCH_RE.exec(branch);
  if (m !== null) {
    const f = m[1];
    const st = fs2.lstatSync(path.join(repo, ".oss", "dev", "active", f), { throwIfNoEntry: false });
    return FEATURE_RE.test(f) && st?.isDirectory() ? f : null;
  }
  const active = activeFeatures(repo);
  return active.length === 1 ? active[0] : null;
}

// src/phase-results/ledger.ts
var import_node_child_process2 = require("node:child_process");
var import_node_crypto = require("node:crypto");
var fs3 = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path2 = __toESM(require("node:path"), 1);
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
  const { startedAt, session, headSha, feature } = row;
  if (typeof startedAt !== "string" || typeof session !== "string" || typeof feature !== "string") return null;
  return { startedAt, session, headSha: typeof headSha === "string" ? headSha : "", feature };
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
      if (!fs3.statSync(p).isFile()) continue;
      fs3.accessSync(p, fs3.constants.X_OK);
      return p;
    } catch {
    }
  }
  return "";
}
function gitOut2(cwd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  env.PATH = "/usr/bin:/bin";
  try {
    const out = (0, import_node_child_process2.execFileSync)(gitBin2(), args, {
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
    physical = fs3.realpathSync(cwd);
  } catch {
    return null;
  }
  const top = gitOut2(physical, ["rev-parse", "--show-toplevel"]);
  if (top === null) return null;
  const gitDir = gitOut2(top, ["rev-parse", "--absolute-git-dir"]);
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
  const key = ledgerKey(cwd);
  if (key === null) throw new LedgerError("unsafe_path", "not a git repo");
  const uid = (opts.getuid ?? (() => process.getuid ? process.getuid() : -1))();
  const root = path2.join(os.homedir(), ".oss", "ledger");
  const keyDir = path2.join(root, key);
  function ensureDirs(dirParts, create) {
    if (create) fs3.mkdirSync(path2.dirname(root), { recursive: true, mode: 448 });
    let cur = root;
    for (const seg of [null, key, ...dirParts]) {
      if (seg !== null) cur = path2.join(cur, seg);
      let st;
      try {
        st = fs3.lstatSync(cur);
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e;
        if (!create) return false;
        try {
          fs3.mkdirSync(cur, { mode: 448 });
        } catch (me) {
          if (!isErrno(me, "EEXIST")) throw me;
        }
        st = fs3.lstatSync(cur);
      }
      checkStat(st, uid, true, cur);
    }
    return true;
  }
  function filePath(parts) {
    return path2.join(keyDir, ...parts);
  }
  function openChecked(parts, flags) {
    const p = filePath(parts);
    let fd;
    try {
      fd = fs3.openSync(p, flags | fs3.constants.O_NOFOLLOW, 384);
    } catch (e) {
      if (isErrno(e, "ENOENT")) return null;
      if (isErrno(e, "ELOOP") || isErrno(e, "EMLINK")) throw new LedgerError("unsafe_path", p);
      throw e;
    }
    try {
      checkStat(fs3.fstatSync(fd), uid, false, p);
    } catch (e) {
      fs3.closeSync(fd);
      throw e;
    }
    return fd;
  }
  function readText(parts) {
    if (!ensureDirs(parts.slice(0, -1), false)) return null;
    const fd = openChecked(parts, fs3.constants.O_RDONLY);
    if (fd === null) return null;
    try {
      const size = fs3.fstatSync(fd).size;
      if (size > capFor(parts)) throw new LedgerError("ledger_too_large", filePath(parts));
      return fs3.readFileSync(fd, "utf8");
    } finally {
      fs3.closeSync(fd);
    }
  }
  function writeFile(parts, data, flags) {
    ensureDirs(parts.slice(0, -1), true);
    const fd = openChecked(parts, fs3.constants.O_WRONLY | fs3.constants.O_CREAT | flags);
    if (fd === null) throw new LedgerError("unsafe_path", filePath(parts));
    try {
      fs3.writeSync(fd, data);
    } finally {
      fs3.closeSync(fd);
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
      writeFile(parts, line, fs3.constants.O_APPEND);
    },
    readRows,
    lastRow(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return null;
      const fd = openChecked(parts, fs3.constants.O_RDONLY);
      if (fd === null) return null;
      try {
        const size = fs3.fstatSync(fd).size;
        const len = Math.min(size, TAIL_BYTES);
        const buf = Buffer.alloc(len);
        fs3.readSync(fd, buf, 0, len, size - len);
        const lines = buf.toString("utf8").split("\n");
        for (let i = lines.length - 1; i >= (len < size ? 1 : 0); i--) {
          const row = parseObject(lines[i]);
          if (row !== null) return row;
        }
        return null;
      } finally {
        fs3.closeSync(fd);
      }
    },
    scanBack(relPath, visit) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return;
      const fd = openChecked(parts, fs3.constants.O_RDONLY);
      if (fd === null) return;
      try {
        const size = fs3.fstatSync(fd).size;
        const floor = Math.max(0, size - capFor(parts));
        let end = size;
        let rest = Buffer.alloc(0);
        while (end > floor) {
          const start = Math.max(floor, end - TAIL_BYTES);
          const buf = Buffer.alloc(end - start);
          fs3.readSync(fd, buf, 0, buf.length, start);
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
        fs3.closeSync(fd);
      }
    },
    writeMarker(relPath, obj) {
      writeFile(splitRel(relPath), `${JSON.stringify(obj)}
`, fs3.constants.O_TRUNC);
    },
    readMarker(relPath) {
      const text = readText(splitRel(relPath));
      return text === null ? null : parseObject(text.trim());
    },
    clearMarker(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return;
      try {
        fs3.unlinkSync(filePath(parts));
      } catch (e) {
        if (!isErrno(e, "ENOENT")) throw e;
      }
    },
    hasMarker(relPath) {
      const parts = splitRel(relPath);
      if (!ensureDirs(parts.slice(0, -1), false)) return false;
      const fd = openChecked(parts, fs3.constants.O_RDONLY);
      if (fd === null) return false;
      fs3.closeSync(fd);
      return true;
    }
  };
}

// src/phase-results/schemas.ts
var PHASES = ["ideate", "plan", "build", "ship"];

// src/phase-results/store.ts
var fs4 = __toESM(require("fs"), 1);
var path3 = __toESM(require("path"), 1);
var import_child_process = require("child_process");
var FEATURE_RE2 = /^[A-Za-z0-9._-]+$/;
var RESULT_CAP = 256 * 1024;
var VALUE_CAP = 64 * 1024;
var VALUE_MAX_AGE_MS = 10 * 60 * 1e3;
var { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs4.constants;
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
    return top === "" ? null : fs4.realpathSync(top);
  } catch {
    return null;
  }
}
function checkNames(feature, phase) {
  if (!FEATURE_RE2.test(feature) || feature.startsWith(".")) throw new Error(`bad_feature: ${JSON.stringify(feature)}`);
  if (!PHASES.includes(phase)) throw new Error(`unsafe_path: unknown phase ${JSON.stringify(phase)}`);
}
function resultsDir(repo, feature, create) {
  let cur = repo;
  for (const comp of [".oss", "dev", "active", feature, "results"]) {
    cur = path3.join(cur, comp);
    let st;
    try {
      st = fs4.lstatSync(cur);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (!create) return null;
      fs4.mkdirSync(cur, { mode: 448 });
      st = fs4.lstatSync(cur);
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`unsafe_path: ${comp}`);
  }
  return cur;
}
function readCapped(fd, cap) {
  const buf = Buffer.alloc(cap + 1);
  let n = 0;
  while (n < buf.length) {
    const got = fs4.readSync(fd, buf, n, buf.length - n, null);
    if (got === 0) break;
    n += got;
  }
  return buf.subarray(0, n);
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
    fd = fs4.openSync(path3.join(dir, `${phase}.json`), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    return { ok: false, error: e.code === "ENOENT" ? "missing" : "unsafe_path" };
  }
  try {
    const st = fs4.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.()) return { ok: false, error: "unsafe_path" };
    const bytes = readCapped(fd, RESULT_CAP);
    if (bytes.length > RESULT_CAP) return { ok: false, error: "too_large" };
    try {
      return { ok: true, bytes, value: JSON.parse(bytes.toString("utf-8")), dev: st.dev, ino: st.ino };
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  } finally {
    fs4.closeSync(fd);
  }
}

// src/logger/workflow-logger.ts
var path5 = __toESM(require("path"), 1);

// src/utils/safe-project-write.ts
var fs5 = __toESM(require("fs"), 1);
var path4 = __toESM(require("path"), 1);
var crypto = __toESM(require("crypto"), 1);
var homeCache = null;
function realHome(home) {
  if (homeCache === null || homeCache.home !== home) homeCache = { home, real: fs5.realpathSync(home) };
  return homeCache.real;
}
function isUserOssDir(ossDir) {
  const home = process.env.HOME;
  if (!home) return false;
  if (path4.resolve(ossDir) === path4.resolve(home, ".oss")) return true;
  try {
    return path4.basename(ossDir) === ".oss" && fs5.realpathSync(path4.dirname(ossDir)) === realHome(home);
  } catch {
    return false;
  }
}
function refuse(ossDir, rel) {
  process.stderr.write(`oss: refusing unsafe .oss path ${path4.join(path4.basename(ossDir), rel)}
`);
  return false;
}
function ownedOk(st, rootUid) {
  if (typeof process.getuid !== "function" || st.uid === process.getuid()) return true;
  return rootUid === 0 && (st.mode & 18) === 0;
}
function safeDir(ossDir, relDir, createDirs) {
  const projectReal = fs5.realpathSync(path4.dirname(path4.resolve(ossDir)));
  const parts = [path4.basename(path4.resolve(ossDir)), ...relDir.split(/[\\/]/)].filter((c) => c !== "" && c !== ".");
  const rootUid = fs5.lstatSync(projectReal).uid;
  let cur = projectReal;
  for (const comp of parts) {
    if (comp === "..") return null;
    cur = path4.join(cur, comp);
    let st;
    try {
      st = fs5.lstatSync(cur);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (!createDirs) throw e;
      try {
        fs5.mkdirSync(cur);
      } catch (m) {
        if (m.code !== "EEXIST") throw m;
      }
      st = fs5.lstatSync(cur);
    }
    if (st.isSymbolicLink() || !st.isDirectory() || !ownedOk(st, rootUid)) return null;
  }
  const phys = fs5.realpathSync(cur);
  const inside = projectReal.endsWith(path4.sep) ? projectReal : projectReal + path4.sep;
  return phys === projectReal || phys.startsWith(inside) ? phys : null;
}
function checkTarget(ossDir, rel, createDirs) {
  const dir = safeDir(ossDir, path4.dirname(rel), createDirs);
  if (dir === null) return null;
  const base = path4.basename(rel);
  if (base === "" || base === "." || base === "..") return null;
  const target = path4.join(dir, base);
  try {
    const st = fs5.lstatSync(target);
    if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1) return null;
    return { path: target, mode: st.mode & 511 };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return { path: target, mode: null };
}
function safeTarget(ossDir, rel, createDirs) {
  const t = checkTarget(ossDir, rel, createDirs);
  return t === null ? null : t.path;
}
function safeWriteFileAtomic(ossDir, rel, data, options = {}) {
  let target;
  let keepMode;
  if (isUserOssDir(ossDir)) {
    target = path4.join(ossDir, rel);
    fs5.mkdirSync(path4.dirname(target), { recursive: true });
    try {
      keepMode = fs5.statSync(target).mode & 511;
    } catch {
      keepMode = null;
    }
  } else {
    const checked = checkTarget(ossDir, rel, options.createDirs ?? true);
    if (checked === null) return refuse(ossDir, rel);
    target = checked.path;
    keepMode = checked.mode;
  }
  const tmp = path4.join(path4.dirname(target), `.${path4.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  const fd = fs5.openSync(tmp, "wx", options.newFileMode ?? 438);
  try {
    try {
      if (keepMode !== null) fs5.fchmodSync(fd, keepMode);
      fs5.writeSync(fd, data);
    } finally {
      fs5.closeSync(fd);
    }
    fs5.renameSync(tmp, target);
  } catch (e) {
    fs5.rmSync(tmp, { force: true });
    throw e;
  }
  return true;
}
function safeAppendFile(ossDir, rel, data, options = {}) {
  if (isUserOssDir(ossDir)) {
    fs5.appendFileSync(path4.join(ossDir, rel), data);
    return true;
  }
  const target = safeTarget(ossDir, rel, options.createDirs ?? true);
  if (target === null) return refuse(ossDir, rel);
  const c = fs5.constants;
  const fd = fs5.openSync(target, c.O_WRONLY | c.O_APPEND | c.O_CREAT | (c.O_NOFOLLOW ?? 0), 420);
  try {
    const st = fs5.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) return refuse(ossDir, rel);
    fs5.writeSync(fd, data);
  } finally {
    fs5.closeSync(fd);
  }
  return true;
}

// src/logger/workflow-logger.ts
var WorkflowLogger = class {
  logPath;
  writeQueue = Promise.resolve();
  constructor(ossDir) {
    this.logPath = path5.join(ossDir, "workflow.log");
  }
  /**
   * Log a workflow entry
   * Writes atomically: JSON line + human summary
   */
  async log(entry) {
    this.writeQueue = this.writeQueue.then(() => this.doLog(entry));
    return this.writeQueue;
  }
  async doLog(entry) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const storedEntry = {
      ts: timestamp,
      cmd: entry.cmd,
      event: entry.event,
      data: entry.data
    };
    if (entry.phase) {
      storedEntry.phase = entry.phase;
    }
    if (entry.agent) {
      storedEntry.agent = entry.agent;
    }
    if (entry.ironLaws) {
      storedEntry.ironLaws = entry.ironLaws;
    }
    const jsonLine = JSON.stringify(storedEntry);
    const humanLine = this.formatHumanSummary(storedEntry);
    let content = `${jsonLine}
${humanLine}
`;
    if ((entry.event === "COMPLETE" || entry.event === "AGENT_COMPLETE") && entry.ironLaws) {
      content += this.formatIronLawChecklist(entry.ironLaws);
    }
    safeAppendFile(path5.dirname(this.logPath), path5.basename(this.logPath), content, { createDirs: false });
  }
  /**
   * RecoveryLogger port (US-006): log a retry-visibility RECOVERY line.
   * Fire-and-forget — retry visibility must never block the healing pipeline.
   */
  logRecovery(data) {
    void this.log({ cmd: "watcher", event: "RECOVERY", data });
  }
  /**
   * Format IRON LAW compliance checklist for logging
   */
  formatIronLawChecklist(checklist) {
    const lines = [
      "# IRON LAW COMPLIANCE:",
      `#   [${checklist.law1_tdd ? "\u2713" : "\u2717"}] LAW #1: TDD - Tests written first`,
      `#   [${checklist.law2_behavior_tests ? "\u2713" : "\u2717"}] LAW #2: Behavior tests (not implementation)`,
      `#   [${checklist.law3_no_loops ? "\u2713" : "\u2717"}] LAW #3: No loops detected`,
      `#   [${checklist.law4_feature_branch ? "\u2713" : "\u2717"}] LAW #4: On feature branch`,
      `#   [${checklist.law5_delegation ? "\u2713" : "\u2717"}] LAW #5: Agent delegation used`,
      `#   [${checklist.law6_docs_synced ? "\u2713" : "\u2717"}] LAW #6: Dev docs synced`
    ];
    const passCount = Object.values(checklist).filter(Boolean).length;
    const totalCount = Object.keys(checklist).length;
    lines.push(`#   Result: ${passCount}/${totalCount} laws observed`);
    lines.push("#");
    return lines.join("\n") + "\n";
  }
  /**
   * Format human-readable summary line
   */
  formatHumanSummary(entry) {
    const parts = ["#"];
    parts.push(entry.cmd.toUpperCase());
    if (entry.phase) {
      parts[parts.length - 1] += `:${entry.phase}`;
    }
    parts[parts.length - 1] += `:${entry.event}`;
    const description = this.getDescription(entry);
    if (description) {
      parts.push("-");
      parts.push(description);
    }
    return parts.join(" ");
  }
  getDescription(entry) {
    const data = entry.data;
    if (entry.event === "IRON_LAW_CHECK") {
      const passed = data.passed;
      if (passed) {
        return "PRE-CHECK PASSED";
      }
      const violations = data.violations;
      const count = violations?.length || 0;
      return `PRE-CHECK FAILED: ${count} violation(s)`;
    }
    if (entry.agent || entry.event === "AGENT_SPAWN" || entry.event === "AGENT_COMPLETE") {
      const agentType = entry.agent?.type || data.agent_type;
      const task = data.task;
      if (task) {
        return `${agentType}: ${task}`;
      }
      return `${agentType}`;
    }
    if (entry.event === "COMPLETE" && data.summary) {
      return data.summary;
    }
    if (entry.event === "FAILED" && data.error) {
      return data.error;
    }
    if (entry.event === "START" && data.args) {
      const args = data.args;
      return args.join(" ");
    }
    if (entry.event === "MILESTONE" && data.description) {
      return data.description;
    }
    return "";
  }
};

// src/stop/checks/phase-result-missing.ts
var import_node_child_process3 = require("node:child_process");
var import_node_crypto2 = require("node:crypto");
var fs6 = __toESM(require("node:fs"), 1);
var path6 = __toESM(require("node:path"), 1);
var CLI_TIMEOUT_MS = 4e3;
var PATH_PROBLEMS = ["unsafe_path", "too_large"];
function namedError(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}
function blockFor(phase, id, pathProblem, offFeature) {
  const reason = offFeature === void 0 ? `OSS: the ${phase} phase has no valid result for this run (${id}). Run ~/.oss/hooks/oss-phase-result.sh assemble ${phase} before stopping.` : `OSS: the ${phase} phase of feature ${offFeature} has no valid result for this run (${id}). Check out ${offFeature}'s branch and run ~/.oss/hooks/oss-phase-result.sh assemble ${phase} before stopping.`;
  return pathProblem ? { kind: "block", reason, systemMessage: `OSS: ${phase} result refused (${id}): a linked, special or oversized file` } : { kind: "block", reason };
}
function offBranchProblem(s, bytes) {
  if (bytes === null) return "missing";
  const marker = path6.join(s.repo, ".oss", "dev", "active", s.feature, "results", `${s.phase}.unverified.json`);
  if (fs6.lstatSync(marker, { throwIfNoEntry: false }) !== void 0) return "unverified";
  for (const kind of ["pending", "unverified"]) if (s.ledger.hasMarker(`${kind}/${s.feature}/${s.phase}`)) return "unverified";
  const sha = (0, import_node_crypto2.createHash)("sha256").update(bytes).digest("hex");
  return s.ledger.lastRow(`results/${s.feature}/${s.phase}`)?.sha256 === sha ? null : "unbound_result";
}
var phaseResultMissing = {
  id: "phase-result-missing",
  run(ctx) {
    const s = ctx.subject;
    if (s === null) return { kind: "allow" };
    const read = readResult(s.repo, s.feature, s.phase);
    const off = s.offBranch ? s.feature : void 0;
    if (!read.ok && PATH_PROBLEMS.includes(read.error)) return blockFor(s.phase, read.error, true, off);
    if (!s.bound) return blockFor(s.phase, read.ok ? "unbound_result" : read.error, false, off);
    if (s.offBranch) {
      const id = offBranchProblem(s, read.ok ? read.bytes : null);
      return id === null ? { kind: "allow" } : blockFor(s.phase, id, false, off);
    }
    const r = (0, import_node_child_process3.spawnSync)(process.execPath, [ctx.phaseResultCli, "check", s.phase, "--repo", s.repo], {
      cwd: s.repo,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 64 * 1024
    });
    if (r.error !== void 0) throw namedError(r.error.code === "ETIMEDOUT" ? "timeout" : "cli_failed");
    if (r.status === 0) return { kind: "allow" };
    if (r.status === 1) {
      const id = /^phase-result: \S+ \S+: ([a-z_]+)/m.exec(r.stderr)?.[1] ?? "refused";
      if (id === "ledger_too_large") throw namedError(id);
      return blockFor(s.phase, id, PATH_PROBLEMS.includes(id));
    }
    throw namedError("cli_failed");
  }
};

// src/stop/dispatch.ts
var CHECKS = [phaseResultMissing];
var DEFAULT_BUDGET_MS = 4e3;
var CLASS_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
function pathCode(e) {
  if (e instanceof LedgerError) return e.code;
  return e instanceof Error ? /^([a-z_]+)/.exec(e.message)?.[1] ?? "unsafe_path" : "unsafe_path";
}
function isPathProblem(e) {
  const known = e instanceof LedgerError || e instanceof Error && /^(unsafe_path|too_large|ledger_too_large)\b/.test(e.message);
  return known && pathCode(e) !== "ledger_too_large";
}
function errorClass(e) {
  if (e instanceof LedgerError) return e.code;
  return e instanceof Error && CLASS_RE.test(e.name) ? e.name : "unknown";
}
var UNFILED_DIR = "unfiled";
function sessionRun(ledger, phase, sessionId) {
  const found = { run: null };
  ledger.scanBack(`run/${phase}`, (row) => {
    if (row.session !== sessionId) return true;
    found.run = parseRunRow(row);
    return false;
  });
  return found.run;
}
function resolveItems(repo, sessionId) {
  const resolved = resolveFeature(repo);
  const active = activeFeatures(repo);
  const ledger = openLedger(repo);
  const items = [];
  for (const phase of PHASES) {
    const run = sessionRun(ledger, phase, sessionId);
    if (run === null) continue;
    const { startedAt } = run;
    const feature = run.feature !== "" ? run.feature : resolved;
    if (feature === null) {
      items.push({ kind: "unfiled", phase, startedAt });
      continue;
    }
    const bound = ledger.lastRow(`results/${feature}/${phase}`)?.startedAt === startedAt;
    if (active.includes(feature)) {
      items.push({ kind: "subject", subject: { repo, feature, phase, startedAt, bound, ledger, offBranch: feature !== resolved } });
    } else if (!bound) {
      items.push({ kind: "gone", feature, phase, startedAt });
    }
  }
  const at = (i) => i.kind === "subject" ? i.subject.startedAt : i.startedAt;
  return { ledger, items: items.sort((a, b) => at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0) };
}
function noteOnce(ledger, rel, cls, sessionId, startedAt, message) {
  try {
    const m = ledger.readMarker(rel);
    if (m?.session === sessionId && m.startedAt === startedAt) return null;
  } catch {
  }
  try {
    ledger.writeMarker(rel, { check: "stop-dispatch", errorClass: cls, at: (/* @__PURE__ */ new Date()).toISOString(), session: sessionId, startedAt });
  } catch {
  }
  return message;
}
function unfiled(ledger, phase, startedAt, sessionId) {
  return noteOnce(
    ledger,
    `${UNFILED_DIR}/${phase}`,
    "no_feature",
    sessionId,
    startedAt,
    `OSS: the ${phase} phase started in this session has no feature folder to check its result against (no_feature). ${phase} is marked unverified; once its feature folder exists, run oss-phase-result.sh assemble ${phase}.`
  );
}
function gone(ledger, feature, phase, startedAt, sessionId) {
  return noteOnce(
    ledger,
    `unverified/${feature}/${phase}`,
    "feature_gone",
    sessionId,
    startedAt,
    `OSS: the ${phase} phase of feature ${feature}, started in this session, has no result and its folder is no longer under .oss/dev/active (feature_gone). ${phase} of ${feature} is marked unverified.`
  );
}
function ledgerBlock(code) {
  return {
    kind: "block",
    reason: `OSS: the stop check could not read this repo's run ledger under ~/.oss/ledger (${code}): a linked, special or oversized file. Remove that file before stopping.`,
    systemMessage: `OSS: run ledger refused (${code}): a linked, special or oversized file`
  };
}
function toOutput(o) {
  if (o.kind === "allow") return null;
  return o.systemMessage === void 0 ? { decision: "block", reason: o.reason } : { decision: "block", reason: o.reason, systemMessage: o.systemMessage };
}
function forPhase(ctx) {
  return ctx.subject === null ? "" : ` for the ${ctx.subject.phase} phase`;
}
function remedy(ctx) {
  const s = ctx.subject;
  return s === null ? "" : ` ${s.phase} is marked unverified and will not pass until you run oss-phase-result.sh assemble ${s.phase}.`;
}
function recordUnverified(ctx, check, cls) {
  const s = ctx.subject;
  if (s === null) return;
  const at = (/* @__PURE__ */ new Date()).toISOString();
  try {
    s.ledger.writeMarker(`unverified/${s.feature}/${s.phase}`, { check, errorClass: cls, at, session: ctx.input.sessionId });
  } catch {
  }
  try {
    const marker = { verification: "unverified", verificationError: { check, errorClass: cls }, phase: s.phase, at };
    safeWriteFileAtomic(
      path7.join(s.repo, ".oss"),
      `dev/active/${s.feature}/results/${s.phase}.unverified.json`,
      `${JSON.stringify(marker)}
`,
      { newFileMode: 384 }
    );
  } catch {
  }
}
async function failOpen(ctx, check, cls) {
  const s = ctx.subject;
  if (s !== null && !ctx.input.stopHookActive && ctx.input.sessionId !== "") {
    let prev = null;
    try {
      prev = s.ledger.readMarker(`unverified/${s.feature}/${s.phase}`);
    } catch {
      prev = null;
    }
    if (prev?.session === ctx.input.sessionId) {
      return {
        decision: "block",
        reason: `OSS: the ${check} stop check failed again for the ${s.phase} phase in this session (${cls}). Run ~/.oss/hooks/oss-phase-result.sh assemble ${s.phase} before stopping.`,
        systemMessage: `OSS: ${check} failed twice for ${s.phase} (${cls}); the stop is blocked`
      };
    }
  }
  recordUnverified(ctx, check, cls);
  if (s !== null) {
    try {
      await new WorkflowLogger(path7.join(s.repo, ".oss")).log({
        cmd: "stop",
        phase: s.phase,
        event: "STOP_CHECK_ERROR",
        data: { check, errorClass: cls }
      });
    } catch {
    }
  }
  return {
    systemMessage: `OSS: the ${check} stop check could not run${forPhase(ctx)} (${cls}).${remedy(ctx)}`
  };
}
function loopGuard(ctx, check) {
  recordUnverified(ctx, check, "loop_guard");
  return {
    systemMessage: `OSS: stop allowed by the loop guard without a valid result${forPhase(ctx)} (${check}).${remedy(ctx)}`
  };
}
function blockOrGuard(ctx, check, outcome) {
  return ctx.input.stopHookActive ? loopGuard(ctx, check) : toOutput(outcome);
}
async function checkSubject(subject, input, opts) {
  const checks = opts.checks ?? CHECKS;
  const budget = opts.checkBudgetMs ?? DEFAULT_BUDGET_MS;
  const ctx = { input, subject, phaseResultCli: opts.phaseResultCli };
  try {
    if (!subject.bound) {
      subject.ledger.writeMarker(`pending/${subject.feature}/${subject.phase}`, { check: "stop-dispatch", at: (/* @__PURE__ */ new Date()).toISOString() });
    }
  } catch (e) {
    if (!isPathProblem(e)) return failOpen(ctx, "stop-dispatch", errorClass(e));
    return blockOrGuard(ctx, "stop-dispatch", blockFor(subject.phase, pathCode(e), true));
  }
  for (const check of checks) {
    const t0 = Date.now();
    let outcome;
    try {
      outcome = check.run(ctx);
    } catch (e) {
      if (!isPathProblem(e)) return failOpen(ctx, check.id, errorClass(e));
      outcome = blockFor(subject.phase, pathCode(e), true);
    }
    if (Date.now() - t0 > budget) return failOpen(ctx, check.id, "timeout");
    if (outcome.kind === "block") return blockOrGuard(ctx, check.id, outcome);
  }
  return null;
}
async function dispatchRepo(repo, input, opts) {
  let resolved;
  try {
    resolved = resolveItems(repo, input.sessionId);
  } catch (e) {
    const ctx = { input, subject: null, phaseResultCli: opts.phaseResultCli };
    if (!isPathProblem(e)) return failOpen(ctx, "stop-dispatch", errorClass(e));
    return blockOrGuard(ctx, "stop-dispatch", ledgerBlock(pathCode(e)));
  }
  const notes = [];
  for (const item of resolved.items) {
    let note;
    if (item.kind === "unfiled") note = unfiled(resolved.ledger, item.phase, item.startedAt, input.sessionId);
    else if (item.kind === "gone") note = gone(resolved.ledger, item.feature, item.phase, item.startedAt, input.sessionId);
    else {
      const out = await checkSubject(item.subject, input, opts);
      if (out?.decision === "block") return out;
      note = out?.systemMessage;
    }
    if (typeof note === "string") notes.push(note);
  }
  return notes.length === 0 ? null : { systemMessage: notes.join(" ") };
}
async function dispatch(input, opts) {
  const repos = [];
  for (const dir of [input.cwd, input.projectDir]) {
    const repo = dir === void 0 || dir === "" ? null : resolveRepo(dir);
    if (repo !== null && !repos.includes(repo)) repos.push(repo);
  }
  let first = null;
  for (const repo of repos) {
    const out = await dispatchRepo(repo, input, opts);
    if (out?.decision === "block") return out;
    first ??= out;
  }
  return first;
}

// src/cli/stop-dispatch.ts
function parse(argv) {
  const m = /* @__PURE__ */ new Map();
  for (let i = 0; i + 1 < argv.length; i += 2) m.set(argv[i], argv[i + 1]);
  const cwd = m.get("--cwd");
  const active = m.get("--stop-hook-active");
  if (cwd === void 0 || active !== "true" && active !== "false") return null;
  return { cwd, projectDir: m.get("--project-dir"), session: m.get("--session") ?? "", active: active === "true" };
}
async function main(argv) {
  const a = parse(argv);
  if (a === null) {
    process.stderr.write("usage: stop-dispatch --cwd <dir> [--project-dir <dir>] --session <id> --stop-hook-active <true|false>\n");
    return 2;
  }
  const phaseResultCli = path8.join(path8.dirname(fs7.realpathSync(process.argv[1] ?? "")), "phase-result.cjs");
  const out = await dispatch({ cwd: a.cwd, projectDir: a.projectDir, sessionId: a.session, stopHookActive: a.active }, { phaseResultCli });
  if (out !== null) process.stdout.write(`${JSON.stringify(out)}
`);
  return 0;
}
main(process.argv.slice(2)).then(
  (rc) => {
    process.exitCode = rc;
  },
  () => {
    process.exitCode = 2;
  }
);
