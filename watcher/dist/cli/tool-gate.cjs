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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cli/tool-gate.ts
var tool_gate_exports = {};
__export(tool_gate_exports, {
  runCli: () => runCli
});
module.exports = __toCommonJS(tool_gate_exports);

// src/tool-gate/gate.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path11 = __toESM(require("node:path"), 1);

// src/tool-gate/command-reader.ts
var import_node_path = __toESM(require("node:path"), 1);

// src/tool-gate/raw-path.ts
function joinRaw(base, p) {
  const segments = [];
  for (const segment of (p.startsWith("/") ? p : `${base}/${p}`).split("/")) {
    if (segment === "" || segment === "." || segment === ".." && segments.length === 0) continue;
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

// src/tool-gate/tokenize.ts
var CONTROL_OPERATORS = ["&&", "||", ";;", "|&", ";", "|", "&", "(", ")", "\n"];
var REDIRECT_OPERATORS = ["&>>", "<<<", "<<-", "&>", ">>", ">|", "<<", "<>", ">", "<"];
var ALL_OPERATORS = [...CONTROL_OPERATORS, ...REDIRECT_OPERATORS].sort((a, b) => b.length - a.length);
var HEREDOC_OPERATORS = ["<<", "<<-"];
var DOUBLE_QUOTE_ESCAPABLE = '$`"\\\n';
var Unreadable = class extends Error {
};
function tokenize(cmd) {
  try {
    return { tokens: scan(cmd) };
  } catch (err) {
    if (err instanceof Unreadable) return { unreadable: true, reason: err.message };
    throw err;
  }
}
function matchOperator(cmd, i) {
  return ALL_OPERATORS.find((op) => cmd.startsWith(op, i));
}
var ANSI_C_ESCAPES = {
  n: "\n",
  t: "	",
  r: "\r",
  a: "\x07",
  b: "\b",
  e: "\x1B",
  E: "\x1B",
  f: "\f",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "?": "?"
};
var ANSI_C_NUMERIC = {
  "0": { digits: /[0-7]{1,3}/y, radix: 8, skip: 1 },
  x: { digits: /[0-9A-Fa-f]{1,2}/y, radix: 16, skip: 2 },
  u: { digits: /[0-9A-Fa-f]{1,4}/y, radix: 16, skip: 2 },
  U: { digits: /[0-9A-Fa-f]{1,8}/y, radix: 16, skip: 2 }
};
for (const d of "1234567") ANSI_C_NUMERIC[d] = ANSI_C_NUMERIC["0"];
function readAnsiCQuote(cmd, start) {
  let text = "";
  let ended = false;
  let i = start;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "'") return { text, end: i + 1 };
    let decoded = c;
    let length = 1;
    if (c === "\\" && i + 1 < cmd.length) {
      const e = cmd[i + 1];
      const numeric = ANSI_C_NUMERIC[e];
      decoded = c + e;
      length = 2;
      if (e in ANSI_C_ESCAPES) {
        decoded = ANSI_C_ESCAPES[e];
      } else if (e === "c" && i + 2 < cmd.length) {
        decoded = String.fromCharCode(cmd[i + 2].toUpperCase().charCodeAt(0) ^ 64);
        length = 3;
      } else if (numeric !== void 0) {
        numeric.digits.lastIndex = i + numeric.skip;
        const digits = numeric.digits.exec(cmd)?.[0];
        if (digits !== void 0) {
          const codePoint = parseInt(digits, numeric.radix);
          if (codePoint > 1114111) throw new Unreadable(`escape \\${e}${digits} is not a character`);
          decoded = String.fromCodePoint(codePoint);
          length = numeric.skip + digits.length;
        }
      }
    }
    if (decoded === "\0") ended = true;
    if (!ended) text += decoded;
    i += length;
  }
  throw new Unreadable("unterminated $' quote");
}
function scan(cmd) {
  const tokens = [];
  const heredocs = [];
  let word = "";
  let inWord = false;
  let quote = "";
  let pendingRedirect = null;
  let pendingRedirectEnd = -1;
  const endWord = () => {
    if (!inWord) return;
    const value = word;
    word = "";
    inWord = false;
    if (pendingRedirect !== null) {
      if (HEREDOC_OPERATORS.includes(pendingRedirect)) {
        heredocs.push({ delimiter: value, stripTabs: pendingRedirect === "<<-" });
      }
      tokens.push({ kind: "redirect", op: pendingRedirect, target: value });
      pendingRedirect = null;
      return;
    }
    tokens.push({ kind: "word", value });
  };
  const skipHeredocBodies = (i2) => {
    for (const { delimiter, stripTabs } of heredocs) {
      while (i2 < cmd.length) {
        const end = cmd.indexOf("\n", i2);
        const lineEnd = end === -1 ? cmd.length : end;
        let line = cmd.slice(i2, lineEnd);
        if (stripTabs) line = line.replace(/^\t+/, "");
        i2 = lineEnd + 1;
        if (line === delimiter) break;
      }
    }
    heredocs.length = 0;
    return Math.min(i2, cmd.length);
  };
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    const next = cmd[i + 1];
    if (quote === "'") {
      if (c === "'") quote = "";
      else word += c;
      i++;
      continue;
    }
    if (quote === '"') {
      if (c === '"') {
        quote = "";
      } else if (c === "\\" && next !== void 0 && DOUBLE_QUOTE_ESCAPABLE.includes(next)) {
        if (next !== "\n") word += next;
        i++;
      } else if (c === "`" || c === "$" && next === "(") {
        throw new Unreadable("command substitution");
      } else {
        word += c;
      }
      i++;
      continue;
    }
    if (c === "$" && next === "'") {
      const { text, end } = readAnsiCQuote(cmd, i + 2);
      word += text;
      inWord = true;
      i = end;
      continue;
    }
    if (c === "$" && next === '"') {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      i++;
      continue;
    }
    if (c === "\\") {
      if (next === "\n") {
        i += 2;
      } else if (next === void 0) {
        word += c;
        inWord = true;
        i++;
      } else {
        word += next;
        inWord = true;
        i += 2;
      }
      continue;
    }
    if (c === "`" || c === "$" && next === "(") throw new Unreadable("command substitution");
    if ((c === "<" || c === ">") && next === "(") throw new Unreadable("process substitution");
    if (c === "#" && !inWord) {
      const end = cmd.indexOf("\n", i);
      i = end === -1 ? cmd.length : end;
      continue;
    }
    if (c === " " || c === "	") {
      endWord();
      i++;
      continue;
    }
    if (c === "&" && pendingRedirect !== null && !inWord && i === pendingRedirectEnd) {
      word = "&";
      inWord = true;
      i++;
      while (cmd[i] === " " || cmd[i] === "	") i++;
      continue;
    }
    const operator = matchOperator(cmd, i);
    if (operator === void 0) {
      word += c;
      inWord = true;
      i++;
      continue;
    }
    const isRedirect = REDIRECT_OPERATORS.includes(operator);
    let opText = operator;
    const fdPrefix = isRedirect && inWord && /^[0-9]+$/.test(word) && cmd.slice(i - word.length, i) === word;
    if (fdPrefix) {
      opText = word + operator;
      word = "";
      inWord = false;
    } else {
      endWord();
    }
    if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
    i += operator.length;
    if (isRedirect) {
      pendingRedirect = opText;
      pendingRedirectEnd = i;
      continue;
    }
    tokens.push({ kind: "op", value: operator });
    if (operator === "\n") i = skipHeredocBodies(i);
  }
  if (quote !== "") throw new Unreadable(`unterminated ${quote} quote`);
  endWord();
  if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
  return tokens;
}

