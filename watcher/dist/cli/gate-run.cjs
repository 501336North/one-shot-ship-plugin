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

// src/cli/gate-run.ts
var import_node_path6 = __toESM(require("node:path"), 1);

// src/gate-run/gate-run.ts
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);

// src/utils/gate-agents.ts
var path = __toESM(require("path"), 1);

// src/utils/regular-file.ts
var fs = __toESM(require("fs"), 1);
var FLAGS = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK;
function notRegular(file) {
  return Object.assign(new Error(`ENOENT: not a regular file, open '${file}'`), { code: "ENOENT" });
}
function refused(st, owner) {
  return !st.isFile() || owner !== void 0 && st.uid !== owner;
}
function readRegularFileSync(file, owner) {
  if (!fs.statSync(file).isFile()) {
    throw notRegular(file);
  }
  const fd = fs.openSync(file, FLAGS);
  try {
    if (refused(fs.fstatSync(fd), owner)) {
      throw notRegular(file);
    }
    return fs.readFileSync(fd, "utf-8");
  } finally {
    fs.closeSync(fd);
  }
}
function missing(err) {
  return err?.code === "ENOENT";
}
function readRegularFileSyncOrNull(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  if (!st.isFile()) {
    return null;
  }
  try {
    return readRegularFileSync(file);
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

// src/utils/gate-agents.ts
function namesIn(file) {
  try {
    const text = readRegularFileSyncOrNull(file);
    const list = text === null ? null : JSON.parse(text)?.gateAgents;
    return Array.isArray(list) && list.every((n) => typeof n === "string" && n.length > 0) ? list : null;
  } catch {
    return null;
  }
}
function isGateAgent(agent, gateAgents) {
  if (agent === void 0) return false;
  const bare = agent.slice(agent.lastIndexOf(":") + 1).trim().toLowerCase();
  return gateAgents.some((name) => name.trim().toLowerCase() === bare);
}
function readGateAgents(pluginRoot, repoRoot) {
  const base = namesIn(path.join(pluginRoot, "config", "tool-gates.json"));
  if (base === null) throw new Error("plugin gateAgents is missing or invalid");
  return [.../* @__PURE__ */ new Set([...base, ...namesIn(path.join(repoRoot, ".oss", "tool-gates.json")) ?? []])];
}

// src/gate-run/fingerprint.ts
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);

// src/gate-run/git.ts
var import_node_child_process2 = require("node:child_process");

// src/gate-run/git-bin.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp", "/var/folders", "/private/var/folders", "/dev/shm"];
var MAX_HOPS = 8;
function inTemp(file) {
  const roots = [...TEMP_ROOTS];
  const tmp = process.env.TMPDIR?.replace(/\/+$/, "");
  if (tmp !== void 0 && import_node_path.default.isAbsolute(tmp)) roots.push(tmp);
  return roots.some((root) => file === root || file.startsWith(`${root}/`));
}
function ownerOk(stats) {
  return stats.uid === 0 || stats.uid === process.getuid?.();
}
function physical(file) {
  try {
    return import_node_path.default.join(import_node_fs.default.realpathSync(import_node_path.default.dirname(file)), import_node_path.default.basename(file));
  } catch {
    return null;
  }
}
function checkedProgram(file) {
  if (!import_node_path.default.isAbsolute(file)) return false;
  let current = file;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const real = physical(current);
    if (inTemp(import_node_path.default.normalize(current)) || real === null || inTemp(real)) return false;
    const stats = import_node_fs.default.lstatSync(real, { throwIfNoEntry: false });
    if (stats === void 0 || !ownerOk(stats)) return false;
    if (!stats.isSymbolicLink()) return stats.isFile() && (stats.mode & 73) !== 0;
    current = import_node_path.default.resolve(import_node_path.default.dirname(real), import_node_fs.default.readlinkSync(real));
  }
  return false;
}
function developerGit() {
  try {
    const dir = (0, import_node_child_process.execFileSync)("/usr/bin/xcode-select", ["-p"], { env: {}, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3e3 }).trim();
    return import_node_path.default.isAbsolute(dir) ? import_node_path.default.join(dir, "usr", "bin", "git") : null;
  } catch {
    return null;
  }
}
var resolved;
function gitBinary() {
  if (resolved !== void 0) return resolved;
  const candidates = process.platform === "darwin" ? [developerGit()] : ["/usr/bin/git", "/bin/git"];
  const found = candidates.find((file) => file !== null && checkedProgram(file));
  if (found === void 0) throw new Error("no git at a fixed, checked path");
  resolved = found;
  return found;
}
function fixedProgram(candidates) {
  return candidates.find((file) => import_node_fs.default.existsSync(file)) ?? candidates[0];
}

// src/gate-run/git.ts
var BudgetExceeded = class extends Error {
  constructor() {
    super("the check ran out of time");
    this.name = "BudgetExceeded";
  }
};
function remaining(budget) {
  const ms = budget.deadline - Date.now();
  if (ms <= 0) throw new BudgetExceeded();
  return ms;
}
var ISOLATED_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
var ISOLATED_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.excludesFile=/dev/null",
  "-c",
  "core.attributesFile=/dev/null"
];
function gitEnv(extra) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith("GIT_")) env[name] = value;
  return { ...env, ...ISOLATED_ENV, ...extra };
}
function git(cwd, args, budget, opts = {}) {
  const timeout = remaining(budget);
  try {
    const config = Object.entries(opts.config ?? {}).flatMap(([name, value]) => ["-c", `${name}=${value}`]);
    return (0, import_node_child_process2.execFileSync)(gitBinary(), [...ISOLATED_ARGS, ...config, ...args], {
      cwd,
      env: gitEnv(opts.env ?? {}),
      encoding: "utf8",
      input: opts.input,
      stdio: [opts.input === void 0 ? "ignore" : "pipe", "pipe", "ignore"],
      timeout,
      maxBuffer: 512 * 1024 * 1024
    });
  } catch (err) {
    if (err.code === "ETIMEDOUT" || Date.now() >= budget.deadline) throw new BudgetExceeded();
    throw err;
  }
}
function gitOrNull(cwd, args, budget) {
  try {
    return git(cwd, args, budget);
  } catch (err) {
    if (err instanceof BudgetExceeded) throw err;
    return null;
  }
}

// src/gate-run/run-store.ts
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);

// src/gate-run/messages.ts
var MAX_LISTED = 20;
var REASONS = {
  badId: "the review run could not be identified",
  notARepo: "the review did not run in a git repo",
  startFailed: "the snapshot at the review's start failed",
  noSnapshot: "no snapshot of the repo was found when the review ended",
  checkFailed: "the check failed",
  timeout: "the check ran out of time",
  tampered: "the check's own records were changed or replayed during the run",
  unknownNotice: "a notice was found for a review run the check never started",
  noticeUnreadable: "a notice could not be read; treat review runs in this session as unverified",
  recordsUnusable: "the check's records for this session could not be used",
  stopUnfinished: "the check at the review's end did not finish",
  versionChanged: "the review check changed version during the run",
  /** Kept by hooks/oss-gate-run.sh itself (same text there) when it has no usable node to run the check. */
  noNode: "the review check has no usable node"
};
function oneLine(text) {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?");
}
function voidMessage(files, total = files.length) {
  const listed = files.slice(0, MAX_LISTED).map((file) => `- ${oneLine(file)}`);
  if (total > MAX_LISTED) listed.push(`- and ${total - MAX_LISTED} more`);
  const user = files.some((file) => file.startsWith("(user) ")) ? [
    "Paths marked (user) are files outside the reviewed code that steer the review gate (OSS tool-gate and model settings, Claude hook, env and plugin settings in your home folder or a reviewed repo's .claude folder, installed plugins, the OSS hooks and plugin, the node and programs the hooks run, the repos the check covers).",
    "A change from outside the review, by another Claude session or you, would also void it."
  ] : [];
  const cli = files.some((file) => file === "(user) ~/.oss/bin/oss-decrypt") ? ["~/.oss/bin/oss-decrypt changed: an OSS decrypt CLI update during the review is the likely cause; the review is still void."] : [];
  return [
    "This review's report is void: the repo changed while the review ran, so it did not judge the code as it is now.",
    "Changed:",
    ...listed,
    ...user,
    ...cli,
    "Stop the ship and ask the user how to go on before acting on this review."
  ].join("\n");
}
function unverifiedMessage(reason) {
  return [
    `This review's report is unverified: OSS could not check whether the repo changed while the review ran (${oneLine(reason)}).`,
    "Treat the review's report as unverified: stop the ship and ask the user how to go on before acting on this review."
  ].join("\n");
}
function noticeMessage(notice) {
  return notice.kind === "void" ? voidMessage(notice.files, notice.total) : unverifiedMessage(notice.reason);
}

