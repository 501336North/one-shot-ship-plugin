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
var import_node_path5 = __toESM(require("node:path"), 1);

// src/gate-run/gate-run.ts
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);

// src/tool-gate/state-store.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);

// src/tool-gate/regular-file.ts
var import_node_fs = __toESM(require("node:fs"), 1);
function readRegularFile(absPath, maxBytes, noFollow = false) {
  const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = import_node_fs.default.constants;
  let fd;
  try {
    fd = import_node_fs.default.openSync(absPath, O_RDONLY | O_NONBLOCK | (noFollow ? O_NOFOLLOW : 0));
  } catch (error) {
    return error.code === "ENOENT" ? "missing" : "not-regular";
  }
  try {
    const stat = import_node_fs.default.fstatSync(fd);
    if (!stat.isFile() || stat.size >= maxBytes) return "not-regular";
    return { text: import_node_fs.default.readFileSync(fd, "utf8") };
  } catch {
    return "not-regular";
  } finally {
    import_node_fs.default.closeSync(fd);
  }
}

// src/tool-gate/state-store.ts
var MAX_CYCLE_BYTES = 1024 * 1024;
function isCycleRecord(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return (v.startedAt === null || typeof v.startedAt === "string") && (v.lastResult === "red" || v.lastResult === "green") && Array.isArray(v.files) && v.files.every((f) => typeof f === "string") && (v.adoptedCommand === null || typeof v.adoptedCommand === "string");
}
function fileStateStore(repoRoot) {
  const ossDir = import_node_path.default.join(repoRoot, ".oss");
  const stateDir = import_node_path.default.join(ossDir, "tool-gates");
  const cycleFile = import_node_path.default.join(stateDir, "cycle.json");
  const eventsFile = import_node_path.default.join(stateDir, "events.ndjson");
  const { O_APPEND, O_CREAT, O_EXCL, O_NOFOLLOW, O_WRONLY } = import_node_fs2.default.constants;
  function refuseSymlinkedDirs() {
    for (const dir of [ossDir, stateDir]) {
      if (import_node_fs2.default.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`tool-gate state: ${dir} is a symlink`);
      }
    }
  }
  function safeStateDir() {
    refuseSymlinkedDirs();
    import_node_fs2.default.mkdirSync(stateDir, { recursive: true });
    const real = import_node_fs2.default.realpathSync(stateDir);
    if (!real.startsWith(import_node_fs2.default.realpathSync(repoRoot) + import_node_path.default.sep)) {
      throw new Error(`tool-gate state: ${stateDir} resolves outside the repo`);
    }
  }
  return {
    readCycle() {
      try {
        refuseSymlinkedDirs();
        const read = readRegularFile(cycleFile, MAX_CYCLE_BYTES, true);
        if (typeof read !== "object") return null;
        const parsed = JSON.parse(read.text);
        return isCycleRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    writeCycle(cycle) {
      safeStateDir();
      const temp = `${cycleFile}.${process.pid}.tmp`;
      const fd = import_node_fs2.default.openSync(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW);
      try {
        import_node_fs2.default.writeFileSync(fd, JSON.stringify(cycle));
      } finally {
        import_node_fs2.default.closeSync(fd);
      }
      import_node_fs2.default.renameSync(temp, cycleFile);
    },
    appendEvent(event) {
      safeStateDir();
      const fd = import_node_fs2.default.openSync(eventsFile, O_APPEND | O_CREAT | O_WRONLY | O_NOFOLLOW);
      try {
        import_node_fs2.default.writeFileSync(fd, JSON.stringify(event) + "\n");
      } finally {
        import_node_fs2.default.closeSync(fd);
      }
    }
  };
}

// src/utils/gate-agents.ts
var path2 = __toESM(require("path"), 1);

// src/utils/regular-file.ts
var fs3 = __toESM(require("fs"), 1);
var FLAGS = fs3.constants.O_RDONLY | fs3.constants.O_NONBLOCK;
function notRegular(file) {
  return Object.assign(new Error(`ENOENT: not a regular file, open '${file}'`), { code: "ENOENT" });
}
function refused(st, owner) {
  return !st.isFile() || owner !== void 0 && st.uid !== owner;
}
function readRegularFileSync(file, owner) {
  if (!fs3.statSync(file).isFile()) {
    throw notRegular(file);
  }
  const fd = fs3.openSync(file, FLAGS);
  try {
    if (refused(fs3.fstatSync(fd), owner)) {
      throw notRegular(file);
    }
    return fs3.readFileSync(fd, "utf-8");
  } finally {
    fs3.closeSync(fd);
  }
}
function missing(err) {
  return err?.code === "ENOENT";
}
function readRegularFileSyncOrNull(file) {
  let st;
  try {
    st = fs3.statSync(file);
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
function readGateAgents(pluginRoot, repoRoot) {
  const base = namesIn(path2.join(pluginRoot, "config", "tool-gates.json"));
  if (base === null) throw new Error("plugin gateAgents is missing or invalid");
  return [.../* @__PURE__ */ new Set([...base, ...namesIn(path2.join(repoRoot, ".oss", "tool-gates.json")) ?? []])];
}

// src/gate-run/compare.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);

// src/gate-run/snapshot.ts
var import_node_child_process = require("node:child_process");
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);

// src/tool-gate/calling-agent.ts
function callingAgentOf(record) {
  const name = record.agent_type;
  return typeof name === "string" && name !== "" ? name : void 0;
}
function isGateAgent(agent, gateAgents) {
  if (agent === void 0) return false;
  const bare = agent.startsWith("oss:") ? agent.slice("oss:".length) : agent;
  return gateAgents.includes(bare);
}

// src/gate-run/snapshot.ts
var STATE_FOLDER = "oss-gate-run";
var SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
function gitEnv(extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith("GIT_")) env[name] = value;
  return { ...env, ...extra };
}
function git(cwd, args, extra) {
  return (0, import_node_child_process.execFileSync)("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    env: gitEnv(extra),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
}
function writeTree(top) {
  const scratch = import_node_fs3.default.mkdtempSync(import_node_path2.default.join(import_node_os.default.tmpdir(), "oss-gate-run-"));
  try {
    const index = { GIT_INDEX_FILE: import_node_path2.default.join(scratch, "index") };
    git(top, ["add", "-A"], index);
    return git(top, ["write-tree"], index);
  } finally {
    import_node_fs3.default.rmSync(scratch, { recursive: true, force: true });
  }
}
function stateFolderPath(top) {
  return import_node_path2.default.join(git(top, ["rev-parse", "--absolute-git-dir"]), STATE_FOLDER);
}
function writeStateFile(file, text) {
  const fd = import_node_fs3.default.openSync(
    file,
    import_node_fs3.default.constants.O_WRONLY | import_node_fs3.default.constants.O_CREAT | import_node_fs3.default.constants.O_TRUNC | import_node_fs3.default.constants.O_NOFOLLOW,
    384
  );
  try {
    import_node_fs3.default.writeSync(fd, text);
  } finally {
    import_node_fs3.default.closeSync(fd);
  }
}
function stateFolder(top) {
  const dir = stateFolderPath(top);
  try {
    import_node_fs3.default.mkdirSync(dir, { mode: 448 });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  if (!import_node_fs3.default.lstatSync(dir).isDirectory()) throw new Error("gate-run state folder is not a plain folder");
  return dir;
}
function snapshotOnStart(input, gateAgents) {
  if (!isGateAgent(callingAgentOf(input), gateAgents)) return null;
  const id = input.agent_id;
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error("agent_id is not a safe file name");
  const top = git(String(input.cwd), ["rev-parse", "--show-toplevel"]);
  const tree = writeTree(top);
  writeStateFile(import_node_path2.default.join(stateFolder(top), id), `${tree}
`);
  return tree;
}

// src/gate-run/compare.ts
var MAX_LISTED = 20;
function takeStateFile(top, name) {
  const dir = stateFolderPath(top);
  let folder;
  try {
    folder = import_node_fs4.default.lstatSync(dir);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  if (!folder.isDirectory()) throw new Error("gate-run state folder is not a plain folder");
  const file = import_node_path3.default.join(dir, name);
  let fd;
  try {
    fd = import_node_fs4.default.openSync(file, import_node_fs4.default.constants.O_RDONLY | import_node_fs4.default.constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return import_node_fs4.default.readFileSync(fd, "utf8");
  } finally {
    import_node_fs4.default.closeSync(fd);
    import_node_fs4.default.unlinkSync(file);
  }
}
function changedPaths(top, before, after) {
  const out = git(top, ["diff-tree", "-r", "-z", "--no-renames", "--name-only", before, after]);
  return out.split("\0").filter((name) => name !== "");
}
function compareOnStop(input) {
  try {
    const id = input.agent_id;
    if (typeof id !== "string" || !SAFE_ID.test(id)) return { kind: "none" };
    const top = git(String(input.cwd), ["rev-parse", "--show-toplevel"]);
    const before = takeStateFile(top, id);
    if (before === null) return { kind: "none" };
    const files = changedPaths(top, before.trim(), writeTree(top));
    if (files.length === 0) return { kind: "none" };
    writeStateFile(import_node_path3.default.join(stateFolderPath(top), `${id}.void`), JSON.stringify(files));
    return { kind: "void", files };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
function takePendingVoid(input) {
  const id = input.tool_response?.agentId;
  if (typeof id !== "string" || !SAFE_ID.test(id)) return null;
  const top = git(String(input.cwd), ["rev-parse", "--show-toplevel"]);
  const text = takeStateFile(top, `${id}.void`);
  return text === null ? null : JSON.parse(text);
}
function oneLine(file) {
  return file.replace(/[\u0000-\u001f\u007f]/g, "?");
}
function voidMessage(files) {
  const listed = files.slice(0, MAX_LISTED).map((file) => `- ${oneLine(file)}`);
  if (files.length > MAX_LISTED) listed.push(`- and ${files.length - MAX_LISTED} more`);
  return [
    "This review's report is void: the repo changed while the review ran, so it did not judge the code as it is now.",
    "Changed files:",
    ...listed,
    "Stop the ship and ask the user how to go on before acting on this review."
  ].join("\n");
}

// src/gate-run/gate-run.ts
var CHECK_FAILED = "OSS review check could not run, so this review run is unverified: the repo may have changed while it ran.";
var SILENT = { exitCode: 0, stdout: "", stderr: "" };
function say(output) {
  return { exitCode: 0, stdout: `${JSON.stringify(output)}
`, stderr: "" };
}
function folderOf(projectDir, cwd) {
  const usable = projectDir !== void 0 && import_node_path4.default.isAbsolute(projectDir) && import_node_fs5.default.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory() === true;
  return usable ? projectDir : String(cwd);
}
function logError(folder) {
  try {
    const top = git(folder, ["rev-parse", "--show-toplevel"]);
    fileStateStore(top).appendEvent({ ts: (/* @__PURE__ */ new Date()).toISOString(), tool: "gate-run", kind: "gate-error", result: "allowed" });
  } catch {
  }
}
function check(req, hook, folder) {
  const input = { ...hook, cwd: folder };
  switch (req.event) {
    case "subagent-start": {
      const gateAgents = readGateAgents(req.env.CLAUDE_PLUGIN_ROOT, git(folder, ["rev-parse", "--show-toplevel"]));
      snapshotOnStart(input, gateAgents);
      return SILENT;
    }
    case "subagent-stop": {
      const result = compareOnStop(input);
      if (result.kind === "error") throw new Error(result.error);
      return result.kind === "void" ? say({ systemMessage: voidMessage(result.files) }) : SILENT;
    }
    case "agent-post": {
      const files = takePendingVoid(input);
      if (files === null) return SILENT;
      return say({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: voidMessage(files) } });
    }
  }
}
async function runGateRun(req) {
  let folder = "";
  try {
    const hook = JSON.parse(req.input);
    folder = folderOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    return check(req, hook, folder);
  } catch {
    if (folder !== "") logError(folder);
    return say({ systemMessage: CHECK_FAILED });
  }
}

// src/cli/gate-run.ts
var EVENTS = ["subagent-start", "subagent-stop", "agent-post"];
function ownPluginRoot() {
  return typeof __dirname === "string" ? import_node_path5.default.resolve(__dirname, "..", "..", "..") : "";
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const event = process.argv[2] ?? "";
  if (!EVENTS.includes(event)) {
    process.stderr.write("Usage: gate-run subagent-start|subagent-stop|agent-post < hook.json\n", () => process.exit(1));
    return;
  }
  const result = await runGateRun({
    event,
    input: await readStdin(),
    env: {
      HOME: process.env.HOME ?? "",
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || ownPluginRoot(),
      CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR
    }
  });
  process.stdout.write(result.stdout, () => process.exit(result.exitCode));
}
void main();