// src/tool-gate/command-reader.ts
var WRAPPERS = /* @__PURE__ */ new Map([
  ["env", {
    values: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"],
    dir: ["-C", "--chdir"],
    split: ["-S", "--split-string"],
    assignments: true
  }],
  ["sudo", {
    values: [
      "-u",
      "--user",
      "-g",
      "--group",
      "-C",
      "--close-from",
      "-D",
      "--chdir",
      "-h",
      "--host",
      "-p",
      "--prompt",
      "-r",
      "--role",
      "-t",
      "--type",
      "-T",
      "--command-timeout",
      "-U",
      "--other-user"
    ],
    dir: ["-D", "--chdir"],
    assignments: true
  }],
  ["command", { values: [] }],
  ["builtin", { values: [] }],
  ["nice", { values: ["-n", "--adjustment"] }],
  ["nohup", { values: [] }],
  ["time", { values: ["-f", "--format", "-o", "--output"] }],
  ["xargs", { values: [
    "-a",
    "--arg-file",
    "-d",
    "--delimiter",
    "-E",
    "-I",
    "-L",
    "--max-lines",
    "-n",
    "--max-args",
    "-P",
    "--max-procs",
    "-s",
    "--max-chars"
  ] }],
  ["exec", { values: ["-a"] }],
  ["doas", { values: ["-u", "-C"] }],
  ["stdbuf", { values: ["-i", "--input", "-o", "--output", "-e", "--error"] }],
  ["timeout", { values: ["-s", "--signal", "-k", "--kill-after"], operands: 1 }]
]);
var SHELLS = /* @__PURE__ */ new Set(["bash", "sh", "zsh", "dash", "ksh"]);
var SHELL_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-o", "-O", "--rcfile", "--init-file"]);
var SHORT_OPTION_CLUSTER = /^[-+][A-Za-z]+$/;
var COMMAND_STRING_FLAG = /^-[A-Za-z]*c/;
var DYNAMIC_SCRIPT = /\$\(|`|\$[A-Za-z_{0-9@*#?!$-]/;
var MAX_NESTED_DEPTH = 5;
var PIPES = ["|", "|&"];
var KEYWORDS = /* @__PURE__ */ new Set(["if", "then", "elif", "else", "fi", "do", "done", "while", "until", "!"]);
var CD_PREFIXES = /* @__PURE__ */ new Set(["command", "builtin", "time"]);
var Unreadable2 = class extends Error {
};
var OUTPUT_REDIRECT = /^[0-9]*(?:>|>>|>\||<>)$|^&>>?$/;
var FD_DUPLICATION = /^&(?:[0-9]+-?|-)$/;
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
var URL_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;
var USER_AT_HOST = /^[^@/\s]+@([^:/\s]+)/;
var BARE_HOST = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?:\/|$)/;
var GIT_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
function readCommand(cmd, cwd, home) {
  try {
    return { parts: readScript(cmd, cwd, home, 0) };
  } catch (err) {
    if (err instanceof Unreadable2) return { unreadable: true, reason: err.message };
    throw err;
  }
}
function readScript(cmd, cwd, home, depth) {
  const result = tokenize(cmd);
  if ("unreadable" in result) throw new Unreadable2(result.reason);
  const segments = split(result.tokens, cwd, home);
  return segments.flatMap((segment) => toParts(segment, segments, home, depth));
}
function split(tokens, cwd, home) {
  const segments = [];
  const groups = [];
  const pushed = [];
  let header = null;
  let casePatterns = false;
  let caseDepth = 0;
  let closedGroupStart = null;
  let afterPipe = false;
  let dir = cwd;
  let words = [];
  let redirects = [];
  const atCommandStart = () => words.length === 0 && redirects.length === 0;
  const close = (next) => {
    if (atCommandStart()) return;
    const commandWords = stripAssignments(words);
    segments.push({ words: commandWords, redirects, cwd: dir, exits: [{ op: next, following: segments.length + 1 }] });
    const apart = afterPipe || isPipe(next) || next === "&";
    if (!apart) dir = dirAfter(commandWords, dir, pushed, home);
    words = [];
    redirects = [];
  };
  const readWord = (w) => {
    if (casePatterns) {
      if (w === "esac") {
        caseDepth--;
        casePatterns = false;
      }
    } else if (header === "case") {
      if (w === "in") {
        header = null;
        casePatterns = true;
      }
    } else if (header === "name") {
      header = null;
    } else if (header === "for") {
    } else if (!atCommandStart()) {
      words.push(w);
    } else if (w === "for" || w === "select") {
      header = "for";
    } else if (w === "case") {
      header = "case";
      caseDepth++;
    } else if (w === "esac") {
      caseDepth = Math.max(0, caseDepth - 1);
    } else if (w === "function") {
      header = "name";
    } else if (w === "{") {
      groups.push({ dir: null, start: segments.length });
    } else if (w === "}") {
      const group = groups.pop();
      if (group !== void 0) closedGroupStart = group.start;
    } else if (!KEYWORDS.has(w)) {
      words.push(w);
    }
  };
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token.kind === "word") readWord(token.value);
    else if (token.kind === "redirect") redirects.push({ op: token.op, target: token.target });
    else if (casePatterns || header === "case") {
      if (casePatterns && token.value === ")") casePatterns = false;
    } else if (token.value === "(" && isOp(tokens[k + 1], ")")) {
      words = [];
      k++;
    } else {
      if (header === "for") header = null;
      close(token.value);
      if (closedGroupStart !== null && token.value !== ")") {
        for (const inner of segments.slice(closedGroupStart)) inner.exits.push({ op: token.value, following: segments.length });
        closedGroupStart = null;
      }
      afterPipe = isPipe(token.value);
      if (token.value === "(") groups.push({ dir, start: segments.length });
      if (token.value === ")") {
        const group = groups.pop();
        if (group !== void 0) {
          dir = group.dir ?? dir;
          closedGroupStart = group.start;
        }
      }
      if (token.value === ";;" && caseDepth > 0) casePatterns = true;
    }
  }
  close(null);
  return segments;
}
function toParts(segment, segments, home, depth) {
  const { words, cwd } = unwrap(segment.words, segment.cwd, home);
  const program = words[0] ?? null;
  const name = program === null ? null : import_node_path.default.posix.basename(program);
  const args = words.slice(1);
  const git = name === "git" ? readGit(args, cwd, home) : null;
  const part = {
    words,
    program,
    cwd,
    writeTargets: [
      ...[...redirectWrites(segment), ...operandWrites(name, args)].map((p) => joinRaw(cwd, expandTilde(p, home))),
      ...git === null ? [] : gitWrites(git).map((p) => joinRaw(git.dir, expandTilde(p, home)))
    ],
    hosts: args.flatMap(hostOf),
    git,
    pipedOut: segment.exits.some((e) => isPipe(e.op)),
    orTrue: segment.exits.some((e) => e.op === "||" && isTrue(segments[e.following]?.words ?? []))
  };
  const script = scriptOf(name, args);
  if (script === null) return [part];
  if (DYNAMIC_SCRIPT.test(script)) throw new Unreadable2(`${name} runs a script that is not literal`);
  if (depth >= MAX_NESTED_DEPTH) throw new Unreadable2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  const nested = readScript(script, cwd, home, depth + 1);
  return [part, ...nested.map((p) => ({ ...p, pipedOut: p.pipedOut || part.pipedOut, orTrue: p.orTrue || part.orTrue }))];
}
function isOp(token, value) {
  return token?.kind === "op" && token.value === value;
}
function isPipe(op) {
  return op !== null && PIPES.includes(op);
}
function isTrue(words) {
  return words.length === 1 && (words[0] === "true" || words[0] === ":");
}
function nameOf(word) {
  return word === void 0 ? "" : import_node_path.default.posix.basename(word);
}
function unwrap(words, cwd, home) {
  let dir = cwd;
  let rest = words;
  for (let spec = WRAPPERS.get(nameOf(rest[0])); spec !== void 0; spec = WRAPPERS.get(nameOf(rest[0]))) {
    let split2 = [];
    let i = 1;
    for (; i < rest.length; i++) {
      const w = rest[i];
      if (w === "--") {
        i++;
        break;
      }
      if (spec.assignments === true && ASSIGNMENT.test(w)) continue;
      if (!w.startsWith("-") || w === "-") break;
      const long = w.startsWith("--");
      const eq = long ? w.indexOf("=") : -1;
      const at = long ? 0 : [...w.slice(1)].findIndex((l) => spec.values.includes(`-${l}`)) + 1;
      if (at === 0 && !long) continue;
      const flag = long ? eq === -1 ? w : w.slice(0, eq) : `-${w[at]}`;
      if (!spec.values.includes(flag)) continue;
      let value;
      if (eq !== -1) value = w.slice(eq + 1);
      else if (!long && w.length > at + 1) value = w.slice(at + 1);
      else value = rest[++i];
      if (value === void 0) break;
      if (spec.dir?.includes(flag)) dir = resolvePath(value, dir, home);
      if (spec.split?.includes(flag)) split2 = splitWords(value);
    }
    const next = [...split2, ...rest.slice(i + (spec.operands ?? 0))];
    if (next.length === 0) break;
    rest = next;
  }
  return { words: rest, cwd: dir };
}
function splitWords(value) {
  const result = tokenize(value);
  if ("unreadable" in result) throw new Unreadable2(result.reason);
  return result.tokens.flatMap((t) => t.kind === "word" ? [t.value] : []);
}
function scriptOf(name, args) {
  if (name === "eval") return args.length > 0 ? args.join(" ") : null;
  if (name === null || !SHELLS.has(name)) return null;
  let command = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SHELL_VALUE_OPTIONS.has(a)) i++;
    else if (a.startsWith("-") || a.startsWith("+")) {
      command ||= COMMAND_STRING_FLAG.test(a);
      if (SHORT_OPTION_CLUSTER.test(a)) i += [...a.slice(1)].filter((l) => SHELL_VALUE_OPTIONS.has(`-${l}`)).length;
    } else return command ? a : null;
  }
  return null;
}
function stripAssignments(words) {
  const first = words.findIndex((w) => !ASSIGNMENT.test(w));
  return first === -1 ? [] : words.slice(first);
}
function expandTilde(p, home) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return home + p.slice(1);
  return p;
}
function resolvePath(p, cwd, home) {
  return import_node_path.default.resolve(cwd, expandTilde(p, home));
}
function dirAfter(words, dir, pushed, home) {
  let p = 0;
  while (CD_PREFIXES.has(words[p])) p++;
  const [verb, ...args] = words.slice(p);
  if (verb === "cd") return cdTarget(args, dir, home);
  if (verb === "pushd" && args.length > 0) {
    pushed.push(dir);
    return cdTarget(args, dir, home);
  }
  if (verb === "popd") return pushed.pop() ?? dir;
  return dir;
}
function cdTarget(args, dir, home) {
  if (args.length === 0) return home;
  if (args.length > 1 || args[0] === "-") return dir;
  return resolvePath(args[0], dir, home);
}
function redirectWrites(segment) {
  return segment.redirects.filter((r) => OUTPUT_REDIRECT.test(r.op) && !FD_DUPLICATION.test(r.target)).map((r) => r.target.startsWith("&") ? r.target.slice(1) : r.target);
}
function operands(args, values = []) {
  const result = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return [...result, ...args.slice(i + 1)];
    if (!a.startsWith("-")) result.push(a);
    else if (a.startsWith("--")) {
      if (values.includes(a)) i++;
    } else {
      const at = [...a.slice(1)].findIndex((l) => values.includes(`-${l}`));
      if (at !== -1 && at === a.length - 2) i++;
    }
  }
  return result;
}
function destination(args, values = []) {
  const t = args.indexOf("-t");
  if (t !== -1 && t + 1 < args.length) return [args[t + 1]];
  return operands(args, values).slice(-1);
}
var TRUNCATE_VALUES = ["-s", "-r", "--size", "--reference"];
var LN_VALUES = ["-t", "-S", "--target-directory", "--suffix"];
var INSTALL_VALUES = ["-m", "-o", "-g", "-t", "-S", "--mode", "--owner", "--group", "--target-directory", "--suffix"];
var RESTORE_VALUES = ["-s", "--source", "--pathspec-from-file"];
function operandWrites(name, args) {
  switch (name) {
    case "rm":
    case "mv":
    case "tee":
    case "touch":
      return operands(args);
    case "cp":
      return destination(args);
    case "ln":
      return destination(args, LN_VALUES);
    case "install":
      return destination(args, INSTALL_VALUES);
    case "truncate":
      return operands(args, TRUNCATE_VALUES);
    case "chmod":
    case "chown":
      return operands(args).slice(1);
    case "dd":
      return args.filter((a) => a.startsWith("of=")).map((a) => a.slice("of=".length));
    case "sed":
      return inPlaceFiles(args, SED);
    case "perl":
      return inPlaceFiles(args, PERL);
    default:
      return [];
  }
}
var SED = {
  inPlaceLong: ["--in-place"],
  script: ["-e", "-f", "--expression", "--file"],
  values: ["-l", "--line-length"],
  attached: []
};
var PERL = { inPlaceLong: [], script: ["-e", "-E"], values: [], attached: ["-I", "-M", "-m", "-F", "-C", "-d", "-x"] };
function inPlaceFiles(args, spec) {
  let inPlace = false;
  let scriptGiven = false;
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      words.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith("-") || a === "-") {
      if (a !== "") words.push(a);
    } else if (a.startsWith("--")) {
      const flag = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
      if (spec.inPlaceLong.includes(flag)) inPlace = true;
      if (spec.script.includes(flag)) scriptGiven = true;
      if (!a.includes("=") && (spec.script.includes(flag) || spec.values.includes(flag))) i++;
    } else {
      for (let j = 1; j < a.length; j++) {
        const flag = `-${a[j]}`;
        if (flag === "-i") inPlace = true;
        if (spec.script.includes(flag)) scriptGiven = true;
        const takesNext = spec.script.includes(flag) || spec.values.includes(flag);
        if (takesNext && j === a.length - 1) i++;
        if (flag === "-i" || takesNext || spec.attached.includes(flag)) break;
      }
    }
  }
  if (!inPlace) return [];
  return scriptGiven ? words : words.slice(1);
}
function gitWrites(git) {
  if (git.subcommand === "checkout") {
    const end = git.args.indexOf("--");
    return end === -1 ? [] : git.args.slice(end + 1);
  }
  if (git.subcommand === "restore") return operands(git.args, RESTORE_VALUES);
  return [];
}
function hostOf(arg) {
  const value = arg.startsWith("-") && arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : arg;
  const url = URL_AUTHORITY.exec(value);
  let host;
  if (url) host = url[1].slice(url[1].lastIndexOf("@") + 1).replace(/:[0-9]*$/, "");
  else host = USER_AT_HOST.exec(value)?.[1] ?? (value.startsWith("-") ? void 0 : BARE_HOST.exec(value)?.[1]);
  return host ? [host.toLowerCase()] : [];
}
function readGit(args, cwd, home) {
  let dir = cwd;
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    if (args[i] === "-C" && i + 1 < args.length) dir = resolvePath(args[i + 1], dir, home);
    i += GIT_VALUE_OPTIONS.has(args[i]) ? 2 : 1;
  }
  if (i >= args.length) return null;
  return { subcommand: args[i], args: args.slice(i + 1), dir };
}

// src/tool-gate/edit-call.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function resolvePath2(filePath, cwd, home) {
  return filePath.startsWith("~/") ? joinRaw(home, filePath.slice(2)) : joinRaw(cwd, filePath);
}
function readChange(edit) {
  if (!isRecord(edit) || typeof edit.old_string !== "string" || typeof edit.new_string !== "string") return null;
  return { before: edit.old_string, after: edit.new_string };
}
function readChanges(tool, input, absPath, readFile) {
  switch (tool) {
    case "Edit": {
      const change = readChange(input);
      return change === null ? null : [change];
    }
    case "MultiEdit": {
      if (!Array.isArray(input.edits)) return null;
      const changes = input.edits.map(readChange);
      return changes.every((change) => change !== null) ? changes : null;
    }
    case "Write":
      if (typeof input.content !== "string") return null;
      return [{ before: readFile(absPath) ?? "", after: input.content }];
    case "NotebookEdit":
      if (typeof input.new_source !== "string") return null;
      return [{ before: "", after: input.edit_mode === "delete" ? "" : input.new_source }];
  }
}
var PATH_FIELD = {
  Edit: "file_path",
  MultiEdit: "file_path",
  Write: "file_path",
  NotebookEdit: "notebook_path"
};
function isEditTool(toolName) {
  return Object.hasOwn(PATH_FIELD, toolName);
}
function readEditCall(toolName, toolInput, cwd, home, readFile) {
  if (!isEditTool(toolName) || !isRecord(toolInput)) return null;
  const rawPath = toolInput[PATH_FIELD[toolName]];
  if (typeof rawPath !== "string") return null;
  const filePath = resolvePath2(rawPath, cwd, home);
  const changes = readChanges(toolName, toolInput, filePath, readFile);
  return changes === null ? null : { tool: toolName, filePath, changes };
}

// src/tool-gate/git-reader.ts
var import_node_child_process = require("node:child_process");
var realGitReader = {
  currentBranch(dir) {
    return new Promise((resolve2) => {
      (0, import_node_child_process.execFile)("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd: dir, timeout: 1500, encoding: "utf8" }, (error, stdout) => {
        const out = error ? "" : stdout.trim();
        resolve2(out === "" ? null : out);
      });
    });
  }
};

// src/tool-gate/path-resolver.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var MAX_LINKS = 40;
function names(p) {
  return p.split("/").filter((name) => name !== "" && name !== ".");
}
function resolve(absPath) {
  let resolved = "/";
  let links = 0;
  const todo = names(absPath);
  for (let name = todo.shift(); name !== void 0; name = todo.shift()) {
    if (name === "..") {
      resolved = import_node_path2.default.dirname(resolved);
      continue;
    }
    const next = import_node_path2.default.join(resolved, name);
    let target = null;
    try {
      target = import_node_fs.default.readlinkSync(next);
    } catch {
    }
    if (target === null) {
      resolved = next;
      continue;
    }
    if (++links > MAX_LINKS) return null;
    if (target.startsWith("/")) resolved = "/";
    todo.unshift(...names(target));
  }
  return resolved;
}
var realPathResolver = {
  realpath(absPath) {
    return resolve(absPath) ?? absPath;
  }
};

// src/tool-gate/recorder.ts
var import_node_path5 = __toESM(require("node:path"), 1);

// src/tool-gate/patterns.ts
var import_node_path3 = __toESM(require("node:path"), 1);
var REGEX_CHARS = /[.+^${}()|[\]\\]/g;
var GLOB_TOKENS = new RegExp(`\\*\\*/|/\\*\\*$|\\*|\\?|${REGEX_CHARS.source}`, "g");
function escape(text) {
  return text.replace(REGEX_CHARS, "\\$&");
}
function globToRegex(glob) {
  const source = glob.replace(GLOB_TOKENS, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "/**") return "/.+";
    if (token === "*") return "[^/]*";
    if (token === "?") return "[^/]";
    return escape(token);
  });
  return new RegExp(`^${source}$`);
}
function matchPath(glob, absPath, opts) {
  let full;
  if (glob.startsWith("~/")) full = import_node_path3.default.join(opts.home, glob.slice(2));
  else if (glob.startsWith("**/") || import_node_path3.default.isAbsolute(glob)) full = import_node_path3.default.normalize(glob);
  else full = import_node_path3.default.join(opts.root, glob);
  return globToRegex(full).test(import_node_path3.default.normalize(absPath));
}
function wordMatches(patternWord, word) {
  const source = patternWord.split("*").map(escape).join(".*");
  return new RegExp(`^${source}$`).test(word);
}
function matchCommand(pattern, words) {
  const patternWords = pattern.split(" ");
  return words.length >= patternWords.length && patternWords.every((patternWord, i) => wordMatches(patternWord, words[i] ?? ""));
}

// src/tool-gate/workflow-state.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
var BUILD_COMMAND = "build";
function fileWorkflowState(projectDir) {
  return {
    read() {
      let text;
      try {
        text = import_node_fs2.default.readFileSync(import_node_path4.default.join(projectDir, ".oss", "workflow-state.json"), "utf8");
      } catch {
        return null;
      }
      const data = JSON.parse(text);
      const record2 = typeof data === "object" && data !== null ? data : {};
      return {
        currentCommand: typeof record2.currentCommand === "string" ? record2.currentCommand : null,
        currentCommandStartedAt: typeof record2.currentCommandStartedAt === "string" ? record2.currentCommandStartedAt : null
      };
    }
  };
}

// src/tool-gate/recorder.ts
var EXIT_CODE = /^Exit code \d+/;
var TEST_WORDS = /* @__PURE__ */ new Set(["test", "tests", "spec", "specs", "check", "checks"]);
var NEVER_ADOPTED = /* @__PURE__ */ new Set(["test", "[", "[[", "grep", "egrep", "fgrep", "rg", "git", "find", "echo", "printf", "ls", "cat"]);
function isTestLike(part, settings, root, home) {
  return part.words.some(
    (word) => word.toLowerCase().split(/[^a-z0-9]+/).some((piece) => TEST_WORDS.has(piece)) || settings.testFilePatterns.some((glob) => matchPath(glob, import_node_path5.default.resolve(part.cwd, word), { home, root }))
  );
}
function recordTestRun(call, ctx) {
  const facts = readCommand(call.command, call.cwd, ctx.home);
  if ("unreadable" in facts) return;
  const previous = ctx.store.readCycle();
  const thisBuild = previous !== null && previous.startedAt === ctx.buildStartedAt ? previous : { files: [], adoptedCommand: null };
  const patterns = thisBuild.adoptedCommand === null ? ctx.settings.testCommandPatterns : [...ctx.settings.testCommandPatterns, thisBuild.adoptedCommand];
  let testParts = facts.parts.filter((part) => patterns.some((pattern) => matchCommand(pattern, part.words)));
  const last = facts.parts[facts.parts.length - 1];
  const failedWithExitCode = call.hookEvent === "PostToolUseFailure" && EXIT_CODE.test(call.error ?? "");
  let adoptedCommand = thisBuild.adoptedCommand;
  if (testParts.length === 0) {
    if (ctx.currentCommand !== BUILD_COMMAND || thisBuild.adoptedCommand !== null || !failedWithExitCode || call.isInterrupt === true || last === void 0 || NEVER_ADOPTED.has(import_node_path5.default.basename(last.program ?? "")) || facts.parts.some((part) => part.pipedOut || part.orTrue) || !isTestLike(last, ctx.settings, ctx.root ?? call.cwd, ctx.home)) {
      return;
    }
    adoptedCommand = last.words.join(" ");
    testParts = [last];
    ctx.store.appendEvent({ ts: ctx.ts, tool: "Bash", kind: "runner-adopted", command: call.command, result: "red" });
  }
  const hidden = call.isInterrupt === true || testParts.some((part) => part.pipedOut || part.orTrue);
  const result = hidden ? "unknown" : call.hookEvent === "PostToolUse" ? "green" : failedWithExitCode && last !== void 0 && testParts.includes(last) ? "red" : "unknown";
  ctx.store.appendEvent({ ts: ctx.ts, tool: "Bash", kind: "test-run", command: call.command, result });
  if (result === "unknown") return;
  ctx.store.writeCycle({
    startedAt: ctx.buildStartedAt,
    lastResult: result,
    files: result === "red" ? [] : thisBuild.files,
    adoptedCommand
  });
}

// src/tool-gate/rule-file.ts
var import_node_path6 = __toESM(require("node:path"), 1);
var LIST_KEYS = [
  "protectedBranches",
  "testFilePatterns",
  "testCommandPatterns",
  "sourceExtensions",
  "protectedPaths",
  "productionHosts"
];
var KNOWN_KEYS = /* @__PURE__ */ new Set(["version", "tagsAllowed", ...LIST_KEYS]);
var MAX_REPO_BYTES = 64 * 1024;
function parse(text, requireAll) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, reason: "not a JSON object" };
  }
  const record2 = data;
  const keys = Object.keys(record2);
  if (keys.some((key) => !KNOWN_KEYS.has(key))) return { ok: false, reason: "has an unknown key" };
  if (record2.version !== 1) return { ok: false, reason: "version must be 1" };
  const value = { version: 1 };
  if ("tagsAllowed" in record2) {
    if (typeof record2.tagsAllowed !== "boolean") return { ok: false, reason: "tagsAllowed must be true or false" };
    value.tagsAllowed = record2.tagsAllowed;
  } else if (requireAll) {
    return { ok: false, reason: "tagsAllowed is missing" };
  }
  for (const key of LIST_KEYS) {
    if (!(key in record2)) {
      if (requireAll) return { ok: false, reason: `${key} is missing` };
      continue;
    }
    const list = record2[key];
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string" && item.length > 0)) {
      return { ok: false, reason: `${key} must be a list of non-empty strings` };
    }
    value[key] = list;
  }
  return { ok: true, value };
}
function merge(base, repo) {
  const merged = { ...base };
  for (const key of LIST_KEYS) {
    const added = repo[key];
    if (added === void 0) continue;
    if (!base[key].every((value) => added.includes(value))) return `${key} drops a base value`;
    merged[key] = [.../* @__PURE__ */ new Set([...base[key], ...added])];
  }
  if (repo.tagsAllowed === true && !base.tagsAllowed) return "tagsAllowed true loosens the base false";
  if (repo.tagsAllowed === false) merged.tagsAllowed = false;
  return merged;
}
function loadSettings(readFile, pluginRoot, repoRoot) {
  const baseText = readFile(import_node_path6.default.join(pluginRoot, "config", "tool-gates.json"));
  if (baseText === null) throw new Error("tool-gate base settings file is missing");
  const baseParsed = parse(baseText, true);
  if (!baseParsed.ok) throw new Error(`tool-gate base settings file is invalid: ${baseParsed.reason}`);
  const base = baseParsed.value;
  const repoText = readFile(import_node_path6.default.join(repoRoot, ".oss", "tool-gates.json"));
  if (repoText === null) return { settings: base };
  const reject = (reason) => ({
    settings: base,
    rejected: `.oss/tool-gates.json ignored: ${reason}`
  });
  if (Buffer.byteLength(repoText, "utf8") > MAX_REPO_BYTES) return reject("larger than 64 KB");
  const repoParsed = parse(repoText, false);
  if (!repoParsed.ok) return reject(repoParsed.reason);
  const merged = merge(base, repoParsed.value);
  if (typeof merged === "string") return reject(merged);
  return { settings: merged };
}

// src/tool-gate/rules/focused-tests.ts
var import_node_path7 = __toESM(require("node:path"), 1);
var MARKER = /\.(skip|only|todo)(If)?\s*\(/g;
function countMarkers(text) {
  const counts = /* @__PURE__ */ new Map();
  for (const match of text.matchAll(MARKER)) {
    const name = match[1] + (match[2] ?? "");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}
function addedMarker(before, after) {
  const old = countMarkers(before);
  for (const [name, count] of countMarkers(after)) {
    if (count > (old.get(name) ?? 0)) return name;
  }
  return void 0;
}
function displayPath(filePath, root) {
  const relative = import_node_path7.default.relative(root, filePath);
  return relative === ".." || relative.startsWith(`..${import_node_path7.default.sep}`) || import_node_path7.default.isAbsolute(relative) ? filePath : relative;
}
function checkFocusedTests(call, settings, root, home) {
  if (!settings.testFilePatterns.some((glob) => matchPath(glob, call.filePath, { home, root }))) return null;
  for (const { before, after } of call.changes) {
    const marker = addedMarker(before, after);
    if (marker !== void 0) {
      return {
        rule: "focused-tests",
        reason: `Refused: adds \`.${marker}(\` to the test file \`${displayPath(call.filePath, root)}\`. IRON LAW #1: never skip or focus tests. Fix or delete the test instead.`
      };
    }
  }
  return null;
}