// src/gate-run/run-store.ts
var SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
var NOTICE_SUFFIX = ".notice.json";
var MAX_AGE_MS = 2 * 24 * 3600 * 1e3;
var MAX_NOTICE_FILES = 200;
var MAX_PATH_CHARS = 512;
var SEEN_FILE = "agents.seen";
var REPOS_FILE = "repos.json";
var KNOWN_REASONS = new Set(Object.values(REASONS));
function isSafeId(id) {
  return typeof id === "string" && SAFE_ID.test(id);
}
function runRoot(home) {
  return import_node_path2.default.join(home, ".oss", "gate-state");
}
function privateFolder(dir) {
  try {
    import_node_fs2.default.mkdirSync(dir, { mode: 448 });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  if (!import_node_fs2.default.lstatSync(dir).isDirectory()) throw new Error("gate-run state folder is not a plain folder");
}
function sessionFolder(home, sessionId) {
  if (!import_node_path2.default.isAbsolute(home)) throw new Error("HOME is not an absolute path");
  if (!isSafeId(sessionId)) throw new Error("session_id is not a safe file name");
  import_node_fs2.default.mkdirSync(import_node_path2.default.join(home, ".oss"), { recursive: true, mode: 448 });
  privateFolder(runRoot(home));
  const dir = import_node_path2.default.join(runRoot(home), sessionId);
  privateFolder(dir);
  return dir;
}
function sessionState(home, sessionId) {
  if (!import_node_path2.default.isAbsolute(home) || !isSafeId(sessionId)) return "unusable";
  for (const dir of [runRoot(home), import_node_path2.default.join(runRoot(home), sessionId)]) {
    const stats = import_node_fs2.default.lstatSync(dir, { throwIfNoEntry: false });
    if (stats === void 0) return "missing";
    if (!stats.isDirectory()) return "unusable";
  }
  return "ok";
}
function existingSessionFolder(home, sessionId) {
  return sessionState(home, sessionId) === "ok" ? import_node_path2.default.join(runRoot(home), sessionId) : null;
}
function writePrivateFile(file, text) {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW, O_NONBLOCK } = import_node_fs2.default.constants;
  const fd = import_node_fs2.default.openSync(file, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_NONBLOCK, 384);
  try {
    if (!import_node_fs2.default.fstatSync(fd).isFile()) throw new Error("gate-run state file is not a regular file");
    import_node_fs2.default.writeFileSync(fd, text);
  } finally {
    import_node_fs2.default.closeSync(fd);
  }
}
function readPrivateFile(file) {
  let fd;
  try {
    fd = import_node_fs2.default.openSync(file, import_node_fs2.default.constants.O_RDONLY | import_node_fs2.default.constants.O_NOFOLLOW | import_node_fs2.default.constants.O_NONBLOCK);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    if (!import_node_fs2.default.fstatSync(fd).isFile()) throw new Error("gate-run state file is not a regular file");
    return import_node_fs2.default.readFileSync(fd, "utf8");
  } finally {
    import_node_fs2.default.closeSync(fd);
  }
}
function takePrivateFile(file) {
  const claimed = `${file}.taken-${process.pid}-${import_node_crypto.default.randomBytes(6).toString("hex")}`;
  try {
    import_node_fs2.default.renameSync(file, claimed);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return readPrivateFile(claimed);
  } finally {
    import_node_fs2.default.rmSync(claimed, { force: true });
  }
}
function markFile(home, sessionId, agentId, which) {
  if (!isSafeId(agentId)) throw new Error("agent_id is not a safe file name");
  return import_node_path2.default.join(sessionFolder(home, sessionId), `${agentId}.${which}`);
}
function mark(home, sessionId, agentId, which) {
  writePrivateFile(markFile(home, sessionId, agentId, which), `${(/* @__PURE__ */ new Date()).toISOString()}
`);
}
function hasMark(home, sessionId, agentId, which) {
  const dir = existingSessionFolder(home, sessionId);
  if (dir === null || !isSafeId(agentId)) return false;
  return import_node_fs2.default.lstatSync(import_node_path2.default.join(dir, `${agentId}.${which}`), { throwIfNoEntry: false })?.isFile() === true;
}
function clearMark(home, sessionId, agentId, which) {
  const dir = existingSessionFolder(home, sessionId);
  if (dir !== null && isSafeId(agentId)) import_node_fs2.default.rmSync(import_node_path2.default.join(dir, `${agentId}.${which}`), { force: true });
}
function isKnownReason(reason) {
  return KNOWN_REASONS.has(reason);
}
function appendPrivateFile(file, text) {
  const { O_WRONLY, O_CREAT, O_APPEND, O_NOFOLLOW, O_NONBLOCK } = import_node_fs2.default.constants;
  const fd = import_node_fs2.default.openSync(file, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW | O_NONBLOCK, 384);
  try {
    if (!import_node_fs2.default.fstatSync(fd).isFile()) throw new Error("gate-run state file is not a regular file");
    import_node_fs2.default.writeSync(fd, text);
  } finally {
    import_node_fs2.default.closeSync(fd);
  }
}
function markSeen(home, sessionId, agentId) {
  if (!isSafeId(agentId)) throw new Error("agent_id is not a safe file name");
  appendPrivateFile(import_node_path2.default.join(sessionFolder(home, sessionId), SEEN_FILE), `${agentId}
`);
}
function wasSeen(home, sessionId, agentId) {
  const text = readPrivateFile(import_node_path2.default.join(sessionFolder(home, sessionId), SEEN_FILE));
  return text !== null && text.split("\n").includes(agentId);
}
function reviewedReposFor(home, sessionId) {
  const dir = existingSessionFolder(home, sessionId);
  if (dir === null) return [];
  try {
    const value = JSON.parse(readPrivateFile(import_node_path2.default.join(dir, REPOS_FILE)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((repo) => typeof repo === "string" && import_node_path2.default.isAbsolute(repo) && !repo.includes("'"));
  } catch {
    return [];
  }
}
function addReviewedRepo(home, sessionId, top) {
  const repos = [.../* @__PURE__ */ new Set([...reviewedReposFor(home, sessionId), top])];
  writePrivateFile(import_node_path2.default.join(sessionFolder(home, sessionId), REPOS_FILE), JSON.stringify(repos));
}
function storeNotice(home, sessionId, agentId, notice) {
  if (!isSafeId(agentId)) throw new Error("agent_id is not a safe file name");
  const unique = `${Date.now()}-${import_node_crypto.default.randomBytes(4).toString("hex")}`;
  writePrivateFile(import_node_path2.default.join(sessionFolder(home, sessionId), `${agentId}.${unique}${NOTICE_SUFFIX}`), JSON.stringify(notice));
}
function parseNotice(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const notice = value;
  if (notice.kind === "unverified") {
    if (typeof notice.reason !== "string") return null;
    return { kind: "unverified", reason: KNOWN_REASONS.has(notice.reason) ? notice.reason : REASONS.checkFailed };
  }
  if (notice.kind !== "void") return null;
  const { files, total } = notice;
  if (!Array.isArray(files) || !files.every((file) => typeof file === "string")) return null;
  if (typeof total !== "number" || !Number.isInteger(total) || total < files.length) return null;
  return { kind: "void", files: files.slice(0, MAX_NOTICE_FILES).map((file) => file.slice(0, MAX_PATH_CHARS)), total };
}
function takeNotices(home, sessionId, agentId) {
  const taken = { notices: [], unreadable: 0, unknown: 0 };
  const dir = existingSessionFolder(home, sessionId);
  if (dir === null || agentId !== void 0 && !isSafeId(agentId)) return taken;
  const names = import_node_fs2.default.readdirSync(dir).filter((name) => name.endsWith(NOTICE_SUFFIX) && (agentId === void 0 || name.startsWith(`${agentId}.`))).sort();
  for (const name of names) {
    const owner = name.slice(0, name.indexOf("."));
    const known = hasMark(home, sessionId, owner, "started") || hasMark(home, sessionId, owner, "done");
    let text;
    try {
      text = takePrivateFile(import_node_path2.default.join(dir, name));
    } catch {
      taken.unreadable++;
      continue;
    }
    if (text === null) continue;
    if (!known) {
      taken.unknown++;
      continue;
    }
    const notice = parseNotice(text);
    if (notice === null) taken.unreadable++;
    else taken.notices.push(notice);
  }
  return taken;
}
function isOld(stats, now) {
  return now - stats.mtimeMs > MAX_AGE_MS;
}
function sweepRunFolder(home, now) {
  try {
    const root = runRoot(home);
    if (import_node_fs2.default.lstatSync(root, { throwIfNoEntry: false })?.isDirectory() !== true) return;
    for (const name of import_node_fs2.default.readdirSync(root)) {
      const entry = import_node_path2.default.join(root, name);
      const stats = import_node_fs2.default.lstatSync(entry);
      if (!stats.isDirectory()) {
        if (isOld(stats, now)) import_node_fs2.default.rmSync(entry, { force: true });
        continue;
      }
      if (isOld(stats, now)) {
        import_node_fs2.default.rmSync(entry, { recursive: true, force: true });
        continue;
      }
      for (const inner of import_node_fs2.default.readdirSync(entry)) {
        const file = import_node_path2.default.join(entry, inner);
        if (isOld(import_node_fs2.default.lstatSync(file), now)) import_node_fs2.default.rmSync(file, { recursive: true, force: true });
      }
    }
  } catch {
  }
}

// src/gate-run/fingerprint.ts
var OSS_RUN_FILES = [
  ".oss/logs/**",
  ".oss/workflow.log",
  ".oss/sessions/**",
  ".oss/locks/**",
  ".oss/run/**",
  ".oss/session-context.md",
  ".oss/workflow-state.json",
  ".oss/health-workflow-state.json",
  ".oss/queue.json",
  ".oss/current-project",
  ".oss/timeline-outbox/**",
  ".oss/tool-gates/**",
  ".oss/.iron-laws-*",
  ".oss/dev/timeline-unfiled.ndjson",
  ".oss/dev/active/*/timeline.ndjson",
  ".oss/dev/completed/*/timeline.ndjson"
];
var RUN_FILE_IGNORE_RULES = `${OSS_RUN_FILES.map((glob) => `/${glob}`).join("\n")}
`;
var RUN_FILE_PATHS = ["--", ...OSS_RUN_FILES.map((glob) => `:(top,glob)${glob}`)];
var RISKY_ITEMS = ["config", "config.worktree", ".git/hooks", ".git/info"];
var USER_CONFIG_FILES = [".gitconfig", ".config/git/config", ".config/git/attributes", ".config/git/ignore"];
var MAX_DIR_ENTRIES = 2e3;
var MAX_NESTING = 5;
var BIG_FILE_BYTES = 8 * 1024 * 1024;
var WALK_CONCURRENCY = 64;
function sha256(text) {
  return import_node_crypto2.default.createHash("sha256").update(text).digest("hex");
}
function shortHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function statKey(stats) {
  return `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;
}
function layout(folder, budget) {
  const [top, index, head, config, configWorktree, hooks, info, objects] = git(
    folder,
    [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      ...["index", "HEAD", "config", "config.worktree", "hooks", "info", "objects"].flatMap((name) => ["--git-path", name])
    ],
    budget
  ).split("\n");
  return { top, index, head, config, configWorktree, hooks, info, objects };
}
function typeOf(stats) {
  if (stats.isFIFO()) return "fifo";
  if (stats.isSocket()) return "socket";
  if (stats.isCharacterDevice()) return "char-device";
  if (stats.isBlockDevice()) return "block-device";
  if (stats.isDirectory()) return "dir";
  if (stats.isSymbolicLink()) return "link";
  return "other";
}
function readRegular(file, follow) {
  let stats;
  try {
    stats = follow ? import_node_fs3.default.statSync(file, { throwIfNoEntry: false }) : import_node_fs3.default.lstatSync(file, { throwIfNoEntry: false });
  } catch (err) {
    if (err.code === "ENOTDIR" || err.code === "ELOOP") return { kind: "none" };
    throw err;
  }
  if (stats === void 0) return { kind: "none" };
  if (stats.isSymbolicLink()) return { kind: "link", target: import_node_fs3.default.readlinkSync(file) };
  if (!stats.isFile()) return { kind: "other", type: typeOf(stats) };
  const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = import_node_fs3.default.constants;
  const fd = import_node_fs3.default.openSync(file, O_RDONLY | O_NONBLOCK | (follow ? 0 : O_NOFOLLOW));
  try {
    const opened = import_node_fs3.default.fstatSync(fd);
    if (!opened.isFile()) return { kind: "other", type: typeOf(opened) };
    return { kind: "file", data: import_node_fs3.default.readFileSync(fd) };
  } finally {
    import_node_fs3.default.closeSync(fd);
  }
}
function entryDigest(entry) {
  switch (entry.kind) {
    case "none":
      return "(none)";
    case "file":
      return sha256(entry.data);
    case "link":
      return `link ${entry.target}`;
    case "other":
      return `(${entry.type})`;
  }
}
function dirDigest(dir, budget) {
  const lines = [];
  const walk2 = (current, rel) => {
    let names;
    try {
      names = import_node_fs3.default.readdirSync(current).sort();
    } catch (err) {
      const code = err.code;
      if (rel === "" && (code === "ENOENT" || code === "ENOTDIR")) {
        lines.push(`(not a folder) ${entryDigest(readRegular(current, false))}`);
        return;
      }
      throw err;
    }
    for (const name of names) {
      remaining(budget);
      if (lines.length >= MAX_DIR_ENTRIES) {
        lines.push("(more)");
        return;
      }
      const abs = import_node_path3.default.join(current, name);
      const relName = rel === "" ? name : `${rel}/${name}`;
      const stats = import_node_fs3.default.lstatSync(abs);
      if (stats.isDirectory()) {
        lines.push(`d ${relName}`);
        walk2(abs, relName);
      } else lines.push(`f ${relName} ${stats.mode & 511} ${entryDigest(readRegular(abs, false))}`);
    }
  };
  walk2(dir, "");
  return sha256(lines.join("\n"));
}
function gitState(lay, ctx, before) {
  const { budget } = ctx;
  const state = {};
  const { top } = lay;
  state.config = entryDigest(readRegular(lay.config, false));
  const worktreeConfig = readRegular(lay.configWorktree, false);
  if (worktreeConfig.kind !== "none") state["config.worktree"] = entryDigest(worktreeConfig);
  const refs = {};
  for (const line of git(top, ["for-each-ref", "--format=%(objectname) %(refname)"], budget).split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0) refs[line.slice(space + 1)] = line.slice(0, space);
  }
  const headEntry = readRegular(lay.head, false);
  const head = headEntry.kind === "file" ? headEntry.data.toString("utf8").trim() : entryDigest(headEntry);
  const target = head.startsWith("ref: ") ? head.slice("ref: ".length) : null;
  state.HEAD = target === null ? head : `${head} ${refs[target] ?? "(unborn)"}`;
  Object.assign(state, refs);
  const assumeUnchanged = [];
  const skipWorktree = [];
  const staged = [];
  for (const entry of git(top, ["ls-files", "-s", "-v", "-z"], budget).split("\0")) {
    if (entry === "") continue;
    const tag = entry.charAt(0);
    const line = entry.slice(2);
    const file = line.slice(line.indexOf("	") + 1);
    staged.push(line);
    if (tag === "S" || tag === "s") skipWorktree.push(file);
    if (tag !== tag.toUpperCase()) assumeUnchanged.push(file);
  }
  state["index flags"] = sha256(`${assumeUnchanged.join("\0")}
${skipWorktree.join("\0")}`);
  state["staged changes"] = sha256(staged.join("\0"));
  if (before !== void 0 && before.config !== state.config) state[".git/hooks"] = before[".git/hooks"];
  else {
    const hooksPath = gitOrNull(top, ["config", "--type=path", "--get", "core.hooksPath"], budget)?.trim();
    const hooks = hooksPath ? import_node_path3.default.resolve(top, hooksPath) : lay.hooks;
    state[".git/hooks"] = dirDigest(hooks, budget);
  }
  state[".git/info"] = dirDigest(lay.info, budget);
  state["worktree list"] = sha256(git(top, ["worktree", "list", "--porcelain"], budget));
  state["user config"] = sha256(
    USER_CONFIG_FILES.map((file) => `${file} ${entryDigest(readRegular(import_node_path3.default.join(ctx.home, file), true))}`).join("\n")
  );
  return { state, assumeUnchanged, skipWorktree };
}
function filtersOff(top, budget) {
  const out = gitOrNull(top, ["config", "-z", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"], budget) ?? "";
  const config = {};
  for (const record of out.split("\0")) {
    const match = /^filter\.(.+)\.(clean|smudge|process|required)$/i.exec(record.split("\n")[0] ?? "");
    if (match === null) continue;
    const name = match[1];
    config[`filter.${name}.clean`] = "cat";
    config[`filter.${name}.smudge`] = "cat";
    config[`filter.${name}.process`] = "";
    config[`filter.${name}.required`] = "false";
  }
  return config;
}
function objectEnv(lay, ctx) {
  const dir = import_node_path3.default.join(ctx.runDir, "objects", sha256(lay.top).slice(0, 16));
  import_node_fs3.default.mkdirSync(dir, { recursive: true, mode: 448 });
  return { GIT_OBJECT_DIRECTORY: dir, GIT_ALTERNATE_OBJECT_DIRECTORIES: lay.objects };
}
function untrackedFiles(top, excludes, budget) {
  const untracked = {};
  const toHash = [];
  const listed = git(top, ["ls-files", "-o", "--exclude-standard", "-z"], budget, { config: { "core.excludesFile": excludes } });
  for (const file of listed.split("\0")) {
    if (file === "") continue;
    if (file.endsWith("/")) {
      const head = gitOrNull(import_node_path3.default.join(top, file), ["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"], budget);
      untracked[file.slice(0, -1)] = head === null ? "repo:unborn" : `repo:${head.trim().split("\n").join(" ")}`;
      continue;
    }
    const abs = import_node_path3.default.join(top, file);
    const stats = import_node_fs3.default.lstatSync(abs, { throwIfNoEntry: false });
    if (stats === void 0) continue;
    if (stats.isSymbolicLink()) untracked[file] = `link:${import_node_fs3.default.readlinkSync(abs)}`;
    else if (!stats.isFile()) untracked[file] = `type:${typeOf(stats)}`;
    else if (stats.size > BIG_FILE_BYTES || file.includes("\n")) untracked[file] = `stat:${statKey(stats)}`;
    else toHash.push(file);
  }
  if (toHash.length > 0) {
    const ids = git(top, ["hash-object", "--no-filters", "--stdin-paths"], budget, { input: `${toHash.join("\n")}
` }).split("\n");
    toHash.forEach((file, i) => {
      untracked[file] = `blob:${ids[i]}`;
    });
  }
  return untracked;
}
function workTree(lay, gs, ctx, objects) {
  const { top } = lay;
  const { budget } = ctx;
  const tempIndex = import_node_path3.default.join(ctx.runDir, "index");
  const excludes = import_node_path3.default.join(ctx.runDir, "exclude");
  import_node_fs3.default.rmSync(tempIndex, { force: true });
  try {
    const real = import_node_fs3.default.statSync(lay.index, { throwIfNoEntry: false });
    if (real !== void 0) {
      import_node_fs3.default.copyFileSync(lay.index, tempIndex, import_node_fs3.default.constants.COPYFILE_EXCL);
      import_node_fs3.default.utimesSync(tempIndex, real.atime, real.mtime);
    }
    const env = { env: { GIT_INDEX_FILE: tempIndex, ...objects } };
    if (gs.assumeUnchanged.length > 0) {
      git(top, ["update-index", "--no-assume-unchanged", "-z", "--stdin"], budget, { ...env, input: gs.assumeUnchanged.join("\0") });
    }
    if (gs.skipWorktree.length > 0) {
      git(top, ["update-index", "--no-skip-worktree", "-z", "--stdin"], budget, { ...env, input: gs.skipWorktree.join("\0") });
    }
    writePrivateFile(excludes, RUN_FILE_IGNORE_RULES);
    const untracked = untrackedFiles(top, excludes, budget);
    git(top, ["add", "-u", "--", ":(top)"], budget, { ...env, config: filtersOff(top, budget) });
    git(top, ["rm", "--cached", "-r", "-q", "-f", "--ignore-unmatch", ...RUN_FILE_PATHS], budget, env);
    return { tree: git(top, ["write-tree"], budget, env).trim(), untracked };
  } finally {
    import_node_fs3.default.rmSync(tempIndex, { force: true });
    import_node_fs3.default.rmSync(excludes, { force: true });
  }
}
function ignoredPaths(top, budget) {
  return git(top, ["ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z"], budget).split("\0").filter((entry) => entry !== "");
}
function depFolders(ignored, untracked) {
  const bare = (entry) => entry.endsWith("/") ? entry.slice(0, -1) : entry;
  const named = (entry) => import_node_path3.default.posix.basename(bare(entry)) === "node_modules";
  return [
    ...ignored.filter(named).map(bare),
    ...Object.entries(untracked).filter(([file, value]) => named(file) && value.startsWith("link:")).map(([file]) => file)
  ];
}
function depRoots(top, rels) {
  const roots = [];
  for (const rel of new Set(rels)) {
    const abs = import_node_path3.default.join(top, rel);
    const stats = import_node_fs3.default.lstatSync(abs, { throwIfNoEntry: false });
    if (stats === void 0) continue;
    if (stats.isSymbolicLink()) roots.push({ rel, abs: import_node_fs3.default.realpathSync(abs) });
    else if (stats.isDirectory()) roots.push({ rel, abs });
  }
  return roots;
}
function isDepCache(name) {
  return name === ".cache" || name.startsWith(".vite");
}
async function eachLimited(items, budget, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      remaining(budget);
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WALK_CONCURRENCY, items.length) }, worker));
}
function isGone(err) {
  const code = err.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
async function walkDeps(roots, budget) {
  const groups = /* @__PURE__ */ new Map();
  const add = (dir, name, hash) => {
    const group = groups.get(dir);
    if (group === void 0) groups.set(dir, [`${name}/${hash}`]);
    else group.push(`${name}/${hash}`);
  };
  let level = roots.map(({ rel, abs }) => ({ rel, abs, inNodeModules: true }));
  while (level.length > 0) {
    const nextLevel = [];
    const leaves = [];
    await eachLimited(level, budget, async ({ rel, abs, inNodeModules }) => {
      let entries;
      try {
        entries = await import_node_fs3.default.promises.readdir(abs, { withFileTypes: true });
      } catch (err) {
        if (isGone(err)) return;
        throw err;
      }
      for (const entry of entries) {
        if (inNodeModules && isDepCache(entry.name)) continue;
        const child = import_node_path3.default.join(abs, entry.name);
        if (entry.isDirectory()) nextLevel.push({ rel: `${rel}/${entry.name}`, abs: child, inNodeModules: entry.name === "node_modules" });
        else leaves.push({ dir: rel, name: entry.name, abs: child });
      }
    });
    await eachLimited(leaves, budget, async ({ dir, name, abs }) => {
      try {
        const stats = await import_node_fs3.default.promises.lstat(abs);
        add(dir, name, shortHash(stats.isSymbolicLink() ? `l:${await import_node_fs3.default.promises.readlink(abs)}` : statKey(stats)));
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    });
    level = nextLevel;
  }
  const deps = {};
  for (const [dir, group] of groups) deps[dir] = group.sort().join("/");
  return deps;
}
function depChanges(before, after) {
  const changed = [];
  const parse = (packed) => {
    const map = /* @__PURE__ */ new Map();
    const parts = packed === void 0 ? [] : packed.split("/");
    for (let i = 0; i + 1 < parts.length; i += 2) map.set(parts[i], parts[i + 1]);
    return map;
  };
  for (const dir of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[dir] === after[dir]) continue;
    const was = parse(before[dir]);
    const now = parse(after[dir]);
    for (const name of /* @__PURE__ */ new Set([...was.keys(), ...now.keys()])) if (was.get(name) !== now.get(name)) changed.push(`${dir}/${name}`);
  }
  return changed;
}
function gitlinks(top, tree, budget, objects) {
  const links = [];
  for (const entry of git(top, ["ls-tree", "-r", "-z", tree], budget, { env: objects }).split("\0")) {
    if (entry.startsWith("160000 ")) links.push(entry.slice(entry.indexOf("	") + 1));
  }
  return links;
}
function nestedLayout(folder, budget) {
  if (!import_node_fs3.default.existsSync(import_node_path3.default.join(folder, ".git"))) return null;
  try {
    const lay = layout(folder, budget);
    return import_node_fs3.default.realpathSync(lay.top) === import_node_fs3.default.realpathSync(folder) ? lay : null;
  } catch (err) {
    if (err.name === "BudgetExceeded") throw err;
    return null;
  }
}
async function print(lay, ctx, depth) {
  const objects = objectEnv(lay, ctx);
  const gs = gitState(lay, ctx);
  const { tree, untracked } = workTree(lay, gs, ctx, objects);
  const depDirs = depFolders(ignoredPaths(lay.top, ctx.budget), untracked);
  const deps = await walkDeps(depRoots(lay.top, depDirs), ctx.budget);
  const nested = {};
  if (depth < MAX_NESTING) {
    for (const link of gitlinks(lay.top, tree, ctx.budget, objects)) {
      const inner = nestedLayout(import_node_path3.default.join(lay.top, link), ctx.budget);
      if (inner !== null) nested[link] = await print(inner, ctx, depth + 1);
    }
  }
  return { tree, state: gs.state, nested, depDirs, deps, untracked };
}
function isTextRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
}
function isTextList(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}
function isRepoPrint(value, depth = 0) {
  if (typeof value !== "object" || value === null || depth > MAX_NESTING) return false;
  const print2 = value;
  return typeof print2.tree === "string" && /^[0-9a-f]{40,64}$/.test(print2.tree) && isTextRecord(print2.state) && typeof print2.nested === "object" && print2.nested !== null && Object.values(print2.nested).every((inner) => isRepoPrint(inner, depth + 1)) && isTextList(print2.depDirs) && isTextRecord(print2.deps) && isTextRecord(print2.untracked);
}
async function printRepo(top, ctx) {
  return print(layout(top, ctx.budget), ctx, 0);
}
async function changes(lay, before, ctx, depth) {
  const { budget } = ctx;
  const gs = gitState(lay, ctx, before.state);
  const keys = [.../* @__PURE__ */ new Set([...Object.keys(before.state), ...Object.keys(gs.state)])];
  const changedState = keys.filter((key) => before.state[key] !== gs.state[key]);
  const named = changedState.map((key) => `(git) ${key}`);
  if (changedState.some((key) => RISKY_ITEMS.includes(key))) return named;
  const objects = objectEnv(lay, ctx);
  const { tree, untracked } = workTree(lay, gs, ctx, objects);
  const out = git(lay.top, ["diff-tree", "-r", "-z", "--no-renames", "--name-only", before.tree, tree], budget, { env: objects });
  const files = out.split("\0").filter((name) => name !== "");
  for (const file of /* @__PURE__ */ new Set([...Object.keys(before.untracked), ...Object.keys(untracked)])) {
    if (before.untracked[file] !== untracked[file]) files.push(file);
  }
  const depDirs = [...before.depDirs, ...depFolders(ignoredPaths(lay.top, budget), untracked)];
  files.push(...depChanges(before.deps, await walkDeps(depRoots(lay.top, depDirs), budget)));
  if (depth < MAX_NESTING && Object.keys(before.nested).length > 0) {
    const links = new Set(gitlinks(lay.top, tree, budget, objects));
    for (const [link, inner] of Object.entries(before.nested)) {
      const innerLay = links.has(link) ? nestedLayout(import_node_path3.default.join(lay.top, link), budget) : null;
      if (innerLay === null) {
        files.push(link);
        continue;
      }
      for (const change of await changes(innerLay, inner, ctx, depth + 1)) {
        if (change.startsWith("(git) ")) named.push(`(git) ${link}: ${change.slice("(git) ".length)}`);
        else named.push(`${link}/${change}`);
      }
    }
  }
  return [.../* @__PURE__ */ new Set([...named, ...files])].sort();
}
async function changesSince(top, before, ctx) {
  return changes(layout(top, ctx.budget), before, ctx, 0);
}

// src/gate-run/user-files.ts
var import_node_crypto3 = __toESM(require("node:crypto"), 1);
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
var CONTENT_MAX_BYTES = 1024 * 1024;
var JSON_MAX_BYTES = 4 * 1024 * 1024;
var BUDGET_EVERY = 256;
var CONFIG_KEYS = ["toolGates", "models"];
var SETTINGS_KEYS = [
  "hooks",
  "disableAllHooks",
  "allowManagedHooksOnly",
  "env",
  "enabledPlugins",
  "extraKnownMarketplaces",
  "pluginDirs"
];
var SETTINGS_FILES = ["settings.json", "settings.local.json"];
var OSS_TREES = [".oss/hooks", ".oss/bin"];
var LEFT_OUT = [".oss/bin/.download", ".oss/bin/.decrypt-upgrade-failed"];
var INSTALLED_PLUGINS = "plugins/installed_plugins.json";
var NODE_PATH = ".oss/node-path";
var FIXED_PROGRAMS = {
  cat: ["/bin/cat", "/usr/bin/cat"],
  mktemp: ["/usr/bin/mktemp", "/bin/mktemp"],
  bash: ["/bin/bash", "/usr/bin/bash"],
  rm: ["/bin/rm", "/usr/bin/rm"],
  mkdir: ["/bin/mkdir", "/usr/bin/mkdir"],
  date: ["/bin/date", "/usr/bin/date"],
  tr: ["/usr/bin/tr", "/bin/tr"],
  head: ["/usr/bin/head", "/bin/head"],
  cut: ["/usr/bin/cut", "/bin/cut"]
};
var PLUGIN_PARTS = [
  { part: "hooks", byContent: (rel) => !rel.includes("/") },
  { part: "config", byContent: () => true },
  { part: "watcher/dist", byContent: (rel) => rel === "cli/tool-gate.cjs" || rel === "cli/gate-run.cjs" },
  { part: "hooks.json", byContent: () => true },
  { part: ".claude-plugin", byContent: () => true }
];
function sha(text) {
  return import_node_crypto3.default.createHash("sha256").update(text).digest("hex").slice(0, 32);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
function statKey2(stats) {
  return `stat:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;
}
function typeOf2(stats) {
  if (stats.isDirectory()) return "type:dir";
  if (stats.isFIFO()) return "type:fifo";
  if (stats.isSocket()) return "type:socket";
  if (stats.isCharacterDevice() || stats.isBlockDevice()) return "type:device";
  return "type:other";
}
function readFile(file, follow, max) {
  const stats = (follow ? import_node_fs4.default.statSync : import_node_fs4.default.lstatSync)(file, { throwIfNoEntry: false });
  if (stats === void 0) return { record: "missing" };
  if (!stats.isFile()) return { record: typeOf2(stats) };
  if (stats.size > max) return { record: statKey2(stats) };
  const fd = import_node_fs4.default.openSync(file, import_node_fs4.default.constants.O_RDONLY | import_node_fs4.default.constants.O_NONBLOCK | (follow ? 0 : import_node_fs4.default.constants.O_NOFOLLOW));
  try {
    const opened = import_node_fs4.default.fstatSync(fd);
    if (!opened.isFile()) return { record: typeOf2(opened) };
    return { bytes: import_node_fs4.default.readFileSync(fd) };
  } finally {
    import_node_fs4.default.closeSync(fd);
  }
}
function withLink(file, record) {
  return import_node_fs4.default.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true ? `link:${import_node_fs4.default.readlinkSync(file)}|${record}` : record;
}
function fileValue(file, follow) {
  const read = readFile(file, follow, CONTENT_MAX_BYTES);
  return "bytes" in read ? `sha:${sha(read.bytes)}` : read.record;
}
function parseJson(file) {
  const read = readFile(file, true, JSON_MAX_BYTES);
  if (!("bytes" in read)) return read;
  try {
    return { value: JSON.parse(read.bytes.toString("utf8")) };
  } catch {
    return { record: `unparsable:${sha(read.bytes)}` };
  }
}
function keyValue(file, key) {
  const parsed = parseJson(file);
  if (!("value" in parsed)) return withLink(file, parsed.record);
  const { value } = parsed;
  const inner = value !== null && typeof value === "object" && !Array.isArray(value) ? value[key] : void 0;
  return withLink(file, inner === void 0 ? "absent" : `json:${sha(canonical(inner))}`);
}
function nameOf(home, abs) {
  const rel = import_node_path4.default.relative(home, abs);
  return rel !== "" && !rel.startsWith("..") && !import_node_path4.default.isAbsolute(rel) ? `~/${rel}` : abs;
}
function statValue(file) {
  const stats = import_node_fs4.default.lstatSync(file);
  return stats.isFile() ? statKey2(stats) : typeOf2(stats);
}
function walk(home, start, budget, out, skip = /* @__PURE__ */ new Set(), byContent = () => true) {
  const top = import_node_fs4.default.lstatSync(start, { throwIfNoEntry: false });
  const name = nameOf(home, start);
  if (top === void 0) return;
  const real = top.isSymbolicLink() ? import_node_fs4.default.realpathSync(start) : start;
  if (!import_node_fs4.default.statSync(real).isDirectory()) {
    out[name] = withLink(start, fileValue(real, true));
    return;
  }
  if (top.isSymbolicLink()) out[name] = withLink(start, "dir");
  const stack = [{ abs: real, key: name, rel: "" }];
  let seen = 0;
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of import_node_fs4.default.readdirSync(dir.abs, { withFileTypes: true })) {
      if (++seen % BUDGET_EVERY === 0) remaining(budget);
      const abs = import_node_path4.default.join(dir.abs, entry.name);
      const key = `${dir.key}/${entry.name}`;
      const rel = dir.rel === "" ? entry.name : `${dir.rel}/${entry.name}`;
      if (skip.has(key)) continue;
      if (entry.isDirectory()) {
        stack.push({ abs, key, rel });
      } else if (entry.isSymbolicLink()) {
        out[key] = `link:${import_node_fs4.default.readlinkSync(abs)}`;
      } else {
        out[key] = byContent(rel) ? fileValue(abs, false) : statValue(abs);
      }
    }
  }
}
function ossInstallPaths(value) {
  const plugins = value?.plugins;
  if (plugins === null || typeof plugins !== "object" || Array.isArray(plugins)) return [];
  return Object.entries(plugins).filter(([id]) => id.split("@")[0] === "oss").flatMap(([, entry]) => Array.isArray(entry) ? entry : [entry]).map((install) => install?.installPath).filter((p) => typeof p === "string" && import_node_path4.default.isAbsolute(p));
}
function realOrNull(file) {
  try {
    return import_node_fs4.default.realpathSync(file);
  } catch {
    return null;
  }
}
function recordedNode(home) {
  const read = readFile(import_node_path4.default.join(home, NODE_PATH), true, CONTENT_MAX_BYTES);
  if (!("bytes" in read)) return null;
  const line = read.bytes.toString("utf8").split("\n")[0].trim();
  return import_node_path4.default.isAbsolute(line) ? line : null;
}
function shadows(home, pathEnv, programs, out) {
  const dirs = pathEnv.split(":").filter((dir) => import_node_path4.default.isAbsolute(dir));
  for (const [name, real] of Object.entries(programs)) {
    const realPath = real === null ? null : realOrNull(real) ?? real;
    for (const dir of dirs) {
      const candidate = import_node_path4.default.join(dir, name);
      if (realPath !== null && realOrNull(candidate) === realPath) break;
      out[`PATH: ${nameOf(home, candidate)}`] = withLink(candidate, fileValue(candidate, true));
    }
  }
}
function printUserFiles(home, sessionId, budget, ctx = {}) {
  const out = {};
  remaining(budget);
  const config = import_node_path4.default.join(home, ".oss/config.json");
  for (const key of CONFIG_KEYS) out[`${nameOf(home, config)}: ${key}`] = keyValue(config, key);
  const claudeDirs = [.../* @__PURE__ */ new Set([import_node_path4.default.join(home, ".claude"), ...ctx.configDir !== void 0 && import_node_path4.default.isAbsolute(ctx.configDir) ? [ctx.configDir] : []])];
  const pluginRoots = /* @__PURE__ */ new Set();
  for (const dir of claudeDirs) {
    remaining(budget);
    for (const file of SETTINGS_FILES) {
      const abs = import_node_path4.default.join(dir, file);
      for (const key of SETTINGS_KEYS) out[`${nameOf(home, abs)}: ${key}`] = keyValue(abs, key);
    }
    const installed = import_node_path4.default.join(dir, INSTALLED_PLUGINS);
    out[`${nameOf(home, installed)}: plugins`] = keyValue(installed, "plugins");
    const parsed = parseJson(installed);
    if ("value" in parsed) for (const root of ossInstallPaths(parsed.value)) pluginRoots.add(realOrNull(root) ?? root);
  }
  for (const top of ctx.repos ?? []) {
    remaining(budget);
    for (const file of SETTINGS_FILES) {
      const abs = import_node_path4.default.join(top, ".claude", file);
      for (const key of SETTINGS_KEYS) out[`${nameOf(home, abs)}: ${key}`] = keyValue(abs, key);
    }
  }
  remaining(budget);
  const repos = import_node_path4.default.join(runRoot(home), sessionId, "repos.json");
  out[nameOf(home, repos)] = withLink(repos, fileValue(repos, true));
  const skip = new Set(LEFT_OUT.map((rel) => `~/${rel}`));
  for (const rel of OSS_TREES) {
    remaining(budget);
    walk(home, import_node_path4.default.join(home, rel), budget, out, skip);
  }
  for (const root of ctx.pluginRoots ?? []) {
    if (import_node_path4.default.isAbsolute(root)) pluginRoots.add(realOrNull(root) ?? root);
  }
  for (const root of pluginRoots) {
    for (const { part, byContent } of PLUGIN_PARTS) {
      remaining(budget);
      walk(home, import_node_path4.default.join(root, part), budget, out, /* @__PURE__ */ new Set(), byContent);
    }
  }
  remaining(budget);
  const nodePath = import_node_path4.default.join(home, NODE_PATH);
  out[nameOf(home, nodePath)] = withLink(nodePath, fileValue(nodePath, true));
  const node = recordedNode(home);
  if (node !== null) out[`node: ${nameOf(home, node)}`] = withLink(node, fileValue(node, true));
  const git2 = gitBinary();
  out[`git: ${nameOf(home, git2)}`] = withLink(git2, fileValue(git2, true));
  const fixed = Object.fromEntries(Object.entries(FIXED_PROGRAMS).map(([name, candidates]) => [name, fixedProgram(candidates)]));
  if (ctx.pathEnv !== void 0) shadows(home, ctx.pathEnv, { node, git: git2, ...fixed }, out);
  return out;
}
function userChanges(before, after) {
  const changed = [];
  for (const key of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[key] ?? "missing") !== (after[key] ?? "missing")) changed.push(`(user) ${key}`);
  }
  return changed.sort();
}