// src/tool-gate/rules/push-words.ts
var PUSH_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]);
var PUSH_LONG_OPTIONS = [
  "--all",
  "--branches",
  "--mirror",
  "--delete",
  "--tags",
  "--dry-run",
  "--porcelain",
  "--force",
  "--force-with-lease",
  "--force-if-includes",
  "--recurse-submodules",
  "--thin",
  "--no-thin",
  "--receive-pack",
  "--exec",
  "--repo",
  "--set-upstream",
  "--follow-tags",
  "--signed",
  "--atomic",
  "--push-option",
  "--ipv4",
  "--ipv6",
  "--no-verify",
  "--verify",
  "--progress",
  "--quiet",
  "--verbose",
  "--prune",
  "--no-force-with-lease",
  "--no-signed"
];
function fullOption(word) {
  if (!word.startsWith("--")) return word;
  const eq = word.indexOf("=");
  const name = eq === -1 ? word : word.slice(0, eq);
  const matches = PUSH_LONG_OPTIONS.filter((option) => option.startsWith(name));
  const shortest = matches.find((option) => matches.every((other) => other.startsWith(option)));
  if (shortest === void 0) return word;
  return eq === -1 ? shortest : shortest + word.slice(eq);
}
function readPushWords(args) {
  const options = [];
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const word = fullOption(args[i]);
    if (PUSH_VALUE_OPTIONS.has(word)) i++;
    else if (word.startsWith("-")) options.push(word);
    else positional.push(word);
  }
  return { options, positional };
}

// src/tool-gate/rules/force-push.ts
var SHORT_FORCE = /^-[A-Za-z]*f[A-Za-z]*$/;
function isForce(option) {
  return option === "--force" || option.startsWith("--force-") || SHORT_FORCE.test(option);
}
function checkForcePush(part, _settings) {
  if (part.git?.subcommand !== "push") return null;
  const { options, positional } = readPushWords(part.git.args);
  const found = options.find(isForce) ?? positional.find((word) => word.startsWith("+"));
  if (found === void 0) return null;
  return {
    rule: "force-push",
    reason: `Refused: \`git push ${found}\` rewrites history. Push without force; if the branch diverged, ask the user.`
  };
}

// src/tool-gate/rules/production-host.ts
function normalise(host) {
  const lower = host.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}
function checkProductionHost(part, settings) {
  const listed = new Set(settings.productionHosts.map(normalise));
  const host = part.hosts.map(normalise).find((h) => listed.has(h));
  if (host === void 0) return null;
  return {
    rule: "production-host",
    reason: `Refused: \`${part.program}\` to \`${host}\`, a production host listed in .oss/tool-gates.json. Use a staging or mock endpoint.`
  };
}

// src/tool-gate/rules/protected-branch.ts
function destination2(refspec) {
  const spec = refspec.startsWith("+") ? refspec.slice(1) : refspec;
  const colon = spec.indexOf(":");
  const dst = colon === -1 ? spec : spec.slice(colon + 1);
  return dst.startsWith("refs/heads/") ? dst.slice("refs/heads/".length) : dst;
}
async function checkProtectedBranch(part, settings, git) {
  const facts = part.git;
  if (!facts || facts.subcommand !== "commit" && facts.subcommand !== "push") return null;
  const command = `git ${facts.subcommand}`;
  const protectedList = settings.protectedBranches;
  const branch = await git.currentBranch(facts.dir);
  if (branch !== null && protectedList.includes(branch)) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`${command}\` while on \`${branch}\`, a protected branch. Use a feature branch.`
    };
  }
  if (facts.subcommand !== "push") return null;
  const { options, positional } = readPushWords(facts.args);
  const everything = options.find((word) => word === "--all" || word === "--branches" || word === "--mirror");
  if (everything !== void 0) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`${command} ${everything}\` can push protected branches (${protectedList.map((b) => `\`${b}\``).join(", ")}). Push one feature branch instead.`
    };
  }
  const target = positional.slice(1).map(destination2).find((dst) => protectedList.includes(dst));
  if (target === void 0) return null;
  return {
    rule: "protected-branch",
    reason: `Refused: \`${command}\` to \`${target}\`, a protected branch. Push a feature branch and open a PR.`
  };
}