// src/gate-run/gate-run.ts
var CHECK_FAILED = "OSS review check could not run, so this review run is unverified: the repo may have changed while it ran.";
var BUDGET_MS = 7e3;
var MAX_STORED_PATHS = 200;
var SILENT = { exitCode: 0, stdout: "", stderr: "" };
function say(output) {
  return { exitCode: 0, stdout: `${JSON.stringify(output)}
`, stderr: "" };
}
function isFolder(dir) {
  return typeof dir === "string" && import_node_path5.default.isAbsolute(dir) && import_node_fs5.default.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
}
function candidateFolders(projectDir, cwd) {
  return [...new Set([projectDir, cwd].filter(isFolder))];
}
function nearestRepoFolder(dir) {
  let current = dir;
  for (; ; ) {
    if (import_node_fs5.default.existsSync(import_node_path5.default.join(current, ".git"))) return current;
    const parent = import_node_path5.default.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
function gateAgentsFor(pluginRoot, folders) {
  const roots = folders.length > 0 ? folders.map((folder) => nearestRepoFolder(folder) ?? folder) : [pluginRoot];
  return [...new Set(roots.flatMap((root) => readGateAgents(pluginRoot, root)))];
}
function logGateError(folders) {
  try {
    const top = folders.map(nearestRepoFolder).find((dir) => dir !== null);
    if (top === void 0) return;
    const ossDir = import_node_path5.default.join(top, ".oss");
    const logDir = import_node_path5.default.join(ossDir, "tool-gates");
    if ([ossDir, logDir].some((dir) => import_node_fs5.default.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink() === true)) return;
    import_node_fs5.default.mkdirSync(logDir, { recursive: true });
    if (!import_node_fs5.default.realpathSync(logDir).startsWith(`${import_node_fs5.default.realpathSync(top)}${import_node_path5.default.sep}`)) return;
    const event = { ts: (/* @__PURE__ */ new Date()).toISOString(), tool: "gate-run", kind: "gate-error", result: "allowed" };
    appendPrivateFile(import_node_path5.default.join(logDir, "events.ndjson"), `${JSON.stringify(event)}
`);
  } catch {
  }
}
function unverified(run, reason) {
  try {
    storeNotice(run.home, run.sessionId, run.agentId, { kind: "unverified", reason });
  } catch {
  }
  logGateError(run.folders);
  return say({ systemMessage: unverifiedMessage(reason) });
}
function repoTops(folders, budget) {
  gitBinary();
  const tops = /* @__PURE__ */ new Set();
  for (const folder of folders) {
    try {
      tops.add(git(folder, ["rev-parse", "--show-toplevel"], budget).trim());
    } catch (err) {
      if (err instanceof BudgetExceeded) throw err;
    }
  }
  return [...tops];
}
function snapFile(run) {
  return import_node_path5.default.join(sessionFolder(run.home, run.sessionId), `${run.agentId}.snap.json`);
}
function freshRunDir(run) {
  const dir = import_node_path5.default.join(sessionFolder(run.home, run.sessionId), `${run.agentId}.run`);
  import_node_fs5.default.rmSync(dir, { recursive: true, force: true });
  import_node_fs5.default.mkdirSync(dir, { mode: 448 });
  return dir;
}
function runDirOf(run) {
  return import_node_path5.default.join(sessionFolder(run.home, run.sessionId), `${run.agentId}.run`);
}
function reasonOf(err, otherwise) {
  return err instanceof BudgetExceeded ? REASONS.timeout : otherwise;
}
function parseRecord(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value;
  if (typeof record.unverified === "string" && Object.keys(record).length === 1) return { unverified: record.unverified };
  const { repos, user, startedAt } = record;
  if (!Array.isArray(repos) || repos.length === 0) return null;
  const valid = repos.every((repo) => {
    const entry = repo;
    return typeof entry?.top === "string" && import_node_path5.default.isAbsolute(entry.top) && isRepoPrint(entry.print);
  });
  if (!valid) return null;
  if (user === void 0 || startedAt === void 0) return "old";
  const userValid = typeof user === "object" && user !== null && !Array.isArray(user) && Object.values(user).every((v) => typeof v === "string");
  if (!userValid || typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return { repos, user, startedAt };
}
async function onStart(run) {
  sweepRunFolder(run.home, Date.now());
  let file;
  try {
    file = snapFile(run);
  } catch {
    return unverified(run, REASONS.recordsUnusable);
  }
  const { home, sessionId, agentId } = run;
  const started = hasMark(home, sessionId, agentId, "started");
  const done = hasMark(home, sessionId, agentId, "done");
  const replayed = hasMark(home, sessionId, agentId, "tamper") || import_node_fs5.default.lstatSync(file, { throwIfNoEntry: false }) !== void 0 || started && !done || !started && !done && wasSeen(home, sessionId, agentId);
  if (replayed) {
    mark(home, sessionId, agentId, "tamper");
    return unverified(run, REASONS.tampered);
  }
  clearMark(home, sessionId, agentId, "done");
  mark(home, sessionId, agentId, "started");
  markSeen(home, sessionId, agentId);
  let reason;
  const startedAt = Date.now();
  try {
    const tops = repoTops([...run.folders, ...reviewedReposFor(home, sessionId)], run.budget);
    if (tops.length > 0) {
      const ctx = { budget: run.budget, runDir: freshRunDir(run), home };
      const user = printUserFiles(home, sessionId, run.budget, { ...run.user, repos: tops });
      const repos = [];
      for (const top of tops) repos.push({ top, print: await printRepo(top, ctx) });
      writePrivateFile(file, JSON.stringify({ repos, user, startedAt }));
      return SILENT;
    }
    reason = REASONS.notARepo;
  } catch (err) {
    reason = reasonOf(err, REASONS.startFailed);
  }
  try {
    import_node_fs5.default.rmSync(runDirOf(run), { recursive: true, force: true });
    writePrivateFile(file, JSON.stringify({ unverified: reason }));
    mark(home, sessionId, agentId, "start-failed");
  } catch {
  }
  return unverified(run, reason);
}
async function compareAtStop(run, file) {
  const { home, sessionId, agentId } = run;
  if (hasMark(home, sessionId, agentId, "tamper")) return unverified(run, REASONS.tampered);
  let text;
  try {
    text = readPrivateFile(file);
  } catch {
    return unverified(run, REASONS.tampered);
  }
  if (text === null) return unverified(run, REASONS.noSnapshot);
  const record = parseRecord(text);
  if (record === null) return unverified(run, REASONS.tampered);
  if (record === "old") return unverified(run, REASONS.versionChanged);
  if ("unverified" in record) {
    const failed = hasMark(home, sessionId, agentId, "start-failed") && isKnownReason(record.unverified);
    return unverified(run, failed ? record.unverified : REASONS.tampered);
  }
  let changed;
  try {
    const runDir = runDirOf(run);
    import_node_fs5.default.mkdirSync(runDir, { recursive: true, mode: 448 });
    const ctx = { budget: run.budget, runDir, home };
    const several = record.repos.length > 1;
    changed = [];
    for (const { top, print: print2 } of record.repos) {
      for (const name of await changesSince(top, print2, ctx)) changed.push(several ? `[${top}] ${name}` : name);
    }
    const repos = record.repos.map(({ top }) => top);
    changed.push(...userChanges(record.user, printUserFiles(home, sessionId, run.budget, { ...run.user, repos })));
  } catch (err) {
    return unverified(run, reasonOf(err, REASONS.checkFailed));
  }
  if (changed.length === 0) return SILENT;
  try {
    storeNotice(home, sessionId, agentId, { kind: "void", files: changed.slice(0, MAX_STORED_PATHS), total: changed.length });
  } catch {
  }
  return say({ systemMessage: voidMessage(changed) });
}
async function onStop(run) {
  const { home, sessionId, agentId } = run;
  let file;
  try {
    file = snapFile(run);
  } catch {
    return unverified(run, REASONS.recordsUnusable);
  }
  if (hasMark(home, sessionId, agentId, "done")) return unverified(run, REASONS.tampered);
  try {
    return await compareAtStop(run, file);
  } finally {
    try {
      import_node_fs5.default.rmSync(file, { force: true });
      import_node_fs5.default.rmSync(runDirOf(run), { recursive: true, force: true });
      clearMark(home, sessionId, agentId, "start-failed");
      mark(home, sessionId, agentId, "done");
    } catch {
    }
  }
}
async function subagentEvent(req, hook, budget) {
  const agentType = hook.agent_type;
  if (typeof agentType !== "string" || agentType === "") return SILENT;
  const folders = candidateFolders(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
  if (!isGateAgent(agentType, gateAgentsFor(req.env.CLAUDE_PLUGIN_ROOT, folders))) return SILENT;
  const { session_id: sessionId, agent_id: agentId } = hook;
  if (!isSafeId(sessionId) || !isSafeId(agentId) || !import_node_path5.default.isAbsolute(req.env.HOME)) {
    logGateError(folders);
    return say({ systemMessage: unverifiedMessage(REASONS.badId) });
  }
  const user = {
    configDir: req.env.CLAUDE_CONFIG_DIR || void 0,
    pluginRoots: [req.env.CLAUDE_PLUGIN_ROOT, req.bundleRoot].filter((root) => typeof root === "string" && root !== ""),
    pathEnv: req.env.PATH
  };
  const run = { home: req.env.HOME, sessionId, agentId, folders, budget, user };
  return req.event === "subagent-start" ? onStart(run) : onStop(run);
}
function messagesOf(taken) {
  const messages = taken.notices.map(noticeMessage);
  if (taken.unreadable > 0) messages.push(unverifiedMessage(REASONS.noticeUnreadable));
  if (taken.unknown > 0) messages.push(unverifiedMessage(REASONS.unknownNotice));
  return messages;
}
function deliver(messages) {
  if (messages.length === 0) return SILENT;
  return say({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: messages.join("\n\n") } });
}
function onAgentPost(req, hook) {
  const home = req.env.HOME;
  const response = hook.tool_response ?? {};
  const sessionId = hook.session_id;
  if (sessionState(home, sessionId) === "unusable") {
    const agentType = hook.tool_input?.subagent_type;
    const folders = candidateFolders(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    const gate = typeof agentType === "string" && isGateAgent(agentType, gateAgentsFor(req.env.CLAUDE_PLUGIN_ROOT, folders));
    return gate ? deliver([unverifiedMessage(REASONS.recordsUnusable)]) : SILENT;
  }
  const messages = messagesOf(takeNotices(home, sessionId, response.agentId));
  const unfinished = response.status !== "async_launched" && hasMark(home, sessionId, response.agentId, "started") && !hasMark(home, sessionId, response.agentId, "done");
  if (unfinished) messages.push(unverifiedMessage(REASONS.stopUnfinished));
  return deliver(messages);
}
function onMainPost(home, hook) {
  if (hook.agent_id !== void 0) return SILENT;
  const sessionId = hook.session_id;
  if (isSafeId(sessionId) && sessionState(home, sessionId) === "unusable") return deliver([unverifiedMessage(REASONS.recordsUnusable)]);
  sweepRunFolder(home, Date.now());
  return deliver(messagesOf(takeNotices(home, sessionId)));
}
function refused2(why) {
  return { exitCode: 1, stdout: "", stderr: `OSS add-repo: ${why}
` };
}
function onAddRepo(req, budget) {
  const sessionId = req.env.CLAUDE_CODE_SESSION_ID;
  if (!isSafeId(sessionId) || !import_node_path5.default.isAbsolute(req.env.HOME)) return refused2("no usable session id (CLAUDE_CODE_SESSION_ID)");
  const request = import_node_path5.default.join(sessionFolder(req.env.HOME, sessionId), "repo-request.txt");
  const text = req.input !== "" ? req.input : takePrivateFile(request);
  if (text === null) return refused2(`write the repo's path to ${request} first`);
  const repo = text.replace(/\r?\n$/, "");
  if (!import_node_path5.default.isAbsolute(repo) || repo.includes("'") || /[\r\n]/.test(repo)) return refused2("the path must be one absolute path, with no ' in it");
  if (import_node_fs5.default.lstatSync(repo, { throwIfNoEntry: false })?.isDirectory() !== true) return refused2("the path is not a folder (or is a symlink)");
  const top = gitOrNull(repo, ["rev-parse", "--show-toplevel"], budget)?.trim();
  if (top === void 0 || top !== import_node_fs5.default.realpathSync(repo)) return refused2("the path is not a git repo's top folder");
  addReviewedRepo(req.env.HOME, sessionId, top);
  return { exitCode: 0, stdout: `OSS will check ${top} too in this session's review runs.
`, stderr: "" };
}
async function runGateRun(req) {
  const budget = { deadline: req.deadline ?? Date.now() + BUDGET_MS };
  if (req.event === "add-repo") {
    try {
      return onAddRepo(req, budget);
    } catch {
      return refused2("the request could not be read or recorded");
    }
  }
  let hook;
  try {
    const parsed = JSON.parse(req.input);
    if (typeof parsed !== "object" || parsed === null) throw new Error("hook input is not an object");
    hook = parsed;
  } catch {
    return say({ systemMessage: CHECK_FAILED });
  }
  try {
    switch (req.event) {
      case "agent-post":
        return onAgentPost(req, hook);
      case "main-post":
        return onMainPost(req.env.HOME, hook);
      default:
        return await subagentEvent(req, hook, budget);
    }
  } catch {
    logGateError(candidateFolders(req.env.CLAUDE_PROJECT_DIR, hook.cwd));
    return say({ systemMessage: CHECK_FAILED });
  }
}

// src/cli/gate-run.ts
var EVENTS = ["subagent-start", "subagent-stop", "agent-post", "main-post", "add-repo"];
var BUDGET_MS2 = 7e3;
function ownPluginRoot() {
  return typeof __dirname === "string" ? import_node_path6.default.resolve(__dirname, "..", "..", "..") : "";
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const deadline = Date.now() + BUDGET_MS2;
  const event = process.argv[2] ?? "";
  if (!EVENTS.includes(event)) {
    process.stderr.write("Usage: gate-run subagent-start|subagent-stop|agent-post|main-post < hook.json, or gate-run add-repo\n", () => process.exit(1));
    return;
  }
  const result = await runGateRun({
    event,
    input: await readStdin(),
    env: {
      HOME: process.env.HOME ?? "",
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || ownPluginRoot(),
      CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
      CLAUDE_CODE_SESSION_ID: process.env.CLAUDE_CODE_SESSION_ID,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      PATH: process.env.PATH
    },
    bundleRoot: ownPluginRoot() || void 0,
    deadline
  });
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout, () => process.exit(result.exitCode));
}
void main();