// src/tool-gate/rules/protected-path.ts
var import_node_path8 = __toESM(require("node:path"), 1);
var HOME_PREFIX = "~/";
var WILDCARD = /[*?]/;
function placesOf(root, home, paths) {
  return [
    { home, root },
    { home: paths.realpath(home), root: paths.realpath(root) }
  ];
}
function formsOf(absPath, paths) {
  return [import_node_path8.default.normalize(absPath), paths.realpath(absPath)];
}
function isProtected(absPath, settings, places, paths) {
  return formsOf(absPath, paths).some(
    (p) => places.some((at) => settings.protectedPaths.some((glob) => matchPath(glob, p, at)))
  );
}
function fixedFolder(glob, at) {
  let full;
  if (glob.startsWith(HOME_PREFIX)) full = import_node_path8.default.join(at.home, glob.slice(HOME_PREFIX.length));
  else if (import_node_path8.default.isAbsolute(glob)) full = import_node_path8.default.normalize(glob);
  else full = import_node_path8.default.join(at.root, glob);
  const segments = full.split(import_node_path8.default.sep);
  const first = segments.findIndex((segment) => WILDCARD.test(segment));
  return first === -1 ? full : segments.slice(0, first).join(import_node_path8.default.sep) || import_node_path8.default.sep;
}
function isSameOrAncestor(dir, of) {
  const relative = import_node_path8.default.relative(dir, of);
  return relative !== ".." && !relative.startsWith(`..${import_node_path8.default.sep}`) && !import_node_path8.default.isAbsolute(relative);
}
function holdsProtected(absPath, settings, places, paths) {
  return formsOf(absPath, paths).some(
    (p) => places.some(
      (at) => settings.protectedPaths.some((glob) => isSameOrAncestor(p, fixedFolder(glob, at)))
    )
  );
}
function displayPath2(absPath, root, home) {
  if (absPath === root) return ".";
  if (absPath.startsWith(`${root}/`)) return absPath.slice(root.length + 1);
  if (absPath.startsWith(`${home}/`)) return HOME_PREFIX + absPath.slice(home.length + 1);
  return absPath;
}
function refusal(absPath, what, root, home) {
  return {
    rule: "protected-path",
    reason: `Refused: writes \`${displayPath2(absPath, root, home)}\`, ${what}. Ask the user to change it with \`!\`.`
  };
}
function checkProtectedPathEdit(call, settings, root, home, paths) {
  if (!isProtected(call.filePath, settings, placesOf(root, home, paths), paths)) return null;
  return refusal(call.filePath, "a protected file", root, home);
}
function checkProtectedPathBash(part, settings, root, home, paths) {
  const places = placesOf(root, home, paths);
  for (const target of part.writeTargets) {
    if (isProtected(target, settings, places, paths)) return refusal(target, "a protected file", root, home);
    if (holdsProtected(target, settings, places, paths)) {
      return refusal(target, "which holds protected files", root, home);
    }
  }
  return null;
}

// src/tool-gate/rules/red-cycle.ts
var import_node_path9 = __toESM(require("node:path"), 1);
var NO_RUN = "Refused: No failing test recorded. Write a failing test and run it. If your tests run with a command the gate doesn't recognize, ask the user to add it to .oss/tool-gates.json with `!`.";
var DEV_DOCS = ".oss/dev/**";
function isSourceFile(filePath, settings, root, home) {
  return settings.sourceExtensions.includes(import_node_path9.default.extname(filePath)) && !matchPath(DEV_DOCS, filePath, { home, root }) && !settings.testFilePatterns.some((glob) => matchPath(glob, filePath, { home, root }));
}
function checkRedCycle(call, settings, root, home, workflow, store) {
  const state = workflow.read();
  if (state === null || state.currentCommand !== BUILD_COMMAND) return null;
  if (!isSourceFile(call.filePath, settings, root, home)) return null;
  const cycle = store.readCycle();
  if (cycle === null || cycle.startedAt !== state.currentCommandStartedAt) {
    return { rule: "red-cycle", reason: NO_RUN };
  }
  if (cycle.files.includes(call.filePath)) return null;
  if (cycle.lastResult === "green") {
    return {
      rule: "red-cycle",
      reason: `Refused: \`${import_node_path9.default.relative(root, call.filePath)}\` is not in this cycle and the last test run was green. Write a failing test and run it before editing a new source file.`
    };
  }
  store.writeCycle({ ...cycle, files: [...cycle.files, call.filePath] });
  return null;
}

// src/tool-gate/rules/tags.ts
var TAG_VALUE_LONG = [
  "--local-user",
  "--message",
  "--file",
  "--contains",
  "--no-contains",
  "--points-at",
  "--merged",
  "--no-merged",
  "--sort",
  "--format",
  "--cleanup",
  "--trailer"
];
var TAG_VALUE_SHORT = /* @__PURE__ */ new Set(["m", "F", "u"]);
var TAG_CHANGE_LONG = /* @__PURE__ */ new Set(["--annotate", "--sign", "--local-user", "--force", "--delete", "--message", "--file"]);
var TAG_CHANGE_SHORT = /* @__PURE__ */ new Set(["a", "s", "u", "f", "d", "m", "F"]);
var TAG_READ_LONG = /* @__PURE__ */ new Set(["--list", "--verify"]);
var TAG_READ_SHORT = /* @__PURE__ */ new Set(["l", "v"]);
var PUSH_TAG_OPTIONS = /* @__PURE__ */ new Set(["--tags", "--follow-tags", "--mirror"]);
var TAGS_REF = "refs/tags/";
function changesTag(args) {
  let reads = false;
  let changes = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (word.startsWith("--")) {
      const name = word.split("=")[0];
      if (TAG_READ_LONG.has(name)) reads = true;
      if (TAG_CHANGE_LONG.has(name)) changes = true;
      if (!word.includes("=") && name.length > 2 && TAG_VALUE_LONG.some((option) => option.startsWith(name))) i++;
    } else if (word.startsWith("-") && word.length > 1) {
      for (let c = 1; c < word.length; c++) {
        const letter = word[c];
        if (TAG_READ_SHORT.has(letter)) reads = true;
        if (TAG_CHANGE_SHORT.has(letter)) changes = true;
        if (TAG_VALUE_SHORT.has(letter)) {
          if (c === word.length - 1) i++;
          break;
        }
      }
    } else {
      changes = true;
    }
  }
  return changes && !reads;
}
function pushedTags(args) {
  const { options, positional } = readPushWords(args);
  const option = options.find((word) => PUSH_TAG_OPTIONS.has(word));
  if (option !== void 0) return option;
  const refspecs = positional.slice(1);
  const tagWord = refspecs.indexOf("tag");
  if (tagWord !== -1 && tagWord + 1 < refspecs.length) return `tag ${refspecs[tagWord + 1]}`;
  return refspecs.find((spec) => spec.slice(spec.indexOf(":") + 1).replace(/^\+/, "").startsWith(TAGS_REF));
}
function refuse(what) {
  return {
    rule: "tags",
    reason: `Refused: \`${what}\`: this repo doesn't use tags (tagsAllowed is false in .oss/tool-gates.json).`
  };
}
function checkTags(part, settings) {
  if (settings.tagsAllowed || part.git === null) return null;
  const { subcommand, args } = part.git;
  if (subcommand === "tag") {
    return changesTag(args) ? refuse(["git tag", ...args].join(" ")) : null;
  }
  if (subcommand === "push") {
    const found = pushedTags(args);
    return found === void 0 ? null : refuse(`git push ${found}`);
  }
  return null;
}

// src/tool-gate/state-store.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path10 = __toESM(require("node:path"), 1);
function isCycleRecord(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return (v.startedAt === null || typeof v.startedAt === "string") && (v.lastResult === "red" || v.lastResult === "green") && Array.isArray(v.files) && v.files.every((f) => typeof f === "string") && (v.adoptedCommand === null || typeof v.adoptedCommand === "string");
}
function fileStateStore(repoRoot) {
  const ossDir = import_node_path10.default.join(repoRoot, ".oss");
  const stateDir = import_node_path10.default.join(ossDir, "tool-gates");
  const cycleFile = import_node_path10.default.join(stateDir, "cycle.json");
  const eventsFile = import_node_path10.default.join(stateDir, "events.ndjson");
  const { O_APPEND, O_CREAT, O_EXCL, O_NOFOLLOW, O_RDONLY, O_WRONLY } = import_node_fs3.default.constants;
  function refuseSymlinkedDirs() {
    for (const dir of [ossDir, stateDir]) {
      if (import_node_fs3.default.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`tool-gate state: ${dir} is a symlink`);
      }
    }
  }
  function safeStateDir() {
    refuseSymlinkedDirs();
    import_node_fs3.default.mkdirSync(stateDir, { recursive: true });
    const real = import_node_fs3.default.realpathSync(stateDir);
    if (!real.startsWith(import_node_fs3.default.realpathSync(repoRoot) + import_node_path10.default.sep)) {
      throw new Error(`tool-gate state: ${stateDir} resolves outside the repo`);
    }
  }
  return {
    readCycle() {
      try {
        refuseSymlinkedDirs();
        const fd = import_node_fs3.default.openSync(cycleFile, O_RDONLY | O_NOFOLLOW);
        let text;
        try {
          text = import_node_fs3.default.readFileSync(fd, "utf8");
        } finally {
          import_node_fs3.default.closeSync(fd);
        }
        const parsed = JSON.parse(text);
        return isCycleRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    writeCycle(cycle) {
      safeStateDir();
      const temp = `${cycleFile}.${process.pid}.tmp`;
      const fd = import_node_fs3.default.openSync(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW);
      try {
        import_node_fs3.default.writeFileSync(fd, JSON.stringify(cycle));
      } finally {
        import_node_fs3.default.closeSync(fd);
      }
      import_node_fs3.default.renameSync(temp, cycleFile);
    },
    appendEvent(event) {
      safeStateDir();
      const fd = import_node_fs3.default.openSync(eventsFile, O_APPEND | O_CREAT | O_WRONLY | O_NOFOLLOW);
      try {
        import_node_fs3.default.writeFileSync(fd, JSON.stringify(event) + "\n");
      } finally {
        import_node_fs3.default.closeSync(fd);
      }
    }
  };
}

// src/tool-gate/gate.ts
var TELL = "tool-gate failed, rules not checked.";
var TIMEOUT_MS = 2e3;
var HOOK_EVENTS = /* @__PURE__ */ new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);
function readHook(input) {
  const data = JSON.parse(input);
  if (typeof data !== "object" || data === null) throw new Error("hook input is not an object");
  const record2 = data;
  if (typeof record2.cwd !== "string" || typeof record2.tool_name !== "string") {
    throw new Error("hook input has no cwd or tool_name");
  }
  return {
    cwd: record2.cwd,
    hookEventName: typeof record2.hook_event_name === "string" ? record2.hook_event_name : "",
    toolName: record2.tool_name,
    toolInput: record2.tool_input,
    error: typeof record2.error === "string" ? record2.error : void 0,
    isInterrupt: record2.is_interrupt === true
  };
}
function repoRootOf(cwd) {
  for (let dir = cwd; ; dir = import_node_path11.default.dirname(dir)) {
    if (import_node_fs4.default.existsSync(import_node_path11.default.join(dir, ".git"))) return dir;
    if (import_node_path11.default.dirname(dir) === dir) return cwd;
  }
}
function projectRootOf(projectDir, cwd) {
  const usable = projectDir !== void 0 && import_node_path11.default.isAbsolute(projectDir) && import_node_fs4.default.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory() === true;
  return usable ? projectDir : repoRootOf(cwd);
}
function readFileOrNull(absPath) {
  try {
    return import_node_fs4.default.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}
function bashCommand(toolInput) {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const command = toolInput.command;
  return typeof command === "string" ? command : null;
}
function allow(hookEventName, context) {
  if (context === void 0) return { exitCode: 0, stdout: "", stderr: "" };
  const output = { hookSpecificOutput: { hookEventName, additionalContext: context } };
  return { exitCode: 0, stdout: `${JSON.stringify(output)}
`, stderr: "" };
}
async function checkBash(ctx, command) {
  const { hook, root, home, settings } = ctx;
  const facts = readCommand(command, hook.cwd, home);
  if ("unreadable" in facts) {
    ctx.store.appendEvent({ ts: ctx.ts, tool: hook.toolName, kind: "unreadable", command, result: "allowed" });
    return null;
  }
  for (const part of facts.parts) {
    const refusal2 = await checkProtectedBranch(part, settings, ctx.git) ?? checkForcePush(part, settings) ?? checkTags(part, settings) ?? checkProductionHost(part, settings) ?? checkProtectedPathBash(part, settings, root, home, realPathResolver);
    if (refusal2 !== null) return refusal2;
  }
  return null;
}
function checkEdit(ctx) {
  const { hook, root, home, settings } = ctx;
  const call = readEditCall(hook.toolName, hook.toolInput, hook.cwd, home, readFileOrNull);
  if (call === null) return null;
  return checkProtectedPathEdit(call, settings, root, home, realPathResolver) ?? checkFocusedTests(call, settings, root, home) ?? checkRedCycle(call, settings, root, home, fileWorkflowState(root), ctx.store);
}
function record(ctx, command) {
  const { hook } = ctx;
  if (hook.hookEventName !== "PostToolUse" && hook.hookEventName !== "PostToolUseFailure") return;
  const workflow = fileWorkflowState(ctx.root).read();
  recordTestRun(
    { hookEvent: hook.hookEventName, command, cwd: hook.cwd, error: hook.error, isInterrupt: hook.isInterrupt },
    {
      settings: ctx.settings,
      store: ctx.store,
      home: ctx.home,
      ts: ctx.ts,
      root: ctx.root,
      buildStartedAt: workflow?.currentCommandStartedAt ?? null,
      currentCommand: workflow?.currentCommand ?? null
    }
  );
}
async function decide(req, call) {
  const loaded = loadSettings(readFileOrNull, req.env.CLAUDE_PLUGIN_ROOT, call.root);
  const ctx = { ...call, settings: loaded.settings };
  const { hook } = ctx;
  const command = hook.toolName === "Bash" ? bashCommand(hook.toolInput) : null;
  let refusal2 = null;
  if (req.mode === "post") {
    if (command !== null) record(ctx, command);
  } else {
    refusal2 = command !== null ? await checkBash(ctx, command) : checkEdit(ctx);
  }
  if (refusal2 !== null) {
    ctx.store.appendEvent({
      ts: ctx.ts,
      tool: hook.toolName,
      kind: "refusal",
      rule: refusal2.rule,
      ...command !== null ? { command } : {},
      result: "refused"
    });
  }
  if (loaded.rejected !== void 0) {
    ctx.store.appendEvent({
      ts: ctx.ts,
      tool: hook.toolName,
      kind: "rule-file-rejected",
      result: refusal2 !== null ? "refused" : "allowed"
    });
  }
  if (refusal2 !== null) {
    const stderr = loaded.rejected === void 0 ? refusal2.reason : `${refusal2.reason}
${loaded.rejected}`;
    return { exitCode: 2, stdout: "", stderr: `${stderr}
` };
  }
  return allow(hook.hookEventName, loaded.rejected);
}
async function runToolGate(req, deps = {}) {
  let hook = null;
  let store = null;
  let timer;
  const timedOut = new Promise((resolve2) => {
    timer = setTimeout(() => resolve2(null), TIMEOUT_MS);
  });
  try {
    hook = readHook(req.input);
    const root = projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    store = fileStateStore(root);
    const call = { hook, root, home: req.env.HOME, store, git: deps.gitReader ?? realGitReader, ts: (/* @__PURE__ */ new Date()).toISOString() };
    const result = await Promise.race([decide(req, call), timedOut]);
    if (result === null) throw new Error("tool-gate timed out");
    return result;
  } catch {
    try {
      store?.appendEvent({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        tool: hook?.toolName ?? "unknown",
        kind: "gate-error",
        result: "allowed"
      });
    } catch {
    }
    const event = hook !== null && HOOK_EVENTS.has(hook.hookEventName) ? hook.hookEventName : req.mode === "pre" ? "PreToolUse" : "PostToolUse";
    return allow(event, TELL);
  } finally {
    clearTimeout(timer);
  }
}

// src/cli/tool-gate.ts
var USAGE = "Usage: tool-gate pre|post < hook.json\n";
async function runCli(argv, input, env) {
  const mode = argv[0];
  if (mode !== "pre" && mode !== "post") return { exitCode: 1, stdout: "", stderr: USAGE };
  const { HOME = "", CLAUDE_PLUGIN_ROOT = "", CLAUDE_PROJECT_DIR } = env;
  return runToolGate({ mode, input, env: { HOME, CLAUDE_PLUGIN_ROOT, CLAUDE_PROJECT_DIR } });
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}
function answer(result) {
  process.stderr.write(result.stderr, () => {
    process.stdout.write(result.stdout, () => process.exit(result.exitCode));
  });
}
if (/tool-gate\.(js|cjs)$/.test(process.argv[1] || "")) {
  readStdin().then((input) => runCli(process.argv.slice(2), input, process.env)).then(answer, () => answer({ exitCode: 1, stdout: "", stderr: "tool-gate: could not read the hook input\n" }));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runCli
});
