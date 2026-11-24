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

// src/cli/tool-gate.ts
var tool_gate_exports = {};
__export(tool_gate_exports, {
  HARD_LIMIT_MS: () => HARD_LIMIT_MS,
  decideInWorker: () => decideInWorker,
  runCli: () => runCli,
  runMain: () => runMain
});
module.exports = __toCommonJS(tool_gate_exports);
var import_node_path32 = __toESM(require("node:path"), 1);
var import_node_worker_threads = require("node:worker_threads");

// src/tool-gate/gate.ts
var import_node_fs19 = __toESM(require("node:fs"), 1);
var import_node_path31 = __toESM(require("node:path"), 1);

// src/tool-gate/expansion-scan.ts
var MAX_INDEX = 256;
var INDEX = `(?:\\[(?=([^\\]\\n]{0,${MAX_INDEX}}))\\2\\])`;
var FLAGS = "(?:\\([^)\\n]{0,64}\\))?";
var BRACED = new RegExp(`\\$\\{${FLAGS}([A-Za-z_][A-Za-z0-9_]*)${INDEX}?:{0,2}=`, "g");
var ARITHMETIC_SET = new RegExp(
  `(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\\s*(?:${INDEX}\\s*)?(?:[-+*/%&|^]|<<|>>)?=(?!=)`,
  "g"
);
var UNREAD_INDEX = `\\[(?![^\\]\\n$\\x60\\[]{0,${MAX_INDEX}}\\])`;
var BRACED_UNREAD = new RegExp(`\\$\\{${FLAGS}([A-Za-z_][A-Za-z0-9_]*)${UNREAD_INDEX}`, "g");
var ARITHMETIC_UNREAD = new RegExp(`(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)${UNREAD_INDEX}`, "g");
function expansionSet(command, wanted) {
  for (const pattern of [BRACED, BRACED_UNREAD]) {
    for (const match of command.matchAll(pattern)) {
      if (wanted(match[1])) return match[1];
    }
  }
  let close = -1;
  let searchedTo = -1;
  for (let open = command.indexOf("(("); open !== -1; open = command.indexOf("((", open + 1)) {
    if (close < open + 2) close = command.indexOf(")", open + 2);
    if (close === -1) break;
    if (close === searchedTo) continue;
    searchedTo = close;
    const inside3 = command.slice(open + 2, close);
    for (const pattern of [ARITHMETIC_SET, ARITHMETIC_UNREAD]) {
      for (const match of inside3.matchAll(pattern)) {
        if (wanted(match[1])) return match[1];
      }
    }
  }
  return null;
}

// src/tool-gate/command-reader.ts
var import_node_os2 = __toESM(require("node:os"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);

// src/tool-gate/deadline.ts
var import_node_async_hooks = require("node:async_hooks");

// src/tool-gate/budget.ts
var OverBudget = class extends Error {
  constructor(what) {
    super(what);
    this.what = what;
    this.name = "OverBudget";
  }
  what;
};
function budgetedGitReader(inner, limits, now = () => performance.now()) {
  const deadline = now() + limits.timeMs;
  const asked = /* @__PURE__ */ new Map();
  function ask(key2, run) {
    const known = asked.get(key2);
    if (known !== void 0) return known;
    const answer2 = (async () => {
      if (asked.size >= limits.maxRuns) throw new OverBudget(`more than ${limits.maxRuns} different git lookups`);
      const left = deadline - now();
      if (left <= 0) throw new OverBudget("git took too long to answer");
      const result = await run(left);
      if (now() >= deadline) throw new OverBudget("git took too long to answer");
      return result;
    })();
    asked.set(key2, answer2);
    return answer2;
  }
  return {
    currentBranch: (dir) => ask(JSON.stringify(["branch", dir]), (timeoutMs) => inner.currentBranch(dir, timeoutMs)),
    wouldClean: (dir, options, pathspecs) => ask(JSON.stringify(["clean", dir, options, pathspecs]), (timeoutMs) => inner.wouldClean(dir, options, pathspecs, timeoutMs))
  };
}

// src/tool-gate/deadline.ts
var current = new import_node_async_hooks.AsyncLocalStorage();
var TIMED_OUT_REFUSAL = "Refused by the tool gate: this command is too complex to check in time; split it into simpler commands.\n";
var CHECK_EVERY = 256;
function withDeadline(ms, now, run) {
  return current.run({ at: now() + ms, now }, run);
}
var steps = 0;
function tick() {
  if (++steps % CHECK_EVERY !== 0) return;
  const deadline = current.getStore();
  if (deadline !== void 0 && deadline.now() > deadline.at) {
    throw new OverBudget("checking it took too long");
  }
}
function timeLeft(capMs) {
  const deadline = current.getStore();
  if (deadline === void 0) return capMs;
  return Math.max(1, Math.min(capMs, Math.floor(deadline.at - deadline.now())));
}

// src/tool-gate/call-variables.ts
var MOVES_EVERYTHING = ["CLAUDE_PLUGIN_ROOT", "HOME", "PATH"];
var PLUGIN_ROOT_VALUE = "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/plugins/oss}";
var LEADING_ASSIGNMENT = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"[ \t]*(?:\n|;|&&|$)/;
var PLAIN_VALUE = /^[A-Za-z0-9_./@+:-]+$/;
var REFERENCE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
var MODIFIED = /^[:[]/;
var MAX_INPUT = 32 * 1024;
var MAX_ASSIGNMENTS = 64;
var MAX_OUTPUT = 64 * 1024;
var OTHER_SETTERS = /(?:^|[\s;&|(`])(?:declare|typeset|export|local|readonly|read|mapfile|readarray|getopts|let|unset|eval|source|cd|pushd|popd|integer|float|private|vared|zparseopts|sysread|strftime|zstat|zle|getln)(?=$|[\s;&|)])/;
var DOT_SOURCE = /(?:^|[;&|(`\n])\s*\.(?=\s)/;
var PRINTF_V = /(?:^|[\s;&|(`])print(?:f)?\s(?:[^;&|\n]*\s)?-[A-Za-z]*v/;
var SET_ARRAY = /(?:^|[\s;&|(`])set\s(?:[^;&|\n]*\s)?[-+][A-Za-z]*A/;
var EXPANSION_SETS = /\$\{\(|::=|:=/;
var SHELL_SET = /* @__PURE__ */ new Set(["PWD", "OLDPWD", "REPLY", "MAPFILE", "OPTARG", "OPTIND", "RANDOM", "SECONDS", "LINENO", "UID", "EUID", "PPID", "reply", "match", "MATCH", "status", "argv"]);
var SHELL_MAINTAINED = /^(?:_|DIRSTACK|dirstack|PIPESTATUS|pipestatus|OLDPWD|PWD|HISTCMD|ERRNO|COLUMNS|LINES|SHLVL|GROUPS|FUNCNAME|EPOCH[A-Za-z0-9_]*|SRANDOM|RANDOM|COMP_[A-Za-z0-9_]*|ZSH_[A-Za-z0-9_]*|MBEGIN|MEND|mbegin|mend|TRY_BLOCK_[A-Za-z0-9_]*|path|fpath|psvar|cdpath|CDPATH|REPLY)$/;
function shellSets(name) {
  return SHELL_SET.has(name) || name.startsWith("BASH") || SHELL_MAINTAINED.test(name);
}
function nameCounts(text, words = /(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*/g) {
  const counts = /* @__PURE__ */ new Map();
  for (const match of text.matchAll(words)) {
    tick();
    const name = match[0];
    const at = match.index ?? 0;
    const count = counts.get(name) ?? { words: 0, references: 0 };
    count.words++;
    if (text[at - 1] === "$" || text[at - 1] === "{" && text[at - 2] === "$") count.references++;
    counts.set(name, count);
  }
  return counts;
}
function setIn(counts, name) {
  const count = counts.get(name);
  return count !== void 0 && count.words !== count.references;
}
function valueOf(raw, known, home, pluginRoot) {
  if (raw === PLUGIN_ROOT_VALUE) return pluginRoot;
  if (/[`*?[\]]|\$\(|\.\./.test(raw)) return null;
  let unknown = false;
  let size = raw.length;
  const value = raw.replace(REFERENCE, (all, braced, bare, at) => {
    tick();
    const name = braced ?? bare ?? "";
    const found2 = name === "HOME" ? home : known.get(name);
    size += (found2?.length ?? 0) - all.length;
    if (found2 === void 0 || size > MAX_OUTPUT || bare !== void 0 && MODIFIED.test(raw.slice(at + all.length))) {
      unknown = true;
      return "";
    }
    return found2;
  });
  return !unknown && PLAIN_VALUE.test(value) && !value.includes("..") ? value : null;
}
function fillIn(text, known, room) {
  const out = [];
  let size = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    tick();
    const c = text[i];
    let piece = c;
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") {
      piece = text.slice(i, i + 2);
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === "$") {
      const match = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(text.slice(i, i + 256));
      const name = match?.[1] ?? match?.[2];
      const value = name === void 0 ? void 0 : known.get(name);
      if (match !== null && value !== void 0 && !(match[2] !== void 0 && MODIFIED.test(text.slice(i + match[0].length)))) {
        piece = value;
        i += match[0].length - 1;
      }
    }
    size += piece.length;
    if (size > room) return null;
    out.push(piece);
  }
  return out.join("");
}
function otherWaysToSet(command) {
  return command.includes("<<") || command.includes("$'") || OTHER_SETTERS.test(command) || DOT_SOURCE.test(command) || PRINTF_V.test(command) || SET_ARRAY.test(command) || EXPANSION_SETS.test(command);
}
function resolveCallVariables(command, home, pluginRoot) {
  return fillCallVariables(command, home, pluginRoot);
}
function fillCallVariables(command, home, pluginRoot) {
  if (command.length > MAX_INPUT || otherWaysToSet(command)) return command;
  const whole = nameCounts(command);
  if (MOVES_EVERYTHING.some((name) => setIn(whole, name))) return command;
  const statements = [];
  let at = 0;
  for (; ; ) {
    tick();
    const match = LEADING_ASSIGNMENT.exec(command.slice(at, at + MAX_INPUT));
    if (match === null || match[0].trim() === "") break;
    if (statements.length === MAX_ASSIGNMENTS) return command;
    const [text, name = "", raw = ""] = match;
    statements.push({ name, raw, text });
    at += text.length;
    if (at >= command.length) break;
  }
  if (statements.length === 0) return command;
  const later = statements.map((s) => nameCounts(s.text));
  const tail = nameCounts(command.slice(at));
  const known = /* @__PURE__ */ new Map();
  statements.forEach(({ name, raw }, i) => {
    tick();
    const value = valueOf(raw, known, home, pluginRoot);
    const elsewhere = setIn(tail, name) || later.slice(i + 1).some((counts) => setIn(counts, name));
    if (value !== null && !elsewhere && !known.has(name) && !shellSets(name)) known.set(name, value);
  });
  if (known.size === 0) return command;
  const filled2 = fillIn(command.slice(at), known, MAX_OUTPUT - at);
  return filled2 === null ? command : command.slice(0, at) + filled2;
}
var NEVER_FOLLOWED = /* @__PURE__ */ new Set(["HOME", "PATH", "CDPATH", "cdpath", "IFS", "TMPDIR", "CLAUDE_PLUGIN_ROOT", "ENV", "BASH_ENV"]);
var HIDDEN_SETTER_WORDS = ["eval", "source", "alias", "nameref", "enable"];
var HIDDEN_SETTER_FORMS = String.raw`(?:^|[;&|(\`\n])\s*\.(?=\s)|(?:^|[\s;&|(\`])(?:declare|typeset|local|export|readonly)\s(?:[^;&|\n]*\s)?-[A-Za-z]*n|\$\{[!(]|::=`;
function hiddenSetters(words) {
  return new RegExp(String.raw`(?:^|[\s;&|(\`])(?:${words.join("|")})(?=$|[\s;&|)])|` + HIDDEN_SETTER_FORMS);
}
var HIDDEN_SETTERS = hiddenSetters([...HIDDEN_SETTER_WORDS, "trap"]);
var LATER_HIDDEN_SETTERS = hiddenSetters(HIDDEN_SETTER_WORDS);
var SETTERS_BETWEEN = /\(\(|\$\[|\[\[|\$\{(?![A-Za-z_][A-Za-z0-9_]*\})|\$'/;
var COUNTED = /* @__PURE__ */ new Map();
function plainMentions(text, name) {
  let counts = COUNTED.get(text);
  if (counts === void 0) {
    counts = nameCounts(text, /(?<![A-Za-z0-9_])(?<!(?:^|[\s'"=])-)[A-Za-z_][A-Za-z0-9_]*/g);
    COUNTED.clear();
    COUNTED.set(text, counts);
  }
  const count = counts.get(name);
  return count === void 0 ? 0 : count.words - count.references;
}
function plainMentionsIn(text, name, from, to) {
  const words = new RegExp(`(?<![A-Za-z0-9_])(?<!(?:^|[\\s'"=])-)${name}(?![A-Za-z0-9_])`, "g");
  words.lastIndex = from;
  let count = 0;
  for (let m = words.exec(text); m !== null && m.index < to; m = words.exec(text)) {
    tick();
    if (text[m.index - 1] !== "$" && !(text[m.index - 1] === "{" && text[m.index - 2] === "$")) count++;
  }
  return count;
}
function mayFollow(text, name, setEnd, use, read = text) {
  if (neverFollowed(name) || setEnd > use) return false;
  if (plainMentions(text, name) !== 1) return false;
  return !HIDDEN_SETTERS.test(read.slice(0, use)) && !SETTERS_BETWEEN.test(read.slice(setEnd, use));
}
function unchangedAfter(text, from) {
  return !LATER_HIDDEN_SETTERS.test(text.slice(from));
}
function neverFollowed(name) {
  return shellSets(name) || NEVER_FOLLOWED.has(name);
}
function mayReadEnvironment(text, name, use) {
  if (neverFollowed(name) || plainMentions(text, name) !== 0) return false;
  const before = text.slice(0, use);
  return !HIDDEN_SETTERS.test(before) && !SETTERS_BETWEEN.test(before);
}

// src/tool-gate/patterns.ts
var import_node_path = __toESM(require("node:path"), 1);
var ANY_FOLDERS = "**";
var ONE_NAME = "?*";
function wildcardMatch(pattern, text, isStar, matches) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark2 = 0;
  while (t < text.length) {
    tick();
    if (p < pattern.length && isStar(pattern[p])) {
      star = p++;
      mark2 = t;
    } else if (p < pattern.length && matches(pattern[p], text[t])) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark2;
    } else {
      return false;
    }
  }
  while (p < pattern.length && isStar(pattern[p])) p++;
  return p === pattern.length;
}
function segmentMatches(glob, name) {
  return wildcardMatch(
    glob,
    name,
    (c) => c === "*",
    (c, d) => c === "?" || c === d
  );
}
function globSegments(glob) {
  const segments = glob.split("/");
  if (segments.length > 1 && segments[segments.length - 1] === ANY_FOLDERS) {
    segments.splice(segments.length - 1, 1, ONE_NAME, ANY_FOLDERS);
  }
  return segments;
}
function segmentsMatch(glob, target) {
  return wildcardMatch(glob, target, (s) => s === ANY_FOLDERS, segmentMatches);
}
function compile(glob, opts) {
  let full;
  if (glob.startsWith("~/")) full = import_node_path.default.join(opts.home, glob.slice(2));
  else if (glob.startsWith("**/") || import_node_path.default.isAbsolute(glob)) full = import_node_path.default.normalize(glob);
  else full = import_node_path.default.join(opts.root, glob);
  return globSegments(opts.caseInsensitive === true ? full.toLowerCase() : full);
}
function targetOf(absPath, opts) {
  const target = import_node_path.default.normalize(absPath);
  return (opts.caseInsensitive === true ? target.toLowerCase() : target).split("/");
}
function matchPath(glob, absPath, opts) {
  return segmentsMatch(compile(glob, opts), targetOf(absPath, opts));
}
var compiled = /* @__PURE__ */ new WeakMap();
function compiledList(globs, opts) {
  let lists = compiled.get(opts);
  if (lists === void 0) {
    lists = /* @__PURE__ */ new WeakMap();
    compiled.set(opts, lists);
  }
  let list = lists.get(globs);
  if (list === void 0) {
    list = globs.map((glob) => {
      const segments = compile(glob, opts);
      return { segments, literals: [...new Set(segments.filter((s) => !s.includes("*") && !s.includes("?")))] };
    });
    lists.set(globs, list);
  }
  return list;
}
function matchAnyPath(globs, absPath, opts) {
  const target = targetOf(absPath, opts);
  const names = new Set(target);
  return compiledList(globs, opts).some(({ segments, literals }) => literals.every((name) => names.has(name)) && segmentsMatch(segments, target));
}
function wordMatches(patternWord, word) {
  return wildcardMatch(
    patternWord,
    word,
    (c) => c === "*",
    (c, d) => c === d
  );
}
function matchCommand(pattern, words) {
  const patternWords = pattern.split(" ");
  return words.length >= patternWords.length && patternWords.every((patternWord, i) => wordMatches(patternWord, words[i] ?? ""));
}
var SHELL_GLOB_CHARS = /[*?[\]\\]/g;
function escapeGlob(text) {
  return text.replace(SHELL_GLOB_CHARS, "\\$&");
}
function globPathOf(glob, base, home) {
  let expanded = glob;
  if (glob === "~") expanded = escapeGlob(home);
  else if (glob.startsWith("~/")) expanded = escapeGlob(home) + glob.slice(1);
  const full = expanded.startsWith("/") ? expanded : `${base}/${expanded}`;
  return `/${full.split("/").filter((s) => s !== "" && s !== ".").join("/")}`;
}
var ANY_CHAR = () => true;
function literal(c) {
  return { run: false, char: c, test: (d) => d === c };
}
function classEnds(segment) {
  const n = segment.length;
  const nextPair = { ":": new Int32Array(n + 2).fill(-1), ".": new Int32Array(n + 2).fill(-1), "=": new Int32Array(n + 2).fill(-1) };
  const stop = new Int32Array(n + 2).fill(-1);
  for (let j = n - 1; j >= 0; j--) {
    tick();
    for (const mark2 of [":", ".", "="]) {
      nextPair[mark2][j] = segment[j] === mark2 && segment[j + 1] === "]" ? j : nextPair[mark2][j + 1];
    }
    const c = segment[j];
    if (c === "]") {
      stop[j] = j;
    } else if (c === "\\") {
      stop[j] = stop[j + 2];
    } else if (c === "[" && (segment[j + 1] === ":" || segment[j + 1] === "." || segment[j + 1] === "=")) {
      const close = nextPair[segment[j + 1]][j + 2];
      stop[j] = close === -1 ? stop[j + 1] : stop[close + 2];
    } else {
      stop[j] = stop[j + 1];
    }
  }
  return (open) => {
    let j = open + 1;
    if (segment[j] === "!" || segment[j] === "^") j++;
    if (segment[j] === "]") j++;
    return j < n ? stop[j] : -1;
  };
}
function classTest(body) {
  const negate = body[0] === "!" || body[0] === "^";
  const items = negate ? body.slice(1) : body;
  if (/\[[:.=]/.test(items)) return ANY_CHAR;
  const singles = /* @__PURE__ */ new Set();
  const ranges = [];
  for (let k = 0; k < items.length; k++) {
    let c = items[k];
    if (c === "\\" && k + 1 < items.length) c = items[++k];
    if (items[k + 1] === "-" && k + 2 < items.length) {
      let end = items[k + 2];
      k += 2;
      if (end === "\\" && k + 1 < items.length) end = items[++k];
      ranges.push([c, end]);
    } else {
      singles.add(c);
    }
  }
  return (d) => (singles.has(d) || ranges.some(([from, to]) => d >= from && d <= to)) !== negate;
}
function shellAtoms(segment) {
  const atoms = [];
  let classEnd = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === "\\" && i + 1 < segment.length) {
      atoms.push(literal(segment[++i]));
    } else if (c === "*") {
      if (atoms[atoms.length - 1]?.run !== true) atoms.push({ run: true });
    } else if (c === "?") {
      atoms.push({ run: false, char: null, test: ANY_CHAR });
    } else if (c === "[" && (classEnd ??= classEnds(segment))(i) !== -1) {
      const end = classEnd(i);
      atoms.push({ run: false, char: null, test: classTest(segment.slice(i + 1, end)) });
      i = end;
    } else {
      atoms.push(literal(c));
    }
  }
  return atoms;
}
function configAtoms(segment) {
  return [...segment].map((c) => c === "*" ? { run: true } : c === "?" ? { run: false, char: null, test: ANY_CHAR } : literal(c));
}
function charsMeet(x, y) {
  if (x.char !== null && y.char !== null) return x.char === y.char;
  if (x.char !== null) return y.test(x.char);
  if (y.char !== null) return x.test(y.char);
  return true;
}
function dotOnly(b) {
  return b !== null && b[0]?.run === false && b[0].char === ".";
}
function segmentsMeet(a, b, dots = false) {
  const first = a[0];
  if (!dots && first !== void 0 && (first.run || first.char === null) && dotOnly(b)) return false;
  const n = a.length;
  const m = b.length;
  const seen = new Uint8Array((n + 1) * (m + 1));
  const todo = [0];
  const visit = (i, j) => {
    const k = i * (m + 1) + j;
    if (seen[k] === 0) {
      seen[k] = 1;
      todo.push(k);
    }
  };
  seen[0] = 1;
  for (let k = todo.pop(); k !== void 0; k = todo.pop()) {
    tick();
    const i = Math.floor(k / (m + 1));
    const j = k % (m + 1);
    if (i === n && j === m) return true;
    const x = a[i];
    const y = b[j];
    if (x?.run === true) {
      visit(i + 1, j);
      if (j < m) visit(i, j + 1);
    }
    if (y?.run === true) {
      visit(i, j + 1);
      if (i < n) visit(i + 1, j);
    }
    if (x !== void 0 && y !== void 0 && !x.run && !y.run && charsMeet(x, y)) visit(i + 1, j + 1);
  }
  return false;
}
var shapes = /* @__PURE__ */ new WeakMap();
function shapesOf(globs, opts) {
  let lists = shapes.get(opts);
  if (lists === void 0) {
    lists = /* @__PURE__ */ new WeakMap();
    shapes.set(opts, lists);
  }
  let list = lists.get(globs);
  if (list === void 0) {
    const segmentLists = compiledList(globs, opts);
    list = globs.map((glob, n) => {
      const { segments } = segmentLists[n];
      const wild = segments.findIndex((s) => /[*?]/.test(s));
      let anchor = 0;
      if (glob.startsWith("~/")) anchor = import_node_path.default.normalize(opts.home).split("/").length;
      else if (!glob.startsWith("**/") && !import_node_path.default.isAbsolute(glob)) anchor = import_node_path.default.normalize(opts.root).split("/").length;
      return {
        atoms: segments.map((s) => s === ANY_FOLDERS ? null : configAtoms(s)),
        fixed: wild === -1 ? segments.length : wild,
        anchor
      };
    });
    lists.set(globs, list);
  }
  return list;
}
function pathMeets(g, p, exemptAnchor, dots) {
  const m = p.atoms.length;
  return walk(g, p.atoms, (j) => j === m, dots) || walk(g, p.atoms.slice(0, p.fixed), (j) => j >= 1 && (!exemptAnchor || j > p.anchor), dots);
}
function walk(g, atoms, accept, dots = false, starts = [0], ends) {
  const n = g.length;
  const m = atoms.length;
  const seen = new Uint8Array((n + 1) * (m + 1));
  const todo = [...starts];
  for (const j of starts) seen[j] = 1;
  const visit = (i, j) => {
    const k = i * (m + 1) + j;
    if (seen[k] === 0) {
      seen[k] = 1;
      todo.push(k);
    }
  };
  for (let k = todo.pop(); k !== void 0; k = todo.pop()) {
    tick();
    const i = Math.floor(k / (m + 1));
    const j = k % (m + 1);
    if (i === n) {
      if (ends !== void 0) ends.add(j);
      else if (accept(j)) return true;
    }
    const x = i < n ? g[i] : void 0;
    const y = j < m ? atoms[j] : void 0;
    if (x === null) {
      visit(i + 1, j);
      if (j < m && (dots || !dotOnly(atoms[j]))) visit(i, j + 1);
    }
    if (y === null) {
      visit(i, j + 1);
      if (i < n) visit(i + 1, j);
    }
    if (x != null && y != null && segmentsMeet(x, y, dots)) visit(i + 1, j + 1);
  }
  return false;
}
function shellGlobMayMatch(globPath, globs, opts, exemptAnchor = false, dots = false) {
  const g = shellSegments(globPath, opts);
  return shapesOf(globs, opts).some((p) => pathMeets(g, p, exemptAnchor, dots));
}
function shellGlobTailMatcher(prefix, globs, opts, exemptAnchor = false, dots = false) {
  const g = shellSegments(prefix, opts);
  const last = g[g.length - 1];
  if (g.length > 1 && last !== null && last !== void 0 && last.length === 0) g.pop();
  const plans = shapesOf(globs, opts).map((p) => {
    const fixedAtoms = p.atoms.slice(0, p.fixed);
    const full = /* @__PURE__ */ new Set();
    const held = /* @__PURE__ */ new Set();
    walk(g, p.atoms, () => false, dots, [0], full);
    walk(g, fixedAtoms, () => false, dots, [0], held);
    return { p, fixedAtoms, full: [...full], held: [...held] };
  });
  return (tail) => {
    const t = shellSegments(tail, opts);
    return plans.some(
      ({ p, fixedAtoms, full, held }) => full.length > 0 && walk(t, p.atoms, (j) => j === p.atoms.length, dots, full) || held.length > 0 && walk(t, fixedAtoms, (j) => j >= 1 && (!exemptAnchor || j > p.anchor), dots, held)
    );
  };
}
function shellSegments(pattern, opts) {
  const normal = import_node_path.default.posix.normalize(opts.caseInsensitive === true ? pattern.toLowerCase() : pattern);
  return normal.split("/").map((s) => s === ANY_FOLDERS ? null : shellAtoms(s));
}
function named(b) {
  return b !== null && b.some((atom) => !atom.run && atom.char !== null);
}
function tailMayBeProtected(tail, globs, opts, dots = false, contents = false) {
  const g = shellSegments(belowClimb(tail), opts).filter((s, n) => n > 0 || s === null || s.length > 0);
  const gLast = g[g.length - 1];
  return shapesOf(globs, opts).some((p) => {
    const pLast = p.atoms[p.atoms.length - 1];
    if (!contents && gLast != null && pLast != null && !segmentsMeet(gLast, pLast, dots)) return false;
    let last = contents ? p.atoms.length - 1 : -1;
    p.atoms.forEach((b, j) => {
      if (named(b)) last = Math.max(last, j);
    });
    for (let from = 0; from <= last; from++) {
      const rest = p.atoms.slice(from);
      if (walk(g, rest, (j) => j === rest.length, dots)) return true;
    }
    return false;
  });
}
function tailMayHoldProtected(tail, globs, opts, dots = false) {
  const g = shellSegments(belowClimb(tail), opts).filter((s, n) => n > 0 || s === null || s.length > 0);
  return shapesOf(globs, opts).some((p) => {
    let last = -1;
    p.atoms.forEach((b, j) => {
      if (named(b)) last = Math.max(last, j);
    });
    for (let from = 0; from <= last; from++) {
      const rest = p.atoms.slice(from);
      if (walk(g, rest, (j) => j >= 1 && j < rest.length && named(rest[j - 1]), dots)) return true;
    }
    return false;
  });
}
function shellGlobMayHold(globPath, globs, opts, dots = false) {
  const g = shellSegments(globPath, opts);
  return shapesOf(globs, opts).some((p) => walk(g, p.atoms.slice(0, p.fixed), (j) => j >= 1, dots));
}
function belowClimb(tail) {
  const segments = import_node_path.default.posix.normalize(tail).split("/");
  const climb = segments.lastIndexOf("..");
  if (climb === -1) return tail;
  const rest = segments.slice(climb + 1).join("/");
  return rest === "" ? ANY_FOLDERS : rest;
}
function shellPatternMatchesPath(pattern, absPath, opts, dots) {
  const g = shellSegments(pattern, { home: "", root: "", ...opts });
  const named2 = (opts.caseInsensitive === true ? import_node_path.default.posix.normalize(absPath).toLowerCase() : import_node_path.default.posix.normalize(absPath)).split("/");
  const atoms = named2.map((name) => [...name].map(literal));
  return walk(g, atoms, (j) => j === atoms.length, dots);
}
var ANY_DEPTH = `${ANY_FOLDERS}/`;
function floatingNames(globs, caseInsensitive) {
  const fold = (text) => caseInsensitive ? text.toLowerCase() : text;
  const firsts = [...new Set(globs.filter((g) => g.startsWith(ANY_DEPTH)).map((g) => fold(g.slice(ANY_DEPTH.length).split("/")[0])))];
  if (firsts.length === 0) return null;
  return (name) => firsts.some((first) => segmentMatches(first, fold(name)));
}
function hasShellWildcard(glob) {
  let classEnd = null;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "\\") i++;
    else if (c === "*" || c === "?" || c === "[" && (classEnd ??= classEnds(glob))(i) !== -1) return true;
  }
  return false;
}

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
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var UNKNOWN = "\0DYN\0";
var GLOBS = /* @__PURE__ */ new WeakMap();
function globOf(token) {
  return GLOBS.get(token);
}
var ZSH_GLOBS = /* @__PURE__ */ new WeakMap();
function extendedGlobOf(token) {
  return ZSH_GLOBS.get(token);
}
var SKIPPED = "";
var DOTS = /* @__PURE__ */ new WeakSet();
function dotsOf(token) {
  return DOTS.has(token);
}
var EXTGLOB_START = /[!@+]$/;
var QUALIFIER_START = new Set("/.@=p*%rwxAIERWXsStfedlUGugamcLMTNDnoOYF^-[P:+#");
var REWRITING_CHARS = /[+:#(]/;
var SUBSCRIPT_NOT_NUMBERS = /\[(?![0-9,-]*\])/;
var STRING_QUALIFIERS = /* @__PURE__ */ new Set(["e", "P"]);
var CLOSING = { "(": ")", "[": "]", "{": "}", "<": ">" };
function qualifierRewrites(inside3) {
  if (/[$`]/.test(inside3)) return true;
  if (inside3.includes("|") || !QUALIFIER_START.has(inside3[0] ?? "")) return false;
  if (REWRITING_CHARS.test(inside3) || SUBSCRIPT_NOT_NUMBERS.test(inside3)) return true;
  for (let i = 0; i < inside3.length; i++) {
    const open = inside3[i + 1];
    if (!STRING_QUALIFIERS.has(inside3[i]) || open === void 0) continue;
    if (inside3.indexOf(CLOSING[open] ?? open, i + 2) !== -1) return true;
  }
  return false;
}
var SOURCES = /* @__PURE__ */ new WeakMap();
function sourceOf(token) {
  return SOURCES.get(token);
}
var HEREDOC_BODIES = /* @__PURE__ */ new WeakMap();
function heredocBodyOf(token) {
  return HEREDOC_BODIES.get(token);
}
var CONTROL_OPERATORS = ["&&", "||", ";;", "|&", ";", "|", "&", "(", ")", "\n"];
var REDIRECT_OPERATORS = [
  "&>>|",
  "&>>!",
  ">>&|",
  ">>&!",
  "&>>",
  "&>|",
  "&>!",
  ">&|",
  ">&!",
  "<<<",
  "<<-",
  ">>|",
  ">>!",
  "&>",
  ">>",
  ">|",
  ">!",
  "<<",
  "<>",
  ">",
  "<"
];
var ALL_OPERATORS = [...CONTROL_OPERATORS, ...REDIRECT_OPERATORS].sort((a, b) => b.length - a.length);
var HEREDOC_OPERATORS = ["<<", "<<-"];
var FUNCTION_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
var COMMAND_START_WORDS = /* @__PURE__ */ new Set(["then", "do", "else", "elif", "if", "while", "until", "{", "!", "time"]);
var ARRAY_NAME = /^[A-Za-z_][A-Za-z0-9_]*\+?=$/;
var NOT_PLAIN = /['"\\$`{}]/;
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
var TYPESET_FAMILY = /* @__PURE__ */ new Set(["typeset", "declare", "local", "export", "readonly", "integer", "float"]);
var PRECOMMANDS = /* @__PURE__ */ new Set([...COMMAND_START_WORDS, "builtin", "command", "noglob", "nocorrect", "exec", "-"]);
var ARRAY_PREFIXES = /* @__PURE__ */ new Set([...COMMAND_START_WORDS, "nocorrect"]);
var GROUP_HIDES = /* @__PURE__ */ new Set(["\n", "<", ">", "&", ";", "`"]);
var DOUBLE_QUOTE_ESCAPABLE = '$`"\\\n';
var Unreadable = class extends Error {
};
var ReadingLimit = class extends Error {
};
var NeverRead = class extends Error {
};
var MAX_INPUT_CHARS = 1024 * 1024;
var MAX_NESTING = 64;
var MAX_BRACE_WORDS = 256;
var MAX_SEQUENCE_ITEMS = 64;
var MAX_CALL_WORDS = 2048;
var MAX_CALL_CHARS = 64 * 1024;
var ReadBudget = class {
  words = 0;
  chars = 0;
  operators = 0;
  /**
   * Counts one more operator (round 18): a flood of `(`, `;` or newlines makes no words, so without
   * this the whole input was read before any limit stopped it.
   */
  takeOperator() {
    if (++this.operators > MAX_CALL_WORDS) throw new ReadingLimit(`too many operators: over ${MAX_CALL_WORDS}`);
  }
  /** Counts `count` more words of `chars` characters; a reading limit when the call goes over. */
  take(count, chars) {
    this.words += count;
    this.chars += chars;
    if (this.words > MAX_CALL_WORDS) throw new ReadingLimit(`too many words: over ${MAX_CALL_WORDS}`);
    this.checkChars(0);
  }
  /** A reading limit when `more` characters would take the call over its characters. */
  checkChars(more) {
    if (this.chars + more > MAX_CALL_CHARS) throw new ReadingLimit(`words longer than ${MAX_CALL_CHARS / 1024} KB in all`);
  }
};
var WORD_END = /* @__PURE__ */ new Set([" ", "	", "\n", ";", "&", "|", "(", ")", "<", ">"]);
var NAME_START = /[A-Za-z_]/;
var NAME = /[A-Za-z0-9_]*/y;
var SPECIAL_PARAMETER = /[0-9@*#?$!-]/;
var TILDE_USER = /[A-Za-z0-9._-]+/y;
var TILDE_USER_START = /[A-Za-z0-9._-]/;
var PARAMETER_FLAG_CHARS = /* @__PURE__ */ new Set(["~", "=", "^"]);
var STACK_TILDE = /~(?:[+-][0-9]*|[0-9]+)(?=$|[\/ \t\n;&|()<>])/y;
function tokenize(cmd, home, budget = new ReadBudget()) {
  if (cmd.length > MAX_INPUT_CHARS) return { unreadable: true, reason: "command larger than 1 MB", limit: true, tokens: [] };
  const flags = { unreadable: null };
  const scanner = new Scanner(cmd.replaceAll("\0", ""), home, budget, flags);
  try {
    const tokens = scanner.script(0, false);
    return flags.unreadable === null ? { tokens } : { unreadable: true, reason: flags.unreadable, limit: false, tokens };
  } catch (err) {
    if (err instanceof ReadingLimit || err instanceof NeverRead) return { unreadable: true, reason: err.message, limit: true, tokens: [] };
    if (err instanceof Unreadable) return { unreadable: true, reason: err.message, limit: false, tokens: scanner.top };
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
    tick();
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
var Word = class {
  text = "";
  /** The word as a shell pattern: unquoted characters as typed, quoted wildcard characters escaped. */
  glob = "";
  /** Indices in `text` of unquoted `{`, `,` and `}`: the only ones brace expansion reads. */
  braces = [];
  /** The same braces' indices in `glob`. */
  globBraces = [];
  /**
   * `glob` as zsh reads it with EXTENDED_GLOB, same length (brace positions line up): each unquoted `#`
   * as `*`; an unquoted `^` (anything but what follows) as `*` for the rest of its path segment, and a
   * non-leading `~` (what is left of it, less what follows) as `*` for the rest of the word (round 16,
   * CR HIGH-1); the characters they cover kept as SKIPPED, dropped once braces are expanded. And whether it has one.
   */
  extended = "";
  extendedWild = false;
  /** Covered by a `^` (`segment`, to the next `/`) or a `~` (`word`, to its end): what is read there adds SKIPPED. */
  covered = "none";
  /** `extended` ends in an unescaped `*`, so a `^` or `~` right after adds nothing (no `**`, which crosses folders). */
  endsInStar = false;
  scripts = [];
  started = false;
  /** Any part was quoted or escaped: then a heredoc delimiter makes its body literal, and the word is no keyword. */
  quoted = false;
  /** A glob qualifier (`*(D)`) may make the pattern match dot entries too. */
  dots = false;
  /** The pattern was seen to hold a wildcard: it only grows, so it keeps it (round 9, perf HIGH-1). */
  wild = false;
  /** True when the pattern holds a wildcard; once true, never searched again. */
  hasWildcard() {
    this.wild ||= hasShellWildcard(this.glob);
    return this.wild;
  }
  /** Quoted, escaped or expanded text: never a wildcard. */
  add(text) {
    this.text += text;
    this.glob += escapeGlob(text);
    for (const c of escapeGlob(text)) this.extend(c);
    this.started = true;
  }
  /** An unquoted character as typed: `*`, `?` and `[` in it are wildcards. */
  addPlain(c) {
    const operator = c === "#" || c === "^" || c === "~" && this.started;
    this.extendedWild ||= operator;
    if (operator && c !== "#") {
      this.extend(this.endsInStar ? SKIPPED : "*", true);
      if (this.covered !== "word") this.covered = c === "^" ? "segment" : "word";
    } else if (c === "#" && this.covered === "none" && this.extended.length > 0 && !this.extended.endsWith(SKIPPED)) {
      this.extended = `${this.extended.slice(0, -1)}*`;
      this.extend(SKIPPED);
      this.endsInStar = true;
    } else {
      this.extend(c === "#" ? "*" : c, c === "*" || c === "#");
    }
    this.text += c;
    this.glob += c;
    this.started = true;
  }
  /**
   * Adds one character to `extended`: SKIPPED where a `^` or `~` covers it (a `/` ends a `^`'s cover).
   * `star`: it is a `*` wildcard as read, which a `^` or `~` right after needs no other `*` for.
   */
  extend(c, star = false) {
    if (this.covered === "segment" && c === "/") this.covered = "none";
    if (this.covered !== "none") {
      this.extended += SKIPPED;
      return;
    }
    this.extended += c;
    this.endsInStar = star || c === SKIPPED && this.endsInStar;
  }
  addBrace(c) {
    this.braces.push(this.text.length);
    this.globBraces.push(this.glob.length);
    this.text += c;
    this.glob += c;
    this.extended += c;
    this.endsInStar = false;
    this.started = true;
  }
  addUnknown(script) {
    this.add(UNKNOWN);
    if (script !== void 0) this.scripts.push(script);
  }
};
var Scanner = class _Scanner {
  constructor(cmd, home, budget, flags) {
    this.cmd = cmd;
    this.home = home;
    this.budget = budget;
    this.flags = flags;
  }
  cmd;
  home;
  budget;
  flags;
  i = 0;
  /** The top-level tokens read so far: what a syntax error leaves readable. */
  top = [];
  /**
   * Reads a script from `i`: to the end of the input, or (inside `$( … )`, `<( … )`) up to and
   * past the `)` that closes it.
   */
  script(depth, closed) {
    if (depth > MAX_NESTING) throw new ReadingLimit(`substitutions nested deeper than ${MAX_NESTING}`);
    const { cmd } = this;
    const tokens = [];
    if (depth === 0) this.top = tokens;
    const heredocs = [];
    const cases = [];
    let word = new Word();
    let quote = "";
    let pendingRedirect = null;
    let pendingRedirectEnd = -1;
    let parens = 0;
    let tests = 0;
    let patternParens = 0;
    const keywords = /* @__PURE__ */ new WeakSet();
    let wordStart = this.i;
    const endWord = () => {
      if (!word.started) return;
      const done = word;
      word = new Word();
      const heredoc = pendingRedirect !== null && HEREDOC_OPERATORS.includes(pendingRedirect);
      this.budget.checkChars(done.text.length);
      const values = heredoc ? [done.text] : expandBraces(done.text, done.braces, this.budget);
      this.budget.take(values.length, values.reduce((n, v) => n + v.length, 0));
      const globs = !heredoc && hasShellWildcard(done.glob) ? expandBraces(done.glob, done.globBraces, new ReadBudget()) : [];
      const extendedGlobs = !heredoc && done.extendedWild ? expandBraces(done.extended, done.globBraces, new ReadBudget()) : [];
      const withGlob = (token, n) => {
        const glob = globs.length === values.length ? globs[n] : void 0;
        if (glob !== void 0 && hasShellWildcard(glob)) GLOBS.set(token, glob);
        const extended = extendedGlobs.length === values.length ? extendedGlobs[n] : void 0;
        if (extended !== void 0) ZSH_GLOBS.set(token, extended.replaceAll(SKIPPED, ""));
        if (done.dots) DOTS.add(token);
        return token;
      };
      const scripts = done.scripts.length > 0 ? { scripts: done.scripts } : {};
      if (pendingRedirect !== null) {
        const op = pendingRedirect;
        const redirects = values.map((target, n) => withGlob({ kind: "redirect", op, target, ...n === 0 ? scripts : {} }, n));
        if (heredoc) {
          heredocs.push({ delimiter: done.text, stripTabs: op === "<<-", token: redirects[0], literal: done.quoted });
        } else if (redirects.length === 1) {
          SOURCES.set(redirects[0], { start: wordStart, end: this.i });
        }
        tokens.push(...redirects);
        pendingRedirect = null;
        return;
      }
      if (!done.quoted) {
        readCaseWord(done.text);
        if (done.text === "[[" && atCommandStart()) tests++;
        else if (done.text === "]]" && tests > 0) tests--;
      }
      const words = values.map((value, n) => withGlob({ kind: "word", value, ...n === 0 ? scripts : {} }, n));
      if (values.some((v) => /^-[A-Za-z]*r/.test(v)) && changesReservedWords()) {
        throw new NeverRead("`disable -r` and `enable -r` change zsh's reserved words; the gate doesn't run calls that use them");
      }
      if (words.length === 1) SOURCES.set(words[0], { start: wordStart, end: this.i });
      if (!done.quoted && (done.text === "for" || done.text === "coproc") && atCommandStart()) keywords.add(words[0]);
      tokens.push(...words);
    };
    const changesReservedWords = () => {
      let n = tokens.length;
      while (n > 0 && tokens[n - 1].kind !== "op") n--;
      for (const t of tokens.slice(n)) {
        if (t.kind !== "word") continue;
        if (t.value === "disable" || t.value === "enable") return true;
        if (!ASSIGNMENT.test(t.value) && !PRECOMMANDS.has(t.value) && !t.value.startsWith("-")) return false;
      }
      return false;
    };
    const atCommandStart = () => {
      const last = tokens[tokens.length - 1];
      return last === void 0 || last.kind === "op" || last.kind === "word" && COMMAND_START_WORDS.has(last.value);
    };
    const definesFunction2 = () => {
      const last = tokens[tokens.length - 1];
      return !word.quoted && FUNCTION_NAME.test(word.text) && (atCommandStart() || last?.kind === "word" && last.value === "function");
    };
    const globGroupHere = (i) => {
      if (tests > 0 || cases[cases.length - 1] === "pattern" || /^\(\s*\)/.test(cmd.slice(i, i + 64))) return false;
      if (pendingRedirect !== null) return true;
      if (atCommandStart()) return false;
      const last = tokens[tokens.length - 1];
      const before = tokens[tokens.length - 2];
      const isKeyword = (t, value) => t !== void 0 && keywords.has(t) && t.kind === "word" && t.value === value;
      return !(isKeyword(last, "for") || isKeyword(before, "for") || isKeyword(last, "coproc"));
    };
    const assignsArray = () => {
      if (word.quoted || !ARRAY_NAME.test(word.text)) return false;
      let n = tokens.length;
      while (n > 0 && tokens[n - 1].kind !== "op") n--;
      const words = tokens.slice(n).filter((t) => t.kind === "word");
      let first = 0;
      while (first < words.length && ARRAY_PREFIXES.has(words[first].value) && writtenPlainly(words[first])) first++;
      const command = words.slice(first).find((w) => !namedPlainly(w));
      return command === void 0 || TYPESET_FAMILY.has(command.value) && writtenPlainly(command);
    };
    const writtenPlainly = (token) => {
      const source = SOURCES.get(token);
      if (source === void 0 || token.kind !== "word") return false;
      const raw = cmd.slice(source.start, source.end);
      return raw === token.value && (raw === "{" || !NOT_PLAIN.test(raw));
    };
    const namedPlainly = (token) => {
      const source = SOURCES.get(token);
      const name = token.kind === "word" ? ASSIGNMENT.exec(token.value)?.[0] : void 0;
      return source !== void 0 && name !== void 0 && cmd.startsWith(name, source.start) && !NOT_PLAIN.test(name);
    };
    const readCaseWord = (value) => {
      const top = cases[cases.length - 1];
      if (top === "header") {
        if (value === "in") cases[cases.length - 1] = "pattern";
      } else if (value === "esac" && (top === "pattern" || top === "body" && atCommandStart())) {
        cases.pop();
      } else if (value === "case" && atCommandStart()) {
        cases.push("header");
      }
    };
    const skipHeredocBodies = (i) => {
      for (const { delimiter, stripTabs, token, literal: literal2 } of heredocs) {
        const lines = [];
        while (i < cmd.length) {
          tick();
          const end = cmd.indexOf("\n", i);
          const lineEnd = end === -1 ? cmd.length : end;
          let line = cmd.slice(i, lineEnd);
          if (stripTabs) line = line.replace(/^\t+/, "");
          i = lineEnd + 1;
          if (line === delimiter) break;
          lines.push(line);
        }
        const body = lines.join("\n");
        HEREDOC_BODIES.set(token, body);
        if (literal2) continue;
        const bodyScripts = this.scriptsIn(body, depth);
        if (bodyScripts.length > 0) token.scripts = [...token.scripts ?? [], ...bodyScripts];
      }
      heredocs.length = 0;
      return Math.min(i, cmd.length);
    };
    while (this.i < cmd.length) {
      tick();
      const i = this.i;
      const c = cmd[i];
      const next = cmd[i + 1];
      if (!word.started) wordStart = i;
      if (quote === "'") {
        if (c === "'") quote = "";
        else word.add(c);
        this.i++;
        continue;
      }
      if (quote === '"') {
        if (c === '"') {
          quote = "";
          this.i++;
        } else if (c === "\\" && next !== void 0 && DOUBLE_QUOTE_ESCAPABLE.includes(next)) {
          if (next !== "\n") word.add(next);
          this.i += 2;
        } else if (c === "`") {
          word.addUnknown(this.backticks(depth, true));
        } else if (c === "$") {
          this.dollar(word, depth);
        } else {
          word.add(c);
          this.i++;
        }
        continue;
      }
      if (c === "$" && next === "'") {
        const { text, end } = readAnsiCQuote(cmd, i + 2);
        word.add(text);
        word.quoted = true;
        this.i = end;
        continue;
      }
      if (c === "$" && next === '"') {
        word.quoted = true;
        this.i++;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        word.started = true;
        word.quoted = true;
        this.i++;
        continue;
      }
      if (c === "\\") {
        word.quoted = true;
        if (next === "\n") {
          this.i += 2;
        } else if (next === void 0) {
          word.add(c);
          this.i++;
        } else {
          word.add(next);
          this.i += 2;
        }
        continue;
      }
      if (c === "`") {
        word.addUnknown(this.backticks(depth, false));
        continue;
      }
      if (c === "$") {
        this.dollar(word, depth);
        continue;
      }
      if ((c === "<" || c === ">") && next === "(") {
        this.i += 2;
        word.addUnknown(this.script(depth + 1, true));
        continue;
      }
      if (c === "{" || c === "," || c === "}") {
        word.addBrace(c);
        this.i++;
        continue;
      }
      if (c === "~" && !word.started) {
        this.tilde(word);
        continue;
      }
      if (c === "#" && !word.started && patternParens === 0) {
        const end = cmd.indexOf("\n", i);
        this.i = end === -1 ? cmd.length : end;
        continue;
      }
      if (c === " " || c === "	") {
        endWord();
        this.i++;
        continue;
      }
      if (c === "&" && pendingRedirect !== null && !word.started && i === pendingRedirectEnd) {
        word.add("&");
        this.i++;
        while (cmd[this.i] === " " || cmd[this.i] === "	") this.i++;
        continue;
      }
      if (c === "(" && word.started && (word.hasWildcard() || EXTGLOB_START.test(word.glob))) {
        this.qualifier(word);
        continue;
      }
      if (c === "(" && word.started && tests === 0 && word.text.endsWith("=") && !assignsArray()) {
        throw new NeverRead(groupRefusal(cmd, i));
      }
      if (c === "(" && word.started && tests === 0 && !word.text.endsWith("=") && !(next === ")" && definesFunction2())) {
        throw new NeverRead("a `(` right after a word: a zsh glob qualifier or modifier");
      }
      if (c === "(" && !word.started && globGroupHere(i)) {
        throw new NeverRead(groupRefusal(cmd, i));
      }
      const operator = matchOperator(cmd, i);
      if (operator === void 0) {
        word.addPlain(c);
        this.i++;
        continue;
      }
      const isRedirect = REDIRECT_OPERATORS.includes(operator);
      let opText = operator;
      const digits = word.text;
      const fdPrefix = isRedirect && word.started && /^[0-9]+$/.test(digits) && cmd.slice(i - digits.length, i) === digits;
      if (fdPrefix) {
        opText = digits + operator;
        word = new Word();
      } else {
        endWord();
      }
      if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
      this.i += operator.length;
      if (isRedirect) {
        pendingRedirect = opText;
        pendingRedirectEnd = this.i;
        continue;
      }
      const caseTop = cases[cases.length - 1];
      if (operator === "(" && (tests > 0 || caseTop === "pattern")) patternParens++;
      else if (operator === ")" && patternParens > 0) patternParens--;
      if (caseTop === "pattern" && (operator === ")" || operator === "(")) {
        if (operator === ")") cases[cases.length - 1] = "body";
        this.budget.takeOperator();
        tokens.push({ kind: "op", value: operator });
        continue;
      }
      if (caseTop === "body" && operator === ";;") cases[cases.length - 1] = "pattern";
      if (closed && operator === ")" && parens === 0) return tokens;
      if (operator === "(") parens++;
      if (operator === ")") parens--;
      this.budget.takeOperator();
      tokens.push({ kind: "op", value: operator });
      if (operator === "\n") this.i = skipHeredocBodies(this.i);
    }
    if (quote !== "") throw new Unreadable(`unterminated ${quote} quote`);
    endWord();
    if (pendingRedirect !== null) throw new Unreadable(`redirect ${pendingRedirect} has no target`);
    if (closed) throw new Unreadable("unterminated substitution");
    return tokens;
  }
  /**
   * Reads a `` `…` `` substitution at `i` and returns its script. Inside it, a backslash before
   * `$`, `` ` `` or `\` (and `"` when the backticks sit in double quotes) only escapes that character.
   */
  backticks(depth, inDoubleQuotes) {
    const { cmd } = this;
    const escapable = inDoubleQuotes ? '$`\\"' : "$`\\";
    let body = "";
    let j = this.i + 1;
    for (; j < cmd.length && cmd[j] !== "`"; j++) {
      tick();
      if (cmd[j] === "\\" && j + 1 < cmd.length && escapable.includes(cmd[j + 1])) j++;
      body += cmd[j];
    }
    if (j >= cmd.length) throw new Unreadable("unterminated ` substitution");
    this.i = j + 1;
    return new _Scanner(body, this.home, this.budget, this.flags).script(depth + 1, false);
  }
  /**
   * The scripts of the `$( … )` and backtick substitutions in a text: an unquoted heredoc body, or
   * the inside of a `${…}` or `$((…))`. Quotes are plain text here (inside `${…}` that may read a
   * substitution bash would not run, which only adds parts to check); a backslash keeps the next
   * character from starting a substitution.
   */
  scriptsIn(body, depth) {
    const reader = new _Scanner(body, this.home, this.budget, this.flags);
    const found2 = new Word();
    while (reader.i < body.length) {
      tick();
      const c = body[reader.i];
      if (c === "\\") reader.i += 2;
      else if (c === "`") found2.addUnknown(reader.backticks(depth, false));
      else if (c === "$") reader.dollar(found2, depth);
      else reader.i++;
    }
    return found2.scripts;
  }
  /** Reads what a `$` at `i` starts: a substitution, arithmetic, a variable, or just `$`. */
  dollar(word, depth) {
    const { cmd } = this;
    const i = this.i;
    const next = cmd[i + 1] ?? "";
    if (next === "(") {
      const arithmeticEnd = cmd[i + 2] === "(" ? arithmeticEndOf(cmd, i + 1) : -1;
      if (arithmeticEnd !== -1) {
        word.addUnknown();
        const body = cmd.slice(i + 3, arithmeticEnd - 2);
        if (/\$\(|`/.test(body)) this.readPast(word, body, "arithmetic that runs a command", depth);
        this.i = arithmeticEnd;
        return;
      }
      this.i += 2;
      word.addUnknown(this.script(depth + 1, true));
      return;
    }
    if (next === "{") {
      if (cmd[i + 2] === "(") throw new NeverRead("zsh parameter flags `${(\u2026)\u2026}`");
      if (PARAMETER_FLAG_CHARS.has(cmd[i + 2] ?? "")) throw new NeverRead(`zsh \`\${${cmd[i + 2]}\u2026}\` reads a value as a pattern or as several words`);
      const end = parameterEndOf(cmd, i + 2);
      const body = cmd.slice(i + 2, end);
      if (/\$\(|`/.test(body)) {
        word.addUnknown();
        this.readPast(word, body, "${\u2026} that runs a command", depth);
      } else {
        this.variable(word, body);
      }
      this.i = end + 1;
      return;
    }
    if (NAME_START.test(next)) {
      NAME.lastIndex = i + 1;
      const name = NAME.exec(cmd)?.[0] ?? "";
      this.variable(word, name);
      this.i = i + 1 + name.length;
      return;
    }
    if (next !== "" && SPECIAL_PARAMETER.test(next)) {
      word.addUnknown();
      this.i = i + 2;
      return;
    }
    word.add("$");
    this.i++;
  }
  /**
   * Reads the `(…)` right after a pattern into its word: a zsh glob qualifier (`*(D)`, `*(.N)`) or
   * a bash extended glob (`!(x)`, `@(a|b)`). Either way the word stands for any names its start
   * allows, so its pattern ends in `*`; a qualifier may add dot entries (`D`), and one that runs
   * code (`e:…:`, `+name`) is never read. Nor is a group that never closes, or that holds an unquoted
   * newline, `<`, `>`, `&`, `;`, backtick, `$(` or comment `#` (round 20, PEN HIGH-1 = SEC HIGH-1): zsh
   * ends the word at a redirect or separator, so the rest runs as a command, and reads past newlines.
   */
  qualifier(word) {
    const { cmd } = this;
    let depth = 0;
    let quote = "";
    let end = this.i;
    for (; end < cmd.length; end++) {
      tick();
      const c = cmd[end];
      if (quote !== "") {
        if (c === quote) quote = "";
        else if (c === "\\" && quote === '"') end++;
      } else if (c === "\\") end++;
      else if (c === "'" || c === '"') quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
      else if (GROUP_HIDES.has(c) || c === "$" && cmd[end + 1] === "(" || c === "#" && /[ \t]/.test(cmd[end - 1])) break;
    }
    if (cmd[end] !== ")") {
      throw new NeverRead(`a zsh glob group holds a newline, comment, redirect or separator, or never closes; list the names instead: ${clip(cmd.slice(this.i, this.i + 61).split("\n")[0])}`);
    }
    const inside3 = cmd.slice(this.i + 1, end);
    if (qualifierRewrites(inside3)) throw new NeverRead(`zsh reads ${clip(`(${inside3})`)} after a pattern as glob qualifiers that can run a command or rewrite the names`);
    const extglob = EXTGLOB_START.test(word.glob);
    const start = extglob ? word.glob.slice(0, -1) : word.glob;
    const star = start.endsWith("*") ? "" : "*";
    word.glob = start + star;
    word.extended = (extglob ? word.extended.slice(0, -1) : word.extended) + star;
    word.text += `(${inside3})`;
    word.dots ||= !extglob;
    this.i = end + 1;
  }
  /**
   * A piece read past as unknown (ADR-010): the call is flagged unreadable, and the commands the
   * piece runs go with its word, so they are still checked.
   */
  readPast(word, body, reason, depth) {
    this.flags.unreadable ??= reason;
    word.scripts.push(...this.scriptsIn(body, depth));
  }
  /** `HOME` is the home folder; every other variable is unknown, never empty. */
  variable(word, name) {
    if (name === "HOME" && this.home !== void 0) word.add(this.home);
    else word.addUnknown();
  }
  /**
   * An unquoted `~name` at the start of a word: the home folder for the current user, unknown
   * for any other user. A bare `~` (and `~/…`) is left as written for the command reader.
   */
  tilde(word) {
    const { cmd } = this;
    STACK_TILDE.lastIndex = this.i;
    const stack = STACK_TILDE.exec(cmd)?.[0];
    const following = cmd[this.i + 1];
    if (stack !== void 0 || following !== void 0 && following !== "/" && !WORD_END.has(following) && !TILDE_USER_START.test(following)) {
      const end = following === "[" ? cmd.indexOf("]", this.i) : -1;
      this.i = stack !== void 0 ? this.i + stack.length : end !== -1 ? end + 1 : this.i + 1;
      word.addUnknown([]);
      return;
    }
    TILDE_USER.lastIndex = this.i + 1;
    const user = TILDE_USER.exec(cmd)?.[0];
    const after = this.i + 1 + (user?.length ?? 0);
    if (user === void 0 || after < cmd.length && cmd[after] !== "/" && !WORD_END.has(cmd[after])) {
      word.add("~");
      this.i++;
      return;
    }
    if (this.isCurrentUser(user)) word.add(this.home ?? "");
    else word.addUnknown();
    this.i = after;
  }
  isCurrentUser(user) {
    if (this.home === void 0) return false;
    if (user === import_node_path2.default.posix.basename(this.home)) return true;
    try {
      return user === import_node_os.default.userInfo().username;
    } catch {
      return false;
    }
  }
};
function groupRefusal(cmd, at) {
  return `zsh glob groups like \`(a|b)\` in the middle of a command aren't read by the gate; list the names instead: ${clip(cmd.slice(at, at + 61).split("\n")[0])}`;
}
function clip(text) {
  return text.length > 60 ? `${text.slice(0, 59)}\u2026` : text;
}
function arithmeticEndOf(cmd, open) {
  let depth = 0;
  for (let j = open; j < cmd.length; j++) {
    tick();
    if (cmd[j] === "(") depth++;
    else if (cmd[j] === ")") {
      depth--;
      if (depth === 1 && cmd[j + 1] !== ")") return -1;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}
function parameterEndOf(cmd, start) {
  let depth = 0;
  let quote = "";
  for (let j = start; j < cmd.length; j++) {
    tick();
    const c = cmd[j];
    if (quote !== "") {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"') j++;
    } else if (c === "\\") j++;
    else if (c === "'" || c === '"') quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0) return j;
      depth--;
    }
  }
  throw new Unreadable("unterminated ${");
}
function expandBraces(text, braces, budget) {
  if (braces.length === 0) return [text];
  const on = new Uint8Array(text.length);
  for (const b of braces) on[b] = 1;
  return expand(text, on, 0, budget);
}
function lengthOf(words) {
  return words.reduce((n, w) => n + w.length, 0);
}
function expand(text, on, depth, budget) {
  if (depth > MAX_NESTING) throw new ReadingLimit(`brace groups nested deeper than ${MAX_NESTING}`);
  const group = firstGroup(text, on);
  if (group === null) return [text];
  const { open, close, commas, sequence } = group;
  const pre = text.slice(0, open);
  let choices;
  if (sequence !== null) {
    choices = sequence;
  } else {
    const cuts = [open, ...commas, close];
    choices = cuts.slice(1).flatMap((cut, n) => expand(text.slice(cuts[n] + 1, cut), on.subarray(cuts[n] + 1, cut), depth + 1, budget));
  }
  const after = expand(text.slice(close + 1), on.subarray(close + 1), depth + 1, budget);
  const count = choices.length * after.length;
  if (count > MAX_BRACE_WORDS) {
    throw new ReadingLimit(`brace expansion makes more than ${MAX_BRACE_WORDS} words`);
  }
  budget.checkChars(after.length * lengthOf(choices) + choices.length * lengthOf(after) + count * pre.length);
  return choices.flatMap((choice) => after.map((rest) => pre + choice + rest));
}
function firstGroup(text, on) {
  const stack = [];
  let best = null;
  for (let j = 0; j < text.length; j++) {
    tick();
    if (on[j] !== 1) continue;
    const c = text[j];
    if (c === "{") stack.push({ open: j, commas: [] });
    else if (c === ",") stack[stack.length - 1]?.commas.push(j);
    else {
      const group = stack.pop();
      if (group === void 0 || best !== null && best.open < group.open) continue;
      const sequence = group.commas.length === 0 ? sequenceOf(text.slice(group.open + 1, j)) : null;
      if (group.commas.length > 0 || sequence !== null) best = { ...group, close: j, sequence };
    }
  }
  return best;
}
var NUMBER_SEQUENCE = /^(-?[0-9]+)\.\.(-?[0-9]+)(?:\.\.(-?[0-9]+))?$/;
var LETTER_SEQUENCE = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?[0-9]+))?$/;
function sequenceOf(body) {
  const numbers = NUMBER_SEQUENCE.exec(body);
  const letters = numbers === null ? LETTER_SEQUENCE.exec(body) : null;
  const match = numbers ?? letters;
  if (match === null) return null;
  const from = numbers !== null ? Number(match[1]) : match[1].charCodeAt(0);
  const to = numbers !== null ? Number(match[2]) : match[2].charCodeAt(0);
  const step = Math.abs(Number(match[3] ?? "1")) || 1;
  if (Math.floor(Math.abs(to - from) / step) + 1 > MAX_SEQUENCE_ITEMS) return null;
  const padded = numbers !== null && [match[1], match[2]].some((n) => /^-?0[0-9]/.test(n));
  const size = Math.max(match[1].length, match[2].length);
  const items = [];
  const direction = to >= from ? 1 : -1;
  for (let n = from; direction > 0 ? n <= to : n >= to; n += direction * step) {
    if (letters !== null) items.push(String.fromCharCode(n));
    else if (padded) items.push(n < 0 ? `-${String(-n).padStart(size - 1, "0")}` : String(n).padStart(size, "0"));
    else items.push(String(n));
  }
  return items;
}

// src/tool-gate/sed-awk.ts
function longOption(word, full, shortest) {
  const flag = word.includes("=") ? word.slice(0, word.indexOf("=")) : word;
  return flag.length >= shortest && full.startsWith(flag);
}
var SED_SCRIPT_LETTERS = /* @__PURE__ */ new Set(["e"]);
var SED_FILE_LETTERS = /* @__PURE__ */ new Set(["f"]);
var SED_VALUE_LETTERS = /* @__PURE__ */ new Set(["l"]);
var SED_LONG = [
  { full: "--expression", shortest: 3, kind: "script" },
  { full: "--file", shortest: 4, kind: "file" },
  { full: "--line-length", shortest: 4, kind: "value" }
];
function sedScripts(args) {
  const scripts = [];
  const operands2 = [];
  let fromFile = false;
  let bareInPlace = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      operands2.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const long = SED_LONG.find((o) => longOption(a, o.full, o.shortest));
      if (long === void 0) continue;
      const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      if (long.kind === "script" && value !== void 0) scripts.push(value);
      if (long.kind === "file") fromFile = true;
    } else if (a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const letter = a[j];
        if ((letter === "i" || letter === "I") && j === a.length - 1) bareInPlace = true;
        if (letter === "i" || letter === "I") break;
        if (SED_SCRIPT_LETTERS.has(letter) || SED_FILE_LETTERS.has(letter) || SED_VALUE_LETTERS.has(letter)) {
          const value = j < a.length - 1 ? a.slice(j + 1) : args[++i];
          if (SED_SCRIPT_LETTERS.has(letter) && value !== void 0) scripts.push(value);
          if (SED_FILE_LETTERS.has(letter)) fromFile = true;
          break;
        }
      }
    } else {
      operands2.push(a);
    }
  }
  if (scripts.length > 0 || fromFile) return { scripts, alternates: [], fromFile };
  return { scripts: operands2.slice(0, 1), alternates: bareInPlace ? operands2.slice(1, 2) : [], fromFile };
}
var SED_PLAIN = /* @__PURE__ */ new Set(["=", "d", "D", "g", "G", "h", "H", "n", "N", "p", "P", "x", "z", "F", "{", "}"]);
var SED_TO_LINE_END = /* @__PURE__ */ new Set(["a", "i", "c", "r", "R"]);
var SED_LABEL = /* @__PURE__ */ new Set([":", "b", "t", "T", "v"]);
var SED_NUMBER = /* @__PURE__ */ new Set(["q", "Q", "l", "L"]);
var S_FLAGS = /[gpiImM0-9]/;
var SedReader = class {
  constructor(s, facts) {
    this.s = s;
    this.facts = facts;
  }
  s;
  facts;
  i = 0;
  blank() {
    while (this.s[this.i] === " " || this.s[this.i] === "	") this.i++;
  }
  toLineEnd() {
    const end = this.s.indexOf("\n", this.i);
    const text = this.s.slice(this.i, end === -1 ? this.s.length : end);
    this.i = end === -1 ? this.s.length : end;
    return text;
  }
  /** Skips to past the next unescaped `d`; false when there is none. */
  past(d) {
    while (this.i < this.s.length && this.s[this.i] !== d) {
      if (this.s[this.i] === "\\") this.i++;
      this.i++;
    }
    if (this.i >= this.s.length) return false;
    this.i++;
    return true;
  }
  address() {
    const c = this.s[this.i];
    if (c === "/") {
      this.i++;
      this.past("/");
    } else if (c === "\\") {
      const d = this.s[this.i + 1];
      this.i += 2;
      if (d !== void 0) this.past(d);
    } else if (c !== void 0 && /[0-9$]/.test(c)) {
      while (this.i < this.s.length && /[0-9$~]/.test(this.s[this.i])) this.i++;
    } else {
      return false;
    }
    while (this.s[this.i] === "I" || this.s[this.i] === "M") this.i++;
    return true;
  }
  ranges() {
    if (!this.address()) return;
    this.blank();
    if (this.s[this.i] !== ",") return;
    this.i++;
    this.blank();
    if (this.s[this.i] === "+" || this.s[this.i] === "~") {
      this.i++;
      while (/[0-9]/.test(this.s[this.i] ?? "")) this.i++;
    } else {
      this.address();
    }
  }
  substitute() {
    const d = this.s[this.i++];
    if (d === void 0 || !this.past(d) || !this.past(d)) {
      if (this.s.includes(UNKNOWN)) this.facts.dynamic ??= DYNAMIC_SED;
      else this.facts.unreadable ??= "a sed `s` command the gate cannot read";
      this.i = this.s.length;
      return;
    }
    for (; ; ) {
      const f = this.s[this.i];
      if (f === "w") {
        this.i++;
        this.facts.writes.push(this.toLineEnd().trim());
        return;
      }
      if (f === "e") {
        this.facts.unreadable ??= "the sed `s///e` flag runs the text as a command";
        this.i++;
      } else if (f !== void 0 && S_FLAGS.test(f)) {
        this.i++;
      } else {
        return;
      }
    }
  }
  read() {
    const { s } = this;
    while (this.i < s.length) {
      while (this.i < s.length && /[\s;]/.test(s[this.i])) this.i++;
      if (this.i >= s.length) return;
      if (s[this.i] === "#") {
        this.toLineEnd();
        continue;
      }
      this.ranges();
      this.blank();
      while (s[this.i] === "!") {
        this.i++;
        this.blank();
      }
      const c = s[this.i++];
      if (c === void 0) return;
      if (SED_PLAIN.has(c)) continue;
      if (c === "w" || c === "W") this.facts.writes.push(this.toLineEnd().trim());
      else if (c === "e") {
        const command = this.toLineEnd().trim();
        if (command === "") this.facts.unreadable ??= "the sed `e` command runs the text as a command";
        else if (command.includes(UNKNOWN)) this.facts.unreadable ??= "the sed `e` command runs a command only known when it runs";
        else this.facts.commands.push(command);
      } else if (SED_TO_LINE_END.has(c)) this.toLineEnd();
      else if (SED_LABEL.has(c)) while (this.i < s.length && s[this.i] !== ";" && s[this.i] !== "\n") this.i++;
      else if (SED_NUMBER.has(c)) {
        this.blank();
        while (/[0-9]/.test(s[this.i] ?? "")) this.i++;
      } else if (c === "s") this.substitute();
      else if (c === "y") {
        const d = s[this.i++];
        if (d === void 0 || !this.past(d) || !this.past(d)) {
          if (s.includes(UNKNOWN)) this.facts.dynamic ??= DYNAMIC_SED;
          else this.facts.unreadable ??= "a sed `y` command the gate cannot read";
        }
      } else if (s.startsWith(UNKNOWN, this.i - 1)) {
        this.facts.dynamic ??= DYNAMIC_SED;
        return;
      } else {
        this.facts.unreadable ??= `a sed command (\`${c}\`) the gate doesn't know`;
        return;
      }
    }
  }
};
var DYNAMIC_SED = "a sed script holds text only known when it runs";
var DYNAMIC_AWK = "an awk script holds text only known when it runs";
function readSed(script) {
  const facts = { writes: [], commands: [], unreadable: null, dynamic: null };
  new SedReader(script, facts).read();
  if (script.includes(UNKNOWN)) facts.dynamic ??= DYNAMIC_SED;
  return facts;
}
function sedFacts(args) {
  const { scripts, alternates } = sedScripts(args);
  const facts = { writes: [], commands: [], unreadable: null, dynamic: null };
  const merge2 = (read) => {
    facts.writes.push(...read.writes);
    facts.commands.push(...read.commands);
    facts.unreadable ??= read.unreadable;
    facts.dynamic ??= read.dynamic;
  };
  scripts.forEach((script) => merge2(readSed(script)));
  for (const alternate of alternates) {
    const read = readSed(alternate);
    if (read.unreadable === null && read.dynamic === null) merge2(read);
  }
  return facts;
}
var AWK_VALUE_LETTERS = /* @__PURE__ */ new Set(["F", "v", "W"]);
var AWK_FILE_LETTERS = /* @__PURE__ */ new Set(["f", "E"]);
var AWK_LOAD_LETTERS = /* @__PURE__ */ new Set(["i", "l"]);
var AWK_SOURCE_LETTERS = /* @__PURE__ */ new Set(["e"]);
var AWK_LONG = [
  { full: "--field-separator", shortest: 3, kind: "value" },
  { full: "--assign", shortest: 3, kind: "value" },
  { full: "--file", shortest: 4, kind: "file" },
  { full: "--exec", shortest: 4, kind: "file" },
  { full: "--include", shortest: 3, kind: "load" },
  { full: "--load", shortest: 4, kind: "load" },
  { full: "--source", shortest: 4, kind: "source" }
];
var AWK_DIRECTIVE = /@(?:include|load)\b/;
function awkScripts(args) {
  const scripts = [];
  let fromFile = false;
  let loads = false;
  let operand;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      operand = args[i + 1];
      break;
    }
    if (a.startsWith("--")) {
      const long = AWK_LONG.find((o) => longOption(a, o.full, o.shortest));
      if (long === void 0) continue;
      const value = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      if (long.kind === "file") fromFile = true;
      if (long.kind === "load") loads = true;
      if (long.kind === "source" && value !== void 0) scripts.push(value);
    } else if (a.startsWith("-") && a.length > 1) {
      const letter = a[1];
      const takes = AWK_VALUE_LETTERS.has(letter) || AWK_FILE_LETTERS.has(letter) || AWK_LOAD_LETTERS.has(letter) || AWK_SOURCE_LETTERS.has(letter);
      const value = takes ? a.length > 2 ? a.slice(2) : args[++i] : void 0;
      if (AWK_FILE_LETTERS.has(letter)) fromFile = true;
      if (AWK_LOAD_LETTERS.has(letter)) loads = true;
      if (AWK_SOURCE_LETTERS.has(letter) && value !== void 0) scripts.push(value);
    } else {
      operand = a;
      break;
    }
  }
  if (scripts.length === 0 && !fromFile && operand !== void 0) scripts.push(operand);
  return { scripts, loads: loads || scripts.some((s) => AWK_DIRECTIVE.test(s)), fromFile };
}
function awkTokens(s) {
  const tokens = [];
  const afterOperand = () => {
    const last = tokens[tokens.length - 1];
    return last !== void 0 && (last.kind !== "op" || last.text === ")" || last.text === "]");
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c) && c !== "\n") {
      i++;
    } else if (c === "#") {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === '"') {
      let text = "";
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === "\\" && i + 1 < s.length) i++;
        text += s[i];
      }
      i++;
      tokens.push({ kind: "str", text });
    } else if (c === "/" && !afterOperand()) {
      for (i++; i < s.length && s[i] !== "/"; i++) if (s[i] === "\\") i++;
      i++;
      tokens.push({ kind: "word", text: "/regex/" });
    } else if (/[A-Za-z0-9_$.]/.test(c)) {
      const start = i;
      while (i < s.length && /[A-Za-z0-9_$.]/.test(s[i])) i++;
      tokens.push({ kind: "word", text: s.slice(start, i) });
    } else {
      const two = s.slice(i, i + 2);
      const op = [">>", "||", "|&", ">=", "&&", "==", "!=", "<="].includes(two) ? two : c;
      i += op.length;
      tokens.push({ kind: "op", text: op });
    }
  }
  return tokens;
}
var STDIN_RUNNERS = /^(?:(?:ba|z|da|k|fi|c|tc)?sh|python[0-9.]*|node|perl|ruby|php|osascript|expect|tclsh|deno|bun|lua|xargs|eval|source)$/;
function runsItsInput(command) {
  return command.split(/\s+/).some((word) => STDIN_RUNNERS.test(word.slice(word.lastIndexOf("/") + 1)));
}
var STATEMENT_END = /* @__PURE__ */ new Set([";", "\n", "}", "{"]);
function readAwk(script, facts) {
  const tokens = awkTokens(script);
  let printDepth = null;
  let depth = 0;
  tokens.forEach((t, n) => {
    const next = tokens[n + 1];
    const prev = tokens[n - 1];
    if (t.kind === "word" && (t.text === "print" || t.text === "printf")) printDepth = depth;
    if (t.kind === "word" && t.text === "system" && next?.kind === "op" && next.text === "(") {
      const arg = tokens[n + 2];
      if (arg?.kind === "str" && tokens[n + 3]?.text === ")" && !arg.text.includes(UNKNOWN)) facts.commands.push(arg.text);
      else facts.unreadable ??= "awk `system()` runs a command the gate cannot read";
    }
    if (t.kind !== "op") return;
    if (t.text === "(") depth++;
    else if (t.text === ")") depth--;
    else if (STATEMENT_END.has(t.text) && depth === printDepth) printDepth = null;
    else if (t.text === "|" || t.text === "|&") {
      if (next?.kind === "str" && printDepth !== null && runsItsInput(next.text)) facts.unreadable ??= `awk prints into \`${next.text}\`, which runs what awk prints`;
      if (next?.kind === "str" && !next.text.includes(UNKNOWN)) facts.commands.push(next.text);
      else if (prev?.kind === "str" && !prev.text.includes(UNKNOWN) && next?.kind === "word" && next.text === "getline") facts.commands.push(prev.text);
      else facts.unreadable ??= "an awk pipe runs a command the gate cannot read";
    } else if ((t.text === ">" || t.text === ">>") && printDepth !== null && depth === printDepth) {
      if (next?.kind === "str") facts.writes.push(next.text);
      else facts.unreadable ??= "an awk `print >` writes a file the gate cannot read";
    }
  });
}
function awkFacts(args) {
  const { scripts, loads } = awkScripts(args);
  const facts = { writes: [], commands: [], unreadable: null, dynamic: null, loads };
  for (const script of scripts) {
    readAwk(script, facts);
    if (script.includes(UNKNOWN)) facts.dynamic ??= DYNAMIC_AWK;
  }
  return facts;
}
var SED_NAMES = /* @__PURE__ */ new Set(["sed", "gsed"]);
var AWK_NAMES = /* @__PURE__ */ new Set(["awk", "gawk", "mawk", "nawk"]);
function runsScriptFile(name, args) {
  if (SED_NAMES.has(name)) return sedScripts(args).fromFile;
  return AWK_NAMES.has(name) && awkScripts(args).fromFile;
}
function scriptFactsOf(name, args) {
  if (name === null) return null;
  if (SED_NAMES.has(name)) return sedFacts(args);
  return AWK_NAMES.has(name) ? awkFacts(args) : null;
}

// src/tool-gate/command-reader.ts
var NO_TRUSTED_SOURCES = { folders: [], pluginRootVariable: false };
function programName(word, reading) {
  const base = import_node_path3.default.posix.basename(word);
  return reading.caseInsensitive ? base.toLowerCase() : base;
}
var UTIL_LINUX_SCRIPT = {
  values: [
    "-c",
    "--command",
    "-E",
    "--echo",
    "-I",
    "--log-in",
    "-O",
    "--log-out",
    "-B",
    "--log-io",
    "-T",
    "--log-timing",
    "-m",
    "--logging-format"
  ],
  shell: ["-c", "--command"],
  operands: 1,
  terminal: true,
  writesOperands: true,
  defaultWrite: "typescript",
  noCommandOperands: true
};
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
  // zsh precommand modifiers: they run the command that follows
  ["noglob", { values: [] }],
  ["nocorrect", { values: [] }],
  ["-", { values: [] }],
  ["nice", { values: ["-n", "--adjustment"] }],
  ["nohup", { values: [] }],
  // zsh's `repeat N cmd` runs cmd N times (round 16, CR LOW-1)
  ["repeat", { values: [], operands: 1 }],
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
  ["timeout", { values: ["-s", "--signal", "-k", "--kill-after"], operands: 1 }],
  // fix round 4, K6/K8: `script [-aeFkqr] [-t time] [file [cmd…]]` (macOS, BSD), read as util-linux too
  ["script", {
    values: ["-t", "-T"],
    operands: 1,
    terminal: true,
    writesOperands: true,
    defaultWrite: "typescript",
    alternate: UTIL_LINUX_SCRIPT
  }],
  ["unbuffer", { values: [], terminal: true }],
  ["faketime", { values: ["--date-prog"], operands: 1 }],
  ["caffeinate", { values: ["-t", "-w"] }],
  ["ionice", { values: ["-c", "--class", "-n", "--classdata", "-p", "--pid", "-P", "--pgid", "-u", "--uid"] }],
  ["chrt", { values: ["-T", "--sched-runtime", "-P", "--sched-period", "-D", "--sched-deadline"], operands: 1 }],
  ["flock", {
    values: ["-w", "--wait", "--timeout", "-E", "--conflict-exit-code", "-c", "--command"],
    shell: ["-c", "--command"],
    operands: 1,
    writesOperands: true
  }]
]);
var WRAPPER_WORDS = WRAPPERS;
var SHELLS = /* @__PURE__ */ new Set(["bash", "sh", "zsh", "dash", "ksh"]);
var SHELL_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-o", "-O", "--rcfile", "--init-file"]);
var SHORT_OPTION_CLUSTER = /^[-+][A-Za-z0-9]+$/;
var ATTACHED_OPTION_NAME = /^[-+][oO][A-Za-z_]{2,}$/;
var COMMAND_STRING_FLAG = /^-[A-Za-z0-9]*c/;
var DYNAMIC_SCRIPT = /\$\(|`|\$[A-Za-z_{0-9@*#?!$-]/;
var MAX_NESTED_DEPTH = 5;
var MAX_GROUP_DEPTH = 64;
var MAX_WRAPPERS = 64;
var MAX_START_READINGS = 64;
var PIPES = ["|", "|&"];
var KEYWORDS = /* @__PURE__ */ new Set(["if", "then", "elif", "else", "fi", "do", "done", "while", "until", "!"]);
var CD_PREFIXES = /* @__PURE__ */ new Set(["command", "builtin", "time", "noglob", "nocorrect", "-"]);
var ReadingLimit2 = class extends Error {
};
var OUTPUT_REDIRECT = /^[0-9]*(?:>>?[|!]?|<>)$|^&>>?[|!]?$|^>>?&[|!]$/;
var FD_DUPLICATION = /^&(?:[0-9]+-?|-)$/;
var ASSIGNMENT2 = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\n]{0,256}?\](?=\+?=))?\+?=/;
var ASSIGNMENT_PARTS = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\n]{0,256}?)\](?=\+?=))?(\+?)=/;
function assignmentOf(word) {
  const match = ASSIGNMENT_PARTS.exec(word);
  if (match === null) return null;
  return { name: match[1], index: match[2] ?? null, append: match[3] === "+", value: word.slice(match[0].length) };
}
var URL_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;
var USER_AT_HOST = /^[^@/\s]+@([^:/\s]+)/;
var BARE_HOST = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?:\/|$)/;
var PUSH_LIKE = /* @__PURE__ */ new Set(["send-pack", "http-push"]);
var PUSH_PROGRAMS = /* @__PURE__ */ new Set(["git-push", "git-send-pack", "git-http-push"]);
var SUBTREE_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-P", "--prefix", "-m", "--message", "-b", "--branch", "--onto"]);
var GIT_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--attr-source",
  "--shallow-file",
  "--exec-path",
  "--list-cmds",
  "--super-prefix"
]);
var GIT_FLAG_OPTIONS = /* @__PURE__ */ new Set([
  "-v",
  "--version",
  "-h",
  "--help",
  "-p",
  "--paginate",
  "-P",
  "--no-pager",
  "--no-replace-objects",
  "--no-lazy-fetch",
  "--no-optional-locks",
  "--no-advice",
  "--bare",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
  "--html-path",
  "--man-path",
  "--info-path"
]);
var HOME_UNKNOWN = `${UNKNOWN}~`;
function setsHome(cmd) {
  return /(^|[^$\w{])HOME\b/.test(cmd);
}
function cdpathSetUnseen(cmd) {
  return /cdpath/i.test(cmd) && expansionSet(cmd, (name) => name === "CDPATH" || name === "cdpath") !== null;
}
function readCommand(cmd, cwd, home, caseInsensitive = false, toplevel, readFile, cdpath, follow = false, trustedSources = NO_TRUSTED_SOURCES, env = {}) {
  const reading = {
    home: setsHome(cmd) ? HOME_UNKNOWN : home,
    budget: new ReadBudget(),
    unreadable: null,
    caseInsensitive,
    toplevel: toplevel ?? null,
    readFile: readFile ?? null,
    written: /* @__PURE__ */ new Set(),
    files: /* @__PURE__ */ new Map(),
    scriptCommands: /* @__PURE__ */ new Map(),
    scanned: 0,
    startReadings: 0,
    cdpath: cdpath === void 0 ? null : compactCdpath(cdpath.split(":")),
    cdpathSetUnseen: cdpathSetUnseen(cmd),
    tmpdirSet: /(^|[^$\w{])TMPDIR\b/.test(cmd),
    trustedSources: sourcesFor(cmd, trustedSources),
    raw: /* @__PURE__ */ new WeakMap(),
    opaque: /* @__PURE__ */ new WeakSet(),
    arrays: /* @__PURE__ */ new Set(),
    tempHead: /* @__PURE__ */ new WeakSet(),
    env,
    follow
  };
  try {
    const parts = readTokens(tokensOf(cmd, reading), cwd, reading, 0, false, follow ? cmd : null);
    return reading.unreadable === null ? { parts } : { unreadable: true, reason: reading.unreadable, limit: false, parts };
  } catch (err) {
    if (err instanceof ReadingLimit2) return { unreadable: true, reason: err.message, limit: true, parts: [] };
    throw err;
  }
}
function tokensOf(cmd, reading) {
  const result = tokenize(cmd, reading.home, reading.budget);
  if ("unreadable" in result) {
    if (result.limit) throw new ReadingLimit2(result.reason);
    reading.unreadable ??= result.reason;
  }
  for (const token of result.tokens) {
    const at = token.kind === "word" ? sourceOf(token) : void 0;
    if (at !== void 0) reading.raw.set(token, cmd.slice(at.start, at.end));
  }
  addArrayNames(result.tokens, reading.arrays);
  if (modifiedVariable(cmd) || readsArray(cmd, reading.arrays)) markOpaque(result.tokens, cmd, reading.opaque, reading.arrays);
  if (!reading.tmpdirSet) markTempHeads(result.tokens, cmd, reading.tempHead);
  return result.tokens;
}
function markTempHeads(tokens, cmd, tempHead) {
  for (const token of tokens) {
    if (token.kind !== "word") continue;
    if (token.scripts !== void 0) for (const script of token.scripts) markTempHeads(script, cmd, tempHead);
    const at = sourceOf(token);
    const raw = at === void 0 ? "" : cmd.slice(at.start, at.end).replaceAll('"', "");
    if (MKTEMP_IN_TMPDIR.test(raw) && !raw.includes("..")) tempHead.add(token);
  }
}
var MODIFIED_VARIABLE = /\$(?:[~=^+#]+\{?[A-Za-z_0-9@*#?!$-]|(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?!$-])[:[]|\{[~=^+#]*(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?!$-])[:[=?+-])/;
var BARE_SUBSCRIPT = /^"?\$([A-Za-z_][A-Za-z0-9_]*)\[[^\]"$`\\]*\]"?$/;
function expandedText(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") {
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else {
      if (c === '"') quote = quote === '"' ? null : '"';
      out += c;
    }
  }
  return out;
}
function modifiedVariable(text) {
  return MODIFIED_VARIABLE.test(expandedText(text));
}
var VARIABLE_READ = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;
var ARRAY_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)\+?=$/;
function addArrayNames(tokens, arrays) {
  tokens.forEach((token, n) => {
    if (token.kind !== "word") return;
    if (token.scripts !== void 0) for (const script of token.scripts) addArrayNames(script, arrays);
    const next = tokens[n + 1];
    const name = ARRAY_ASSIGNMENT.exec(token.value)?.[1];
    if (name !== void 0 && next?.kind === "op" && next.value === "(") arrays.add(name);
  });
}
function readsArray(text, arrays) {
  if (arrays.size === 0) return false;
  return [...expandedText(text).matchAll(VARIABLE_READ)].some((m) => arrays.has(m[1]));
}
function markOpaque(tokens, cmd, opaque, arrays) {
  for (const token of tokens) {
    tick();
    if (token.kind === "op") continue;
    if (token.scripts !== void 0) for (const script of token.scripts) markOpaque(script, cmd, opaque, arrays);
    if (token.kind === "redirect" && (token.op === "<<" || token.op === "<<-")) continue;
    const at = sourceOf(token);
    const raw = at === void 0 ? null : cmd.slice(at.start, at.end);
    if (raw === null) {
      opaque.add(token);
      continue;
    }
    const bare = BARE_SUBSCRIPT.exec(raw);
    if (modifiedVariable(raw) && (bare === null || neverFollowed(bare[1])) || readsArray(raw, arrays)) opaque.add(token);
  }
}
function opaqueValue(value, raw) {
  if (value.includes(UNKNOWN)) return value.slice(0, value.indexOf(UNKNOWN)) + UNKNOWN;
  const start = (raw ?? "").split("$")[0].replaceAll('"', "");
  return (/^[A-Za-z0-9_./@+,=-]*$/.test(start) ? start : "") + UNKNOWN;
}
var PLUGIN_ROOT_SET = /(?:^|[^${\w])CLAUDE_PLUGIN_ROOT\b|\$\{CLAUDE_PLUGIN_ROOT:?[=?]|\beval\b/;
var PLUGIN_HOOK_WORD = /^(["']?)\$(?:CLAUDE_PLUGIN_ROOT|\{CLAUDE_PLUGIN_ROOT\})\/hooks\/([A-Za-z0-9_][A-Za-z0-9._-]*)\1$/;
function trustedSource(token, reading) {
  if (token === void 0 || token.kind !== "word") return false;
  return trustedSourceWord(token.value, reading.raw.get(token), reading.home, reading.trustedSources);
}
function trustedSourceWord(word, raw, home, trustedSources) {
  if (word.includes(UNKNOWN)) return trustedSources.pluginRootVariable && raw !== void 0 && PLUGIN_HOOK_WORD.test(raw);
  if (!(word.startsWith("/") || word.startsWith("~/")) || /[*?[]/.test(word) || word.split("/").some((p) => p === "." || p === "..")) return false;
  if (word.startsWith("~/") && home === HOME_UNKNOWN) return false;
  const file = expandTilde(word, home);
  return trustedSources.folders.some((folder) => file.startsWith(`${folder}/`) && file.length > folder.length + 1);
}
function sourcesFor(cmd, trustedSources) {
  return { ...trustedSources, pluginRootVariable: trustedSources.pluginRootVariable && !PLUGIN_ROOT_SET.test(cmd) };
}
function readScript(cmd, cwd, reading, depth, dots = false, optionSet = null) {
  return readTokens(tokensOf(cmd, reading), cwd, reading, depth, dots, null, optionSet);
}
function readTokens(tokens, cwd, reading, depth, dots = false, text = null, optionSet = null) {
  const opaque = (token) => reading.opaque.has(token) ? opaqueValue(token.kind === "word" ? token.value : token.target, reading.raw.get(token)) : null;
  const segments = split(tokens, cwd, reading.home, reading.toplevel, dots, reading.cdpath, reading.cdpathSetUnseen, text, reading.tmpdirSet, (token) => trustedSource(token, reading), reading.env, reading.follow, opaque, optionSet);
  return segments.flatMap((segment) => toParts(segment, segments, reading, depth));
}
var TOPLEVEL_WORDS = ["git", "rev-parse", "--show-toplevel"];
function isToplevelWord(token) {
  const script = token.scripts?.length === 1 ? token.scripts[0] : null;
  return token.value === UNKNOWN && script !== null && script.length === TOPLEVEL_WORDS.length && script.every((t, n) => t.kind === "word" && t.value === TOPLEVEL_WORDS[n]);
}
var VARIABLE_BUILTINS = /* @__PURE__ */ new Set(["export", "declare", "typeset", "readonly", "local"]);
var DISCOVERY_SAFE_GIT = /^(?:GIT_NO_REPLACE_OBJECTS|GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)|GIT_TRACE[A-Za-z0-9_]*)(?:=|$)/;
function gitDiscoveryWord(w) {
  return w.startsWith("GIT_") && !DISCOVERY_SAFE_GIT.test(w);
}
function setsGitVariable(commandWords, assigned) {
  if (commandWords.length === 0 && assigned.some(gitDiscoveryWord)) return true;
  return VARIABLE_BUILTINS.has(commandWords[0] ?? "") && commandWords.slice(1).some(gitDiscoveryWord);
}
var GLOB_DOTS = "globdots";
var DOTGLOB = "dotglob";
var GLOBIGNORE = "GLOBIGNORE";
var GLOB_DOTS_LETTER = "4";
function zshOption(word) {
  return word.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}
function dotsOption(name) {
  const option = zshOption(name);
  return option === GLOB_DOTS || option === DOTGLOB;
}
function noDotsOption(name) {
  const option = zshOption(name);
  return option.startsWith("no") && dotsOption(option.slice(2));
}
var BASHOPTS = "BASHOPTS";
function bashoptsDots(value) {
  return value.includes(UNKNOWN) || value.split(":").includes(DOTGLOB);
}
function optionChanges(args, toEnd = false) {
  const changes = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--" || a === "-" || !a.startsWith("-") && !a.startsWith("+")) {
      if (toEnd) continue;
      break;
    }
    const on = a.startsWith("-");
    if (a.startsWith("--")) {
      if (SHELL_VALUE_OPTIONS.has(a)) i++;
      else changes.push({ on, name: a.slice(2) });
      continue;
    }
    if (ATTACHED_OPTION_NAME.test(a)) changes.push({ on, name: a.slice(2) });
    for (const letter of a.slice(1)) changes.push({ on, name: letter === "o" || letter === "O" ? args[++i] ?? "" : letter });
  }
  return changes;
}
function dotsAfterChange({ on, name }) {
  if (name.includes(UNKNOWN)) return true;
  if (name === GLOB_DOTS_LETTER || dotsOption(name)) return on;
  if (noDotsOption(name)) return !on;
  return null;
}
function shellDots(name, args, assignments, values) {
  if (name === null || !SHELLS.has(name)) return false;
  if (assignments.some((a, n) => a === BASHOPTS && bashoptsDots(values[n] ?? ""))) return true;
  if (assignments.some((a, n) => a === GLOBIGNORE && (values[n] ?? "") !== "")) return true;
  return optionChanges(args).some((change) => dotsAfterChange(change) === true);
}
var ZSH_OPTIONS = "options";
function optionsArrayDots(word) {
  const assignment = assignmentOf(word);
  if (assignment === null || assignment.name !== ZSH_OPTIONS || assignment.index === null) return null;
  const value = assignment.value.toLowerCase();
  if (value.includes(UNKNOWN)) return true;
  if (value !== "on" && value !== "off") return null;
  return dotsAfterChange({ on: value === "on", name: assignment.index });
}
function dotGlobAfter(commandWords, assigned, on) {
  let p = 0;
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  const set = [...program === void 0 ? assigned : [], ...VARIABLE_BUILTINS.has(program ?? "") ? args : []].flatMap((w) => {
    const assignment = assignmentOf(w);
    return assignment === null ? [] : [{ word: w, ...assignment }];
  });
  if (set.some((a) => a.name === GLOBIGNORE)) return true;
  if (set.some((a) => a.name === BASHOPTS && bashoptsDots(a.value))) return true;
  for (const a of set) on = optionsArrayDots(a.word) ?? on;
  if (program === "eval") {
    const text = args.join(" ");
    if (text.includes(UNKNOWN) || /dot_?glob|glob_?dots/i.test(text)) return true;
  }
  const names = args.filter((w) => !/^[-+]/.test(w));
  if (program === "shopt") {
    const mode = args.includes("-s") ? true : args.includes("-u") ? false : null;
    if (mode === null) return on;
    if (names.some((w) => w.includes(UNKNOWN))) return on || mode;
    return names.includes(DOTGLOB) ? mode : on;
  }
  if (program === "setopt" || program === "unsetopt") {
    const setting = program === "setopt";
    if (args.some((w) => w.startsWith("-") && w.includes(GLOB_DOTS_LETTER))) return true;
    for (const name of names) {
      if (name.includes(UNKNOWN)) return true;
      if (dotsOption(name)) on = setting;
      else if (noDotsOption(name)) on = !setting;
    }
    return on;
  }
  if (program === "set" || program === "emulate") {
    for (const change of optionChanges(args, program === "emulate")) on = dotsAfterChange(change) ?? on;
  }
  return on;
}
var SAFE_OPTIONS = /* @__PURE__ */ new Set([
  "errexit",
  "unset",
  "pipefail",
  "xtrace",
  "verbose",
  "errtrace",
  "functrace",
  "glob",
  "clobber",
  "nomatch",
  "nullglob",
  "failglob",
  "braceexpand",
  "localoptions",
  "localtraps",
  GLOB_DOTS,
  DOTGLOB,
  // round 15, D-R14-4: options that change no path the gate reads; extendedglob's `#^~` are read as wildcards
  "allexport",
  "globstar",
  "errreturn",
  "interactivecomments",
  "vi",
  "emacs",
  "extendedglob"
]);
var EXTENDED_GLOB = "extendedglob";
var SAFE_OPTION_LETTERS = /* @__PURE__ */ new Set(["e", "u", "x", "v", "f", "C", "E", "B", "a", GLOB_DOTS_LETTER]);
var SAFE_SHOPT = /* @__PURE__ */ new Set([DOTGLOB, "nullglob", "failglob", "extglob", "globstar", "interactive_comments"]);
var FULL_OPTIONS = /* @__PURE__ */ new Set(["cdablevars", "globsubst", "braceccl", "magicequalsubst", "autocd"]);
var FULL_OPTION_LETTERS = /* @__PURE__ */ new Set(["T", "J"]);
function safeOption(name) {
  if (name.includes(UNKNOWN)) return false;
  const option = zshOption(name);
  return option === "" || SAFE_OPTIONS.has(option) || option.startsWith("no") && SAFE_OPTIONS.has(option.slice(2));
}
function worse(a, b) {
  return a === "full" || b === "full" ? "full" : a ?? b;
}
function nameKind(name) {
  if (name.includes(UNKNOWN)) return "full";
  const option = zshOption(name);
  if (FULL_OPTIONS.has(option) || option.startsWith("no") && FULL_OPTIONS.has(option.slice(2))) return "full";
  return safeOption(name) ? null : "partial";
}
function letterKind(letter) {
  if (FULL_OPTION_LETTERS.has(letter)) return "full";
  return SAFE_OPTION_LETTERS.has(letter) ? null : "partial";
}
function shoptKind(name) {
  if (name.includes(UNKNOWN)) return "full";
  if (SAFE_SHOPT.has(name)) return null;
  return nameKind(name) === "full" ? "full" : "partial";
}
function emulateMode(args) {
  const mode = [];
  let script = null;
  for (let i = 0; i < args.length; i++) {
    if (/^-[A-Za-z]*c$/.test(args[i]) && i + 1 < args.length) {
      mode.push(...args[i].length > 2 ? [args[i].slice(0, -1)] : []);
      script = args[++i];
    } else {
      mode.push(args[i]);
    }
  }
  return { mode, script };
}
function emulateKind(mode) {
  return mode.length > 0 && mode.every((w) => w === "zsh" || w === "-L" || w === "-R" || w === "-LR") ? null : "full";
}
function optionEffect(commandWords, assigned) {
  let p = 0;
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  let kind = null;
  const names = [];
  const set = [...program === void 0 ? assigned : [], ...VARIABLE_BUILTINS.has(program ?? "") ? args : []];
  for (const word of set) {
    const assignment = assignmentOf(word);
    if (assignment?.name !== ZSH_OPTIONS) continue;
    if (assignment.index === null) kind = "full";
    else names.push(assignment.index);
  }
  if (program === "setopt" || program === "unsetopt") {
    for (let i = 0; i < args.length; i++) {
      const w = args[i];
      if (w === "-o" || w === "+o") names.push(args[++i] ?? "");
      else if (!/^[-+]/.test(w)) names.push(w);
      else for (const letter of w.slice(1)) kind = worse(kind, letter === "m" ? "full" : letterKind(letter));
    }
  } else if (program === "shopt") {
    if (args.some((w) => w === "-s" || w === "-u" || /^-[A-Za-z]*[su]/.test(w))) {
      const shellOptions = args.some((w) => /^-[A-Za-z]*o/.test(w));
      for (const w of args.filter((a) => !a.startsWith("-"))) {
        if (shellOptions) names.push(w);
        else kind = worse(kind, shoptKind(w));
      }
    }
  } else if (program === "emulate") {
    const { mode, script } = emulateMode(args);
    if (script === null) kind = worse(kind, emulateKind(mode));
    if (mode.some((w) => zshOption(w).includes(EXTENDED_GLOB))) names.push(EXTENDED_GLOB);
  } else if (program === "set") {
    for (const { name } of optionChanges(args)) {
      if (name.length === 1) kind = worse(kind, letterKind(name));
      else names.push(name);
    }
  }
  for (const name of names) kind = worse(kind, nameKind(name));
  return { kind, extended: names.some((name) => name.includes(UNKNOWN) || zshOption(name).endsWith(EXTENDED_GLOB)) };
}
var SHELL_START_LETTERS = /* @__PURE__ */ new Set(["c", "i", "l", "s", "r"]);
var SAFE_SHELL_LONG = /* @__PURE__ */ new Set(["norc", "noprofile", "login", "noediting", "restricted", "verbose"]);
function shellSetsUnknownOption(name, args) {
  if (name === null || !SHELLS.has(name)) return null;
  let kind = null;
  const named2 = (option) => zshOption(option).endsWith(EXTENDED_GLOB) ? "partial" : nameKind(option);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--" || a === "-" || !/^[-+]/.test(a)) break;
    if (a.startsWith("--")) {
      if (SHELL_VALUE_OPTIONS.has(a)) i++;
      else if (!SAFE_SHELL_LONG.has(a.slice(2))) kind = worse(kind, named2(a.slice(2)));
      continue;
    }
    if (ATTACHED_OPTION_NAME.test(a)) {
      kind = worse(kind, a[1] === "O" ? shoptKind(a.slice(2)) : named2(a.slice(2)));
      continue;
    }
    for (const letter of a.slice(1)) {
      if (letter === "o" || letter === "O") {
        const option = args[++i] ?? "";
        kind = worse(kind, letter === "O" ? shoptKind(option) : named2(option));
      } else if (!SHELL_START_LETTERS.has(letter)) {
        kind = worse(kind, letterKind(letter));
      }
    }
  }
  return kind;
}
var WILD_VALUE = /[*?[#^(<]/;
function valuePattern(value) {
  return value.replace(/[!@+*?]?\([^)]*\)?/g, "*").replace(/<[^>]*>?/g, "*").replace(/[#^]/g, "*");
}
var TIMED_GROUP = /^time(?: -p+)*$/;
var COMPOUND_OPEN = /* @__PURE__ */ new Set(["if", "while", "until"]);
var COMPOUND_CLOSE = /* @__PURE__ */ new Set(["fi", "done"]);
var FORGET_AT = /* @__PURE__ */ new Set(["else", "elif", "fi", "do", "done", "while", "until"]);
var FORGET_OPS = /* @__PURE__ */ new Set(["||", "|", "|&", "&", ";;", ";&", ";;&", "(", ")"]);
var SPECIAL_PARAMETERS = /* @__PURE__ */ new Set(["$", "!", "?", "#"]);
var SCRIPT_PREFIXES = /* @__PURE__ */ new Set(["builtin", "command", "noglob", "nocorrect", "-"]);
function scriptOperandNext(words) {
  const command = stripAssignments(words);
  let i = 0;
  while (SCRIPT_PREFIXES.has(command[i])) i++;
  const rest = command.slice(i + 1);
  if (command[i] === "sched") return rest.some((w) => !/^-[A-Za-z]+$/.test(w));
  if (command[i] === "trap") {
    let j = 0;
    while (j < rest.length && /^-[lp]+$/.test(rest[j])) j++;
    if (rest[j] === "--") j++;
    return j === rest.length;
  }
  return command[i] === "emulate" && emulateMode(rest).script === null && /^-[A-Za-z]*c$/.test(rest.at(-1) ?? "");
}
var CANNOT_EXPAND = "a `trap` or `emulate -c` string that holds a value only known when it runs";
var REFERENCED_NAME = /\$\{?(?:\([^)]*\))?[#!=~^+]*([A-Za-z_][A-Za-z0-9_]*)/g;
var LATER_VALUE = /^[A-Za-z0-9_./@+:,-]+$/;
var SETTLED_VALUE = /(?:([A-Za-z0-9_./@+:,-]+)|"([A-Za-z0-9_./@+:,-]*)"|'([A-Za-z0-9_./@+:,-]*)'|\$[?!]|)(?=$|[\s;&|)])/y;
var MKTEMP_VALUE = /("?)(?:\$\(mktemp((?:[ \t]+[^\s()`;&|]+)*)[ \t]*\)|`mktemp((?:[ \t]+[^\s()`;&|]+)*)[ \t]*`)\1(?=$|[\s;&|)])/y;
var MKTEMP_LITERAL = /^(?:~(?=\/|$))?[A-Za-z0-9_./@+:,-]*$/;
var MKTEMP_IN_TMPDIR = /^\$(?:TMPDIR|\{TMPDIR(?::?-[A-Za-z0-9_./-]*)?\})(?:\/[A-Za-z0-9_./@+:,-]*)?$/;
var MKTEMP_DEFAULT = "tmp.XXXXXXXXXX";
var MKTEMP_LONG = /* @__PURE__ */ new Map([
  ["directory", "d"],
  ["dry-run", "u"],
  ["quiet", "q"],
  ["tmpdir", "p"],
  ["suffix", "s"]
]);
function mktempWords(words) {
  const read = { inTemp: false, folder: false };
  const unquoted = (w) => /^(["']).*\1$/s.test(w) ? w.slice(1, -1) : w;
  for (let i = 0; i < words.length; i++) {
    const w = unquoted(words[i]);
    if (w.startsWith("--")) {
      const eq = w.indexOf("=");
      const given = eq === -1 ? w.slice(2) : w.slice(2, eq);
      const matches = [...MKTEMP_LONG.keys()].filter((full) => given !== "" && full.startsWith(given));
      if (matches.length !== 1) return null;
      const option = MKTEMP_LONG.get(matches[0]);
      const value = eq === -1 ? void 0 : w.slice(eq + 1);
      if (option === "p") {
        if (value === void 0) read.inTemp = true;
        else read.dir = value;
      } else if (option === "s") {
        const suffix = value ?? (words[i + 1] === void 0 ? void 0 : unquoted(words[++i]));
        if (suffix === void 0 || suffix.includes("/") || read.suffix !== void 0) return null;
        read.suffix = suffix;
      } else if (value !== void 0) {
        return null;
      } else if (option === "d") {
        read.folder = true;
      }
      continue;
    }
    if (!/^-./.test(w)) {
      if (read.template !== void 0) return null;
      read.template = w;
      continue;
    }
    for (let n = 1; n < w.length; n++) {
      const c = w[n];
      if (c === "d") read.folder = true;
      if ("dqu".includes(c)) continue;
      if (c !== "t" && c !== "p") return null;
      let value = w.slice(n + 1);
      if (value === "") value = words[i + 1] !== void 0 && !words[i + 1].startsWith("-") ? unquoted(words[++i]) : void 0;
      if (c === "p") {
        if (value === void 0) return null;
        read.dir = value;
      } else {
        read.inTemp = true;
        if (value !== void 0) {
          if (read.template !== void 0 || value.includes("/")) return null;
          read.template = value;
        }
      }
      break;
    }
  }
  return read;
}
function mktempPattern(words, home, tmpdirSet) {
  const read = mktempWords(words);
  if (read === null) return null;
  const { dir, inTemp: inTemp3, suffix } = read;
  let { template } = read;
  if (suffix !== void 0) template = (template ?? MKTEMP_DEFAULT) + suffix;
  const temp = (w) => w !== void 0 && MKTEMP_IN_TMPDIR.test(w);
  const inTempFolder = dir === void 0 ? inTemp3 : temp(dir);
  if (inTempFolder && template?.includes("/") === true) return null;
  if (temp(template) || inTempFolder || dir === void 0 && template === void 0) return tmpdirSet ? null : "";
  for (const w of [dir, template]) if (w !== void 0 && !MKTEMP_LITERAL.test(w)) return null;
  const expand3 = (w) => !w.startsWith("~") ? w : home.includes(UNKNOWN) ? null : home + w.slice(1);
  const name = expand3(template ?? MKTEMP_DEFAULT);
  const folder = dir === void 0 ? void 0 : expand3(dir);
  if (name === null || folder === null) return null;
  const full = folder === void 0 || name.startsWith("/") ? name : import_node_path3.default.posix.join(folder, name);
  return full.replace(/X+/g, MKTEMP_ANY);
}
function mktempWrites(args, tempArgs) {
  const read = mktempWords(args);
  if (read === null) return [];
  const { dir } = read;
  const writtenInTemp = (w) => tempArgs[args.lastIndexOf(w)];
  const template = (read.template ?? MKTEMP_DEFAULT) + (read.suffix ?? "");
  if ((dir === void 0 ? read.inTemp : writtenInTemp(dir)) && template.includes("/")) return [UNKNOWN];
  if (dir === void 0 && (read.template === void 0 || read.inTemp)) return [];
  const made = dir === void 0 || template.startsWith("/") ? template : import_node_path3.default.posix.join(dir, template);
  const folder = dir !== void 0 && dir.includes(UNKNOWN) && !/^[/]*$/.test(dir.slice(dir.lastIndexOf(UNKNOWN) + UNKNOWN.length)) ? [dir] : [];
  return [made, ...folder];
}
var MKTEMP_ANY = "";
var MAX_SCRIPT_VARIANTS = 16;
function settledValues(text, name, span, home) {
  if (neverFollowed(name)) return null;
  const values = /* @__PURE__ */ new Set();
  let found2 = 0;
  let inValues = 0;
  for (const m of text.matchAll(new RegExp(`(?<![A-Za-z0-9_])${name}=`, "g"))) {
    tick();
    const inside3 = m.index >= span.start && m.index < span.end;
    let at = m.index - 1;
    while (at >= 0 && (text[at] === " " || text[at] === "	")) at--;
    const start = at < 0 || at === span.start || ";&|({\n".includes(text[at]) && !(text[at] === "{" && text[at - 1] === "$");
    if (!start) {
      if (inside3) continue;
      return null;
    }
    const from = m.index + m[0].length;
    MKTEMP_VALUE.lastIndex = from;
    const made = MKTEMP_VALUE.exec(text);
    if (made !== null) {
      if (!inside3) inValues += plainMentionsIn(text, name, from, from + made[0].length);
      const pattern = mktempPattern((made[2] ?? made[3]).trim().split(/[ \t]+/).filter(Boolean), home, plainMentions(text, "TMPDIR") > 0);
      if (pattern === null) return null;
      if (pattern !== "") values.add(pattern);
      if (!inside3) found2++;
      continue;
    }
    SETTLED_VALUE.lastIndex = from;
    const value = SETTLED_VALUE.exec(text);
    if (value === null) return null;
    const plain = value[1] ?? value[2] ?? value[3];
    if (plain !== void 0 && plain !== "") values.add(plain);
    if (inside3) continue;
    inValues += plainMentionsIn(text, name, from, from + value[0].length);
    found2++;
  }
  return found2 + inValues === plainMentions(text, name) - plainMentionsIn(text, name, span.start, span.end) ? [...values] : null;
}
function filledReferences(script, values) {
  let out = "";
  let quote = null;
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") {
      out += script.slice(i, i + 2);
      i++;
      continue;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === "$") {
      VARIABLE_REFERENCE.lastIndex = i + 1;
      const match = VARIABLE_REFERENCE.exec(script);
      const value = match === null ? void 0 : values.get(match[1] ?? match[2]);
      if (match !== null && value !== void 0) {
        out += value.split(MKTEMP_ANY).join(quote === '"' ? '"*"' : "*");
        i += match[0].length;
        continue;
      }
    }
    out += c;
  }
  return [...out.matchAll(REFERENCED_NAME)].some(([, name]) => values.has(name)) ? null : out;
}
var VARIABLE_REFERENCE = /\{([A-Za-z_][A-Za-z0-9_]*)\}(?![[:{])|([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_[:{])/y;
function variableReferences(raw, home, specials = false) {
  const refs = [];
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") {
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === "`") {
      return null;
    } else if (c === "$" && specials && SPECIAL_PARAMETERS.has(raw[i + 1] ?? "")) {
      refs.push({ name: raw[i + 1], quoted: quote === '"' });
      i++;
    } else if (c === "$") {
      VARIABLE_REFERENCE.lastIndex = i + 1;
      const match = VARIABLE_REFERENCE.exec(raw);
      if (match === null) return null;
      const name = match[1] ?? match[2];
      if (name === "HOME") {
        if (home.includes(UNKNOWN)) return null;
      } else {
        refs.push({ name, quoted: quote === '"' });
      }
      i += match[0].length;
    }
  }
  return refs;
}
var TOPLEVEL_VALUE = /^("?)\$\(git rev-parse --show-toplevel\)\1$/;
var NEW_TEMP_VALUE = /^("?)\$\(mktemp( -d)?(?: -t [A-Za-z0-9._-]+)?\)\1$/;
var PLAIN_VALUE2 = /^(?:[A-Za-z0-9_./@+:,-]+|'[^'\n]*'|"(?:[^"$`\\\n]|\$HOME\b|\$\{HOME\})*")$/;
var HOME_HEAD = /^(?:\$HOME|\$\{HOME\}|~)(?=\/|$)/;
var NEW_TEMP_FOLDER = "oss-tool-gate-mktemp-folder";
var NEW_TEMP_FILE = "oss-tool-gate-mktemp-file";
function isNewTempFile(token, tmpdirSet) {
  const value = token.kind === "word" ? token.value : token.target;
  const script = token.scripts?.length === 1 ? token.scripts[0] : null;
  if (tmpdirSet || value !== UNKNOWN || script === null) return false;
  const words = script.map((t) => t.kind === "word" ? t.value : null);
  return words.length === 1 && words[0] === "mktemp" || words.length === 3 && words[0] === "mktemp" && words[1] === "-t" && /^[A-Za-z0-9._-]+$/.test(words[2] ?? "");
}
var DESTINATION_WRITERS = /* @__PURE__ */ new Set(["cp", "ln", "install", "ditto", "rsync"]);
function markedWrites(marked, segment, words, name, redirected, operandsWritten) {
  const { words: at, redirects } = marked;
  const offset = segment.words.length - words.length;
  const suffix = offset >= 0 && words.every((w, n) => segment.words[offset + n] === w);
  const substitutedAt = (n) => at.has(offset + n);
  const operands2 = operandsWritten.filter((p) => {
    const places = words.flatMap((w, n) => n > 0 && (w === p || w.endsWith(`=${p}`)) ? [n] : []);
    if (places.length === 0) return false;
    if (!suffix) return at.size > 0 && p.includes(UNKNOWN);
    return name !== null && DESTINATION_WRITERS.has(name) ? substitutedAt(places[places.length - 1]) : places.some(substitutedAt);
  });
  return [...redirected.filter((p) => redirects.has(p)), ...operands2];
}
var SHELL_STATE_BUILTINS = /* @__PURE__ */ new Set([
  "cd",
  "pushd",
  "popd",
  "source",
  ".",
  "alias",
  "unalias",
  "eval",
  "shopt",
  "setopt",
  "unsetopt",
  "set",
  "trap",
  "enable",
  "disable",
  "exec",
  "builtin",
  "command",
  "export",
  "declare",
  "typeset",
  "local",
  "readonly",
  "unset",
  "emulate",
  "hash",
  "autoload",
  "zmodload",
  "function",
  "functions"
]);
function evalMayMove(commandWords) {
  const at = commandWords.indexOf("eval");
  const text = commandWords.slice(at + 1).join(" ");
  if (text.includes(UNKNOWN) || !/^[A-Za-z0-9_.,:/@%+= -]*$/.test(text)) return true;
  const first = text.trim().split(/ +/)[0] ?? "";
  return first === "" || first.includes("=") || SHELL_STATE_BUILTINS.has(first.toLowerCase());
}
var LAUNCHERS = /* @__PURE__ */ new Set(["eval", "source", ".", "exec", "command", "builtin", "xargs", "trap", "emulate", "sched"]);
function trapScript(args) {
  let i = 0;
  while (i < args.length && /^-[lp]+$/.test(args[i])) i++;
  if (args[i] === "--") i++;
  const script = args[i];
  return script === void 0 || script === "-" ? null : script;
}
function schedScript(args) {
  let i = 0;
  while (i < args.length && /^-[A-Za-z]+$/.test(args[i])) i++;
  const command = args.slice(i + 1);
  return command.length === 0 ? null : command.join(" ");
}
var ZSH_FUNCTIONS = "functions";
function functionsBodies(commandWords, assigned) {
  let p = 0;
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  const set = program === void 0 ? assigned : VARIABLE_BUILTINS.has(program) ? args : [];
  return set.flatMap((word) => {
    const assignment = assignmentOf(word);
    if (assignment?.name !== ZSH_FUNCTIONS) return [];
    return [assignment.index === null ? UNKNOWN : assignment.value];
  });
}
var MOVING_COMMAND = /(?:^|[;&|(){}\n]|\b(?:then|do|else)\b)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:cd|pushd|popd|source|\.|eval|alias|unalias|enable|disable|unfunction|builtin|command|exec|setopt|unsetopt|shopt|set|emulate|trap|repeat|noglob|nocorrect|-|autoload|hash|functions(?:\[[^\]]*\])?\+?=)(?=$|[\s;&|(){}])/;
var DYNAMIC_COMMAND = /(?:^|[;&|(){}\n]|\b(?:then|do|else)\b)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*["']?[$`]/;
function scriptMayMove(script) {
  return script.includes(UNKNOWN) || DYNAMIC_COMMAND.test(script) || MOVING_COMMAND.test(script);
}
var FOLDER_BUILTINS = /* @__PURE__ */ new Set(["cd", "pushd", "popd", "builtin", "command"]);
function switchesOffFolderBuiltin(commandWords) {
  let p = 0;
  while (CD_PREFIXES.has(commandWords[p])) p++;
  const [program, ...args] = commandWords.slice(p);
  if (program !== "enable" && program !== "disable" && program !== "unfunction" && program !== "unalias") return false;
  const flags = args.filter((a) => a.startsWith("-"));
  if (program === "enable" && !flags.some((f) => f.includes("n"))) return false;
  if (flags.some((f) => f.includes("m"))) return true;
  return args.some((a) => !a.startsWith("-") && (a.includes(UNKNOWN) || /[*?[]/.test(a) || FOLDER_BUILTINS.has(a)));
}
function followedHere(words) {
  const command = stripAssignments(words);
  const first = command[0];
  if (first === void 0) return false;
  const name = plainWriterName(import_node_path3.default.posix.basename(first));
  if (name === "find" && command.some((w) => /^-(?:exec|execdir|ok|okdir)$/.test(w))) return false;
  return !WRAPPERS.has(name) && !SHELLS.has(name) && !LAUNCHERS.has(name);
}
function verbOf(words) {
  return words.find((w) => !CD_PREFIXES.has(w));
}
var HARMLESS_COMMANDS = /* @__PURE__ */ new Set(["cd", "git", "ls", "echo", "test", "[", "mkdir", "cp", "mv", "rm", "cat", "grep", "true", "false", ":", "chmod", "find", "touch"]);
var POSITIONAL = /\$\{?(?:[0-9@*#]|argv(?![A-Za-z0-9_]))/;
var HIDDEN_RUNNERS = /* @__PURE__ */ new Set(["eval", "source", ".", "alias", "unalias", "nameref", "enable", "disable", "zle", "zmodload"]);
var DECLARING_BUILTINS = /* @__PURE__ */ new Set(["export", "local", "typeset", "declare", "readonly", "integer", "float", "private"]);
var NAME_SETTERS = /* @__PURE__ */ new Set([
  "read",
  "vared",
  "unset",
  "mapfile",
  "readarray",
  "getln",
  "zparseopts",
  "zstyle",
  "zformat",
  "sysread",
  "zregexparse",
  "zselect",
  "zsocket",
  "ztcp",
  "zpty",
  "compgen"
]);
var OPTION_SETTERS = /* @__PURE__ */ new Map([["printf", "v"], ["print", "v"], ["strftime", "s"], ["wait", "p"]]);
var LATER_PREFIXES = /* @__PURE__ */ new Set(["builtin", "noglob", "nocorrect", "-", "exec", "time", "coproc"]);
var LATER_KEYWORDS = /* @__PURE__ */ new Set([...KEYWORDS, "{", "}", "esac"]);
var LATER_HEADERS = /* @__PURE__ */ new Set(["[[", "case", "for", "select", "foreach", "function"]);
function laterChange(filled2) {
  const name = [...filled2.names][0] ?? "F";
  return new ReadingLimit2(`a later command could change \`$${name}\`; or write the trap with double quotes, e.g. \`trap "rm -rf $${name}" EXIT\``);
}
function writtenOut(word) {
  return !word.value.includes(UNKNOWN) && (word.raw === null || !/[$`]/.test(word.raw));
}
function reachesFilled(name, filled2) {
  return filled2.names.has(name) || name === "IFS" && filled2.splits || name === "argv" && filled2.positional || name === ZSH_FUNCTIONS || name === "dis_functions";
}
function setsRisky(word, filled2, afterEquals = false) {
  if (word === void 0) return false;
  if (!writtenOut(word)) return true;
  const text = afterEquals ? word.value.slice(word.value.lastIndexOf("=") + 1) : word.value;
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text)?.[0];
  return name !== void 0 && reachesFilled(name, filled2);
}
function assignmentRisky(word, filled2) {
  const assignment = assignmentOf(word);
  if (assignment === null || !reachesFilled(assignment.name, filled2)) return false;
  return !(filled2.settled.has(assignment.name) && assignment.index === null && !assignment.append);
}
var ARITHMETIC_ASSIGNED = /([A-Za-z_][A-Za-z0-9_]*)\s*(?:\*\*|<<|>>|[-+*/%&|^])?=(?!=)|(?:\+\+|--)\s*([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)\s*(?:\+\+|--)/g;
function arithmeticRisky(inside3, filled2) {
  if (/[$`]/.test(inside3) || inside3.includes(UNKNOWN)) return true;
  return [...inside3.matchAll(ARITHMETIC_ASSIGNED)].some((m) => reachesFilled(m[1] ?? m[2] ?? m[3], filled2));
}
var ARITHMETIC_START = /\(\(|\$\[|[A-Za-z0-9_}]\[/g;
var LOOP_NAME = /(?:^|[\s;&|(){}])(?:for|select|foreach)\s+([A-Za-z_][A-Za-z0-9_]*|[$`"'])/g;
function laterTextRisky(text, filled2) {
  if (text.length > MAX_LATER_TEXT) throw new ReadingLimit2(`more than ${MAX_LATER_TEXT / 1024} KB after a trap with a variable filled in`);
  if (parameterRisky(text)) return true;
  for (const [, name] of text.matchAll(LOOP_NAME)) if (!/^[A-Za-z_]/.test(name) || reachesFilled(name, filled2)) return true;
  const closes = matchingCloses(text);
  let readTo = -1;
  for (const m of text.matchAll(ARITHMETIC_START)) {
    tick();
    const open = m.index + m[0].length - 1;
    if (open < readTo) continue;
    readTo = closes[open];
    if (arithmeticRisky(text.slice(open + 1, readTo), filled2)) return true;
    if (readTo === text.length) break;
  }
  return false;
}
function parameterRisky(text) {
  const n = text.length;
  const nextStop = new Int32Array(n + 1).fill(n);
  const nextParen = new Int32Array(n + 1).fill(n);
  const nextP = new Int32Array(n + 1).fill(n);
  for (let i = n - 1; i >= 0; i--) {
    const c = text[i];
    nextStop[i] = c === "}" || c === ":" || c === "=" ? i : nextStop[i + 1];
    nextParen[i] = c === ")" ? i : nextParen[i + 1];
    nextP[i] = c === "P" ? i : nextP[i + 1];
  }
  const assigns = (at) => /^:{0,2}=/.test(text.slice(at, at + 3));
  for (let i = text.indexOf("${"); i !== -1; i = text.indexOf("${", i + 1)) {
    tick();
    const after = i + 2;
    if (text[after] === "!") return true;
    if (assigns(nextStop[after])) return true;
    if (text[after] === "(") {
      const close = nextParen[after + 1];
      if (nextP[after + 1] < close) return true;
      if (close < n && assigns(nextStop[close + 1])) return true;
    }
  }
  return false;
}
var MAX_LATER_TEXT = 64 * 1024;
function matchingCloses(text) {
  const closes = [];
  const stacks = { "(": [], "[": [] };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") stacks[c].push(i);
    else if (c === ")" || c === "]") {
      const opened = stacks[c === ")" ? "(" : "["].pop();
      if (opened !== void 0) closes[opened] = i;
    }
  }
  for (const stack of Object.values(stacks)) for (const opened of stack) closes[opened] = text.length;
  return closes;
}
var NAME_OPTION_LETTERS = /* @__PURE__ */ new Map([["read", "aA"], ["zparseopts", "aAF"], ["compgen", "V"]]);
function nameSetterRisky(name, args, filled2) {
  const letters = NAME_OPTION_LETTERS.get(name) ?? "";
  return args.some((a, n) => {
    if (!/^[-+]/.test(a.value)) return setsRisky(a, filled2, name === "zparseopts");
    if (!writtenOut(a)) return true;
    const at = [...a.value.slice(1)].findIndex((c) => letters.includes(c));
    if (at === -1) return false;
    const value = a.value.slice(at + 2);
    return value === "" ? setsRisky(args[n + 1], filled2) : setsRisky({ value, raw: null }, filled2);
  });
}
function setRisky(args, filled2) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].value;
    if (a.includes(UNKNOWN)) return true;
    if (a === "--" || !/^[-+]/.test(a)) return filled2.positional;
    if (/^[-+][A-Za-z]*A/.test(a)) return setsRisky(args[i + 1], filled2);
    if (/o$/.test(a)) i++;
  }
  return false;
}
function declarationRisky(args, filled2) {
  return args.some((word) => {
    if (/^[-+]/.test(word.value)) return word.value.includes(UNKNOWN) || word.value.slice(1).includes("n");
    const name = /^[A-Za-z_][A-Za-z0-9_]*(?=$|\+?=|\[)/.exec(word.raw ?? word.value)?.[0];
    return name === void 0 || reachesFilled(name, filled2);
  });
}
function optionSetterRisky(args, letter, filled2) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].value;
    if (a.includes(UNKNOWN)) return true;
    if (a === "--" || !/^-[A-Za-z]+$/.test(a)) return false;
    const at = a.indexOf(letter);
    if (at === -1) continue;
    return at === a.length - 1 ? setsRisky(args[i + 1], filled2) : setsRisky({ value: a.slice(at + 1), raw: null }, filled2);
  }
  return false;
}
var WHOLE_VARIABLE = /^("?)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))\1$/;
function waitRisky(args, filled2) {
  const operand = (a) => {
    const whole = WHOLE_VARIABLE.exec(a.raw ?? "");
    return whole !== null && filled2.plainOperands.has(whole[2] ?? whole[3]);
  };
  if (args.some((a) => a.value.startsWith("-"))) return optionSetterRisky(args, "p", filled2);
  return args.some((a) => a.value.includes(UNKNOWN) && !operand(a));
}
function commandRisky(words, filled2, home, depth) {
  let i = 0;
  const assigned = [];
  for (; ; ) {
    while (i < words.length && LATER_KEYWORDS.has(words[i].value)) i++;
    if (LATER_HEADERS.has(words[i]?.value ?? "")) return false;
    if (words[i]?.value === "repeat") i += 2;
    for (; i < words.length && ASSIGNMENT2.test(words[i].value); i++) {
      if (assignmentRisky(words[i].value, filled2)) return true;
      assigned.push(words[i].value);
    }
    const w = words[i]?.value;
    if (w !== void 0 && LATER_PREFIXES.has(w)) {
      i++;
      while (/^-[A-Za-z]*$/.test(words[i]?.value ?? "") && (w === "time" || w === "exec")) i++;
    } else if (w === "command") {
      i++;
      while (/^-[pvV]+$/.test(words[i]?.value ?? "")) {
        if (/[vV]/.test(words[i].value)) return false;
        i++;
      }
    } else {
      break;
    }
  }
  const rest = words.slice(i);
  const option = optionEffect(rest.map((w) => w.value), assigned);
  if (option.kind !== null || option.extended) return true;
  if (rest.length === 0) return false;
  const [first, ...args] = rest;
  const name = first.value;
  if (name.includes(UNKNOWN)) return true;
  if (HIDDEN_RUNNERS.has(name)) return true;
  if (DECLARING_BUILTINS.has(name)) return declarationRisky(args, filled2);
  if (NAME_SETTERS.has(name)) return nameSetterRisky(name, args, filled2);
  if (name === "wait") return waitRisky(args, filled2);
  const letter = OPTION_SETTERS.get(name);
  if (letter !== void 0) return optionSetterRisky(args, letter, filled2);
  if (name === "getopts") return setsRisky(args[args[0]?.value === "--" ? 2 : 1], filled2);
  if (name === "let") return args.some((a) => !writtenOut(a) || arithmeticRisky(a.value, filled2));
  if (name === "set") return setRisky(args, filled2);
  const values = args.map((a) => a.value);
  const script = name === "trap" ? trapScript(values) : name === "sched" ? schedScript(values) : name === "emulate" ? emulateMode(values).script : null;
  return script !== null && laterScriptRisky(script, filled2, home, depth + 1);
}
function laterTokensRisky(tokens, text, filled2, home, depth) {
  if (depth > MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  let words = [];
  for (const token of tokens) {
    if (token.kind === "op") {
      if (commandRisky(words, filled2, home, depth)) return true;
      words = [];
      continue;
    }
    if (token.scripts?.some((script) => laterTokensRisky(script, null, filled2, home, depth + 1))) return true;
    const at = sourceOf(token);
    if (token.kind === "word") words.push({ value: token.value, raw: text !== null && at !== void 0 ? text.slice(at.start, at.end) : null });
  }
  return commandRisky(words, filled2, home, depth);
}
function laterScriptRisky(script, filled2, home, depth) {
  const text = script.split(UNKNOWN).join("$_oss_unknown_");
  if (laterTextRisky(text, filled2)) return true;
  const result = tokenize(text, home);
  if ("unreadable" in result) {
    if (result.limit) throw new ReadingLimit2(result.reason);
    return true;
  }
  return laterTokensRisky(result.tokens, text, filled2, home, depth);
}
function readsUnquoted(script, names) {
  const read = unquotedReads(script);
  return [...names.keys()].some((name) => read.has(name));
}
function unquotedReads(script) {
  const read = /* @__PURE__ */ new Set();
  let quote = null;
  for (let i = 0; i < script.length; i++) {
    tick();
    const c = script[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") {
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else if (c === '"') {
      quote = quote === '"' ? null : '"';
    } else if (c === "$" && quote === null) {
      UNQUOTED_NAME.lastIndex = i + 1;
      const match = UNQUOTED_NAME.exec(script);
      if (match !== null) read.add(match[1]);
    }
  }
  return read;
}
var UNQUOTED_NAME = /\{?([A-Za-z_][A-Za-z0-9_]*)/y;
var TEST_VARIABLE_OPERATORS = /* @__PURE__ */ new Set(["-v", "-R"]);
var MAY_ASSIGN = /\(\(|\$\[|\[\[|\$\{(?![A-Za-z_][A-Za-z0-9_]*\})|\$'/;
var QUIET_SCRIPT = /^[A-Za-z0-9_./@%+,:\s;&|-]*$/;
function setsNothing(commandWords, first, text, start, end) {
  const at = first === void 0 ? void 0 : sourceOf(first);
  if (commandWords[0] !== "trap" || at === void 0 || text.slice(at.start, at.end) !== "trap" || MAY_ASSIGN.test(text.slice(start, end))) return false;
  const script = trapScript(commandWords.slice(1));
  if (script === null || !QUIET_SCRIPT.test(script) || scriptMayMove(script)) return false;
  return script.split(/[;&|\n]+/).every((command) => {
    const program = command.trim().split(/\s+/)[0];
    return program === "" || HARMLESS_COMMANDS.has(program);
  });
}
function exitOnly(args) {
  let i = 0;
  while (i < args.length && /^-[lp]+$/.test(args[i])) i++;
  if (args[i] === "--") i++;
  const signals = args.slice(i + 1);
  return signals.length > 0 && signals.every((signal) => /^(?:(?:SIG)?EXIT|0)$/.test(signal));
}
function harmlessCommand(commandWords, first, text, start, end, globs) {
  if (start !== -1 && MAY_ASSIGN.test(text.slice(start, end))) return false;
  const name = commandWords[0];
  if (name === void 0) return true;
  const at = first === void 0 ? void 0 : sourceOf(first);
  if (at === void 0 || text.slice(at.start, at.end) !== name || !HARMLESS_COMMANDS.has(name)) return false;
  const args = commandWords.slice(1);
  if (name === "test" || name === "[") return !args.some((w) => TEST_VARIABLE_OPERATORS.has(w) || w.includes(UNKNOWN) || globs.has(w));
  if (name === "cd") return args.length === 1 && !args[0].includes(UNKNOWN) && !args[0].startsWith("-");
  return true;
}
function split(tokens, cwd, home, toplevel = null, dots = false, startCdpath = null, cdpathSetUnseen2 = false, text = null, tmpdirSet = true, trusted = () => false, env = {}, anyUnknownWrites = false, opaqueOf = () => null, optionSet = null) {
  const segments = [];
  const groups = [];
  const compounds = [];
  let closedCompound = null;
  const known = /* @__PURE__ */ new Map();
  let listOps = "none";
  let functionDefined = false;
  let envClean = true;
  let filledAfter = -1;
  const filled2 = { names: /* @__PURE__ */ new Set(), positional: false, splits: false, settled: /* @__PURE__ */ new Set(), plainOperands: /* @__PURE__ */ new Set() };
  let segmentStart = -1;
  let segmentEnd = -1;
  let bodyNext = false;
  let sticky = optionSet;
  let optionUnknown = optionSet !== null;
  let extendedGlob = false;
  let wordTokens = [];
  const pushed = [];
  let header = null;
  let casePatterns = false;
  let caseDepth = 0;
  let closedGroupStart = null;
  let afterPipe = false;
  let dir = cwd;
  let lost = sticky;
  let gitVariableSet = false;
  let dotGlob = dots;
  let cdpath = startCdpath;
  let cdpathArray = null;
  let dotsWord = false;
  let pipedFrom = null;
  let words = [];
  let redirects = [];
  let globs = /* @__PURE__ */ new Map();
  let substitutedWords = /* @__PURE__ */ new Set();
  let substitutedRedirects = /* @__PURE__ */ new Set();
  let unknownWords = /* @__PURE__ */ new Set();
  let unknownRedirects = /* @__PURE__ */ new Set();
  let scripts = [];
  const atCommandStart = () => words.length === 0 && redirects.length === 0;
  const openGroup = (groupDir) => {
    if (groups.length >= MAX_GROUP_DEPTH) throw new ReadingLimit2(`groups nested deeper than ${MAX_GROUP_DEPTH}`);
    groups.push({ dir: groupDir, lost, dotGlob, start: segments.length, at: { dir, lost, afterPipe }, body: groupDir === null && bodyNext });
    bodyNext = false;
  };
  const openCompound = () => {
    if (compounds.length >= MAX_GROUP_DEPTH) throw new ReadingLimit2(`groups nested deeper than ${MAX_GROUP_DEPTH}`);
    compounds.push({ dir, lost, afterPipe });
  };
  const closeCompound = () => {
    closedCompound = compounds.pop() ?? null;
  };
  const followable = (token) => {
    const at = token === void 0 ? void 0 : sourceOf(token);
    if (text === null || token === void 0 || token.kind !== "word" || at === void 0 || opaqueOf(token) !== null) return null;
    const assignment = assignmentOf(token.value);
    if (assignment === null || assignment.index !== null || assignment.append) return null;
    const raw = text.slice(at.start, at.end);
    const written = raw.slice(raw.indexOf("=") + 1);
    if (TOPLEVEL_VALUE.test(written)) {
      const top = toplevel !== null && lost === null && !gitVariableSet ? toplevel(dir) : null;
      return top === null ? null : { value: top, setEnd: at.end };
    }
    const temp = NEW_TEMP_VALUE.exec(written);
    if (temp !== null) {
      const made = temp[2] === void 0 ? NEW_TEMP_FILE : NEW_TEMP_FOLDER;
      return plainMentions(text, "TMPDIR") === 0 ? { value: import_node_path3.default.join(import_node_os2.default.tmpdir(), made), setEnd: at.end } : null;
    }
    MKTEMP_VALUE.lastIndex = 0;
    const madeBy = MKTEMP_VALUE.exec(written);
    if (madeBy !== null && madeBy[0].length === written.length) {
      const pattern = mktempPattern((madeBy[2] ?? madeBy[3]).trim().split(/[ \t]+/).filter(Boolean), home, plainMentions(text, "TMPDIR") > 0);
      if (pattern === null || pattern === "") return null;
      return { value: pattern.split(MKTEMP_ANY).join("*"), setEnd: at.end, ...pattern.includes(MKTEMP_ANY) ? { wild: true } : {} };
    }
    const head = HOME_HEAD.exec(written);
    if (head !== null) {
      const rest = written.slice(head[0].length);
      if (home.includes(UNKNOWN) || rest !== "" && !PLAIN_VALUE2.test(rest) || /['"]/.test(rest)) return null;
      const value2 = home + rest;
      return { value: value2, setEnd: at.end, ...WILD_VALUE.test(rest) ? { wild: true } : {} };
    }
    const { value } = assignment;
    if (!PLAIN_VALUE2.test(written) || value === "" || value.includes(UNKNOWN) || value.includes("~")) return null;
    return { value, setEnd: at.end, ...WILD_VALUE.test(value) ? { wild: true } : {} };
  };
  let wildGlob;
  let settersRead = text ?? "";
  const followOne = (name, use) => {
    if (text === null) return null;
    const found2 = known.get(name);
    if (found2 !== void 0) return mayFollow(text, name, found2.setEnd, use, settersRead) ? { value: found2.value, wild: found2.wild === true } : null;
    if (!envClean || !mayReadEnvironment(text, name, use)) return null;
    const fromEnv = env[name];
    return fromEnv === void 0 || fromEnv === "" || fromEnv.includes(UNKNOWN) || /[*?[\n]/.test(fromEnv) ? null : { value: fromEnv, wild: false };
  };
  const followedValue = (token, value, command) => {
    const at = sourceOf(token);
    if (text === null || at === void 0 || functionDefined || sticky !== null || token.scripts !== void 0 || !value.includes(UNKNOWN)) return null;
    const refs = variableReferences(text.slice(at.start, at.end), home);
    const texts = value.split(UNKNOWN);
    if (refs === null || refs.length !== texts.length - 1) return null;
    if (command && !followedHere(words)) return null;
    const glob = globOf(token);
    const patterns = glob === void 0 ? texts.map(escapeGlob) : glob.split(UNKNOWN);
    if (patterns.length !== texts.length) return null;
    let out = texts[0];
    let pattern = patterns[0];
    let wild = glob !== void 0;
    for (let n = 0; n < refs.length; n++) {
      const { name, quoted } = refs[n];
      const followed = followOne(name, at.start);
      if (followed === null) return n === 0 ? null : unfollowedRest(out, pattern, texts, patterns, n, wild);
      if (!quoted && (/\s/.test(followed.value) || plainMentions(text, "IFS") > 0)) return null;
      const asPattern = !quoted && followed.wild;
      wild ||= asPattern;
      out += followed.value + texts[n + 1];
      pattern += (asPattern ? valuePattern(followed.value) : escapeGlob(followed.value)) + patterns[n + 1];
    }
    if (wild) wildGlob = pattern;
    return out;
  };
  const unfollowedRest = (out, pattern, texts, patterns, n, wild) => {
    if (wild) wildGlob = pattern + patterns.slice(n + 1).map((p) => UNKNOWN + p).join("");
    return out + texts.slice(n + 1).map((t) => UNKNOWN + t).join("");
  };
  const expandedScript = (token) => {
    const { value } = token;
    const at = sourceOf(token);
    if (text === null || at === void 0) {
      if (text !== null && value.includes(UNKNOWN)) throw new ReadingLimit2(CANNOT_EXPAND);
      return DYNAMIC_SCRIPT.test(value) ? value + UNKNOWN : value;
    }
    if (modifiedVariable(text.slice(at.start, at.end))) throw new ReadingLimit2(CANNOT_EXPAND);
    const setAt = segmentStart === -1 ? at.start : segmentStart;
    let out = value;
    if (value.includes(UNKNOWN)) {
      if (token.scripts !== void 0) throw new ReadingLimit2(CANNOT_EXPAND);
      const refs = variableReferences(text.slice(at.start, at.end), home, true);
      const texts = value.split(UNKNOWN);
      if (refs === null || refs.length !== texts.length - 1) throw new ReadingLimit2(CANNOT_EXPAND);
      out = texts[0];
      for (let n = 0; n < refs.length; n++) {
        const { name } = refs[n];
        const special = SPECIAL_PARAMETERS.has(name);
        if (!special && neverFollowed(name)) throw new ReadingLimit2(CANNOT_EXPAND);
        const followed = special ? null : followOne(name, setAt);
        if (followed !== null) out += followed.value;
        else if (special) out += `$${name}`;
        else if (plainMentions(text, name) === 0) out += `\${${name}}`;
        else throw new ReadingLimit2(CANNOT_EXPAND);
        out += texts[n + 1];
      }
    }
    return filledLater(out, setAt, at);
  };
  const filledLater = (script, setAt, span) => {
    if (text === null) return script;
    const after = span.end;
    const values = /* @__PURE__ */ new Map();
    let unknown = false;
    const watched = /* @__PURE__ */ new Map();
    const settled = /* @__PURE__ */ new Map();
    const splitting = plainMentions(text, "IFS") > 0 ? unquotedReads(script) : null;
    for (const [, name] of script.matchAll(REFERENCED_NAME)) {
      if (name === "HOME" || watched.has(name) || plainMentions(text, name) === 0) continue;
      watched.set(name, "");
      const followed = followOne(name, setAt);
      if (followed === null) {
        const splits = splitting !== null && splitting.has(name);
        const later = unchangedAfter(text, after) && !splits ? settledValues(text, name, span, home) : null;
        if (later !== null) settled.set(name, later);
        continue;
      }
      unknown ||= followed.wild === true || !LATER_VALUE.test(followed.value) || !unchangedAfter(text, after);
      values.set(name, followed.value);
    }
    if (watched.size === 0) return script;
    if (filledAfter === -1) filledAfter = after;
    for (const name of watched.keys()) filled2.names.add(name);
    for (const [name, plain] of settled) {
      filled2.settled.add(name);
      if (plain.every((v) => !v.startsWith("-"))) filled2.plainOperands.add(name);
    }
    filled2.positional ||= POSITIONAL.test(script);
    filled2.splits ||= readsUnquoted(script, watched);
    if (laterScriptRisky(script, filled2, home, 1)) throw laterChange(filled2);
    const read = values.size === 0 ? script : unknown ? script + UNKNOWN : filledReferences(script, values) ?? script + UNKNOWN;
    return withSettledValues(script, read, values, settled, unknown, filled2);
  };
  const withSettledValues = (script, read, values, settled, unknown, seen) => {
    let combinations = [new Map(values)];
    for (const [name, plain] of settled) {
      if (plain.length === 0) continue;
      combinations = combinations.flatMap((c) => [c, ...plain.map((v) => new Map([...c, [name, v]]))]);
      if (combinations.length > MAX_SCRIPT_VARIANTS + 1) throw laterChange(seen);
    }
    const copies = combinations.slice(1).map((c) => {
      const copy = unknown ? null : filledReferences(script, c);
      if (copy === null) throw laterChange(seen);
      return `(
${copy}
)
`;
    });
    return copies.join("") + read;
  };
  const underToplevel = (token, value) => {
    if (toplevel === null || lost !== null || gitVariableSet || !value.startsWith(UNKNOWN) || value.indexOf(UNKNOWN, 1) !== -1) return null;
    const script = token.scripts?.length === 1 ? token.scripts[0] : null;
    if (script === null || script.length !== TOPLEVEL_WORDS.length || !script.every((t, n) => t.kind === "word" && t.value === TOPLEVEL_WORDS[n])) return null;
    const top = toplevel(dir);
    return top === null ? null : top + value.slice(UNKNOWN.length);
  };
  const close = (next) => {
    if (atCommandStart() && scripts.length === 0) return;
    const commandWords = stripAssignments(words);
    const assigned = words.slice(0, words.length - commandWords.length);
    segments.push({
      words: commandWords,
      assignments: assignedNames(assigned),
      assignmentValues: assignedValues(assigned),
      redirects,
      globs,
      substituted: {
        words: new Set([...substitutedWords].map((n) => n - (words.length - commandWords.length)).filter((n) => n >= 0)),
        redirects: substitutedRedirects
      },
      unknown: {
        words: new Set([...unknownWords].map((n) => n - (words.length - commandWords.length)).filter((n) => n >= 0)),
        redirects: unknownRedirects
      },
      cwd: dir,
      lostDir: lost,
      exits: [{ op: next, following: segments.length + 1 }],
      scripts,
      dotGlob: dotGlob || dotsWord,
      pipedFrom,
      wordTokens: wordTokens.slice(words.length - commandWords.length)
    });
    const apart = afterPipe || isPipe(next) || next === "&";
    const mayRunHere = !isPipe(next) && next !== "&";
    if (cdpathArray !== null) {
      cdpath = compactCdpath(cdpathArray === "append" ? [...cdpath ?? [], ...commandWords] : commandWords);
      cdpathArray = null;
    }
    const quietTrap = text !== null && segmentStart !== -1 && assigned.length === 0 && setsNothing(commandWords, wordTokens[0], text, segmentStart, segmentEnd);
    if (quietTrap) settersRead = settersRead.slice(0, segmentStart) + " ".repeat(segmentEnd - segmentStart) + settersRead.slice(segmentEnd);
    if (text !== null && filledAfter !== -1 && segmentStart >= filledAfter) {
      const later2 = words.map((value, n) => {
        const at = wordTokens[n] === void 0 ? void 0 : sourceOf(wordTokens[n]);
        return { value, raw: at === void 0 ? null : text.slice(at.start, at.end) };
      });
      if (commandRisky(later2, filled2, home, 0) || scripts.some((script) => laterTokensRisky(script, null, filled2, home, 1))) throw laterChange(filled2);
    }
    if (text !== null && !quietTrap && !harmlessCommand(commandWords, wordTokens[assigned.length], text, segmentStart, segmentEnd, globs)) {
      known.clear();
      envClean = false;
    }
    segmentStart = -1;
    segmentEnd = -1;
    if (commandWords.length === 0 && !apart && listOps !== "or" && !functionDefined) {
      assigned.forEach((word, n) => {
        const name = assignmentOf(word)?.name;
        if (name === void 0) return;
        known.delete(name);
        const value = followable(wordTokens[n]);
        if (value !== null) known.set(name, { ...value, andOnly: listOps === "and" });
      });
    }
    const named2 = commandWords.length > 0 ? cdpathAfter(assigned, [], cdpath) : cdpath;
    const searched = cdpathSetUnseen2 ? [...named2 ?? [], UNKNOWN] : named2;
    if (!apart) {
      ({ dir, lost } = dirAfter(commandWords, { dir, lost }, pushed, home, globs, searched));
      dotGlob = dotGlobAfter(commandWords, assigned, dotGlob);
    } else if (mayRunHere) {
      const moved = dirAfter(commandWords, { dir, lost }, [...pushed], home, globs, searched);
      if (moved.dir !== dir || moved.lost !== lost) lost = { why: commandWords.join(" "), pattern: null };
    }
    const verb = verbOf(commandWords);
    if (mayRunHere && verb === "eval" && evalMayMove(commandWords)) {
      lost = { why: commandWords.join(" "), pattern: null };
    }
    if (mayRunHere && (verb === "alias" && commandWords.length > 1 || verb === "shopt" && commandWords.includes("expand_aliases"))) {
      sticky = { why: commandWords.join(" "), pattern: null };
    }
    const options = mayRunHere ? optionEffect(commandWords, assigned) : null;
    extendedGlob ||= options?.extended === true;
    if (options?.kind != null) {
      const why = [...assigned, ...commandWords].join(" ");
      optionUnknown = true;
      if (options.kind === "full") sticky = { why, pattern: null };
      else sticky ??= { why, pattern: null, plainKnown: true };
    }
    if (mayRunHere && sticky?.plainKnown === true && (verb === "cd" || verb === "pushd" || verb === "popd")) {
      sticky = { why: commandWords.join(" "), pattern: null };
    }
    const repeated = verb === "repeat" && scriptMayMove(commandWords.slice(commandWords.indexOf(verb) + 2).join(" "));
    if (mayRunHere && (repeated || switchesOffFolderBuiltin(commandWords))) sticky = { why: commandWords.join(" "), pattern: null };
    const trapArgs = verb === "trap" ? commandWords.slice(commandWords.indexOf(verb) + 1) : [];
    const atExit = verb === "trap" && !groups.some((g) => g.body) && !functionDefined && exitOnly(trapArgs);
    const later = [...verb === "trap" && !atExit ? [trapScript(trapArgs)] : [], ...functionsBodies(commandWords, assigned)];
    if (mayRunHere && later.some((script) => script !== null && scriptMayMove(script))) sticky = { why: [...assigned, ...commandWords].join(" "), pattern: null };
    const emulated = verb === "emulate" ? emulateMode(commandWords.slice(commandWords.indexOf(verb) + 1)).script : null;
    if (mayRunHere && emulated !== null && scriptMayMove(emulated)) lost = { why: commandWords.join(" "), pattern: null };
    if (mayRunHere && (verb === "source" || verb === ".")) {
      const at = words.length - commandWords.length + commandWords.indexOf(verb) + 1;
      if (!trusted(wordTokens[at])) sticky = { why: commandWords.join(" "), pattern: null };
    }
    if (sticky !== null) lost = sticky;
    cdpathArray = cdpathArrayOf(commandWords, assigned);
    cdpath = cdpathAfter(commandWords.length === 0 ? assigned : [], VARIABLE_BUILTINS.has(commandWords[0] ?? "") ? commandWords.slice(1) : [], cdpath);
    gitVariableSet ||= setsGitVariable(commandWords, assigned);
    dotsWord = false;
    pipedFrom = null;
    words = [];
    wordTokens = [];
    redirects = [];
    globs = /* @__PURE__ */ new Map();
    substitutedWords = /* @__PURE__ */ new Set();
    substitutedRedirects = /* @__PURE__ */ new Set();
    unknownWords = /* @__PURE__ */ new Set();
    unknownRedirects = /* @__PURE__ */ new Set();
    scripts = [];
  };
  const readWord = (w, glob) => {
    if (glob !== void 0) globs.set(w, glob);
    if (casePatterns) {
      if (w === "esac") {
        caseDepth--;
        casePatterns = false;
        closeCompound();
        known.clear();
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
      if (w === "{" && TIMED_GROUP.test(words.join(" "))) {
        close(";");
        openGroup(null);
      } else {
        words.push(w);
      }
    } else if (w === "for" || w === "select") {
      header = "for";
      openCompound();
      known.clear();
    } else if (w === "case") {
      header = "case";
      caseDepth++;
      openCompound();
      known.clear();
    } else if (w === "esac") {
      caseDepth = Math.max(0, caseDepth - 1);
      closeCompound();
      known.clear();
    } else if (w === "function") {
      header = "name";
      functionDefined = true;
      bodyNext = true;
      known.clear();
    } else if (w === "{") {
      openGroup(null);
      for (const found2 of known.values()) found2.andOnly = false;
    } else if (w === "}") {
      const group = groups.pop();
      known.clear();
      if (group !== void 0) {
        closedGroupStart = group.start;
        if (group.body) {
          if (dir !== group.at.dir || lost !== group.at.lost) sticky = { why: "a function that changes the folder", pattern: null };
          ({ dir, lost } = group.at);
          if (sticky !== null) lost = sticky;
        } else {
          closedCompound = group.at;
        }
      }
    } else if (!KEYWORDS.has(w)) {
      words.push(w);
    } else {
      if (COMPOUND_OPEN.has(w)) openCompound();
      if (COMPOUND_CLOSE.has(w)) closeCompound();
      if (FORGET_AT.has(w)) known.clear();
    }
    if (atCommandStart() && words.length === 0) listOps = "none";
  };
  const zshGlobOf = (token) => optionUnknown || extendedGlob ? extendedGlobOf(token) : void 0;
  for (let k = 0; k < tokens.length; k++) {
    tick();
    const token = tokens[k];
    if (token.kind !== "op" && token.scripts !== void 0) scripts.push(...token.scripts);
    const span = token.kind === "op" ? void 0 : sourceOf(token);
    if (span !== void 0) {
      if (segmentStart === -1) segmentStart = span.start;
      segmentEnd = span.end;
    }
    if (dotsOf(token)) dotsWord = true;
    if (token.kind === "word") {
      const top = toplevel !== null && lost === null && !gitVariableSet && isToplevelWord(token) ? toplevel(dir) : null;
      const opaque = opaqueOf(token);
      wildGlob = void 0;
      const value = scriptOperandNext(words) ? expandedScript(token) : opaque ?? top ?? underToplevel(token, token.value) ?? followedValue(token, token.value, true) ?? token.value;
      readWord(value, opaque !== null ? void 0 : wildGlob ?? zshGlobOf(token) ?? globOf(token));
      if (words.length > wordTokens.length) {
        wordTokens.push(token);
        if (value.includes(UNKNOWN) && !isNewTempFile(token, tmpdirSet)) {
          if (token.scripts !== void 0 || opaque !== null || optionUnknown) substitutedWords.add(words.length - 1);
          if (anyUnknownWrites) unknownWords.add(words.length - 1);
        }
      }
    } else if (token.kind === "redirect") {
      const body = heredocBodyOf(token);
      const opaque = opaqueOf(token);
      wildGlob = void 0;
      const target = opaque ?? underToplevel(token, token.target) ?? followedValue(token, token.target, false) ?? token.target;
      if (target.includes(UNKNOWN) && !isNewTempFile(token, tmpdirSet)) {
        if (token.scripts !== void 0 || opaque !== null || optionUnknown) substitutedRedirects.add(target);
        if (anyUnknownWrites) unknownRedirects.add(target);
      }
      redirects.push({ op: token.op, target, ...body === void 0 ? {} : { body } });
      const glob = opaque !== null ? void 0 : wildGlob ?? zshGlobOf(token) ?? globOf(token);
      if (glob !== void 0) globs.set(target, glob);
    } else if (casePatterns || header === "case") {
      if (casePatterns && token.value === ")") casePatterns = false;
    } else if (token.value === "(" && isOp(tokens[k + 1], ")")) {
      words = [];
      wordTokens = [];
      k++;
      functionDefined = true;
      bodyNext = true;
      known.clear();
    } else {
      if (header === "for") header = null;
      const op = token.value;
      if (closedCompound !== null) {
        const opened = closedCompound;
        closedCompound = null;
        if (isPipe(op) || op === "&") ({ dir, lost } = opened);
        else if (opened.afterPipe && (dir !== opened.dir || lost !== opened.lost)) lost = { why: "a `cd` in a piped command", pattern: null };
        if (sticky !== null) lost = sticky;
      }
      const before = segments.length;
      close(token.value);
      if (FORGET_OPS.has(op)) known.clear();
      if (op === "(" || op === ")") envClean = false;
      else if (op === ";" || op === "\n") {
        for (const [name, found2] of known) if (found2.andOnly) known.delete(name);
      }
      if (op === "&&") listOps = listOps === "or" ? "or" : "and";
      else if (op === "||") listOps = "or";
      else if (!isPipe(op)) listOps = "none";
      const source = segments.length > before && closedGroupStart === null ? segments[segments.length - 1] : "unknown";
      if (closedGroupStart !== null && token.value !== ")") {
        for (const inner of segments.slice(closedGroupStart)) inner.exits.push({ op: token.value, following: segments.length });
        closedGroupStart = null;
      }
      afterPipe = isPipe(token.value);
      pipedFrom = afterPipe ? source : null;
      if (token.value === "(") openGroup(dir);
      if (token.value === ")") {
        const group = groups.pop();
        if (group !== void 0) {
          if (group.dir !== null) ({ dir, lost, dotGlob } = { dir: group.dir, lost: group.lost, dotGlob: group.dotGlob });
          closedGroupStart = group.start;
        }
      }
      if (token.value === ";;" && caseDepth > 0) casePatterns = true;
    }
  }
  close(null);
  if (text !== null && filledAfter !== -1 && laterTextRisky(text.slice(filledAfter), filled2)) throw laterChange(filled2);
  return segments;
}
function toParts(segment, segments, reading, depth) {
  if (segment.scripts.length > 0 && depth >= MAX_NESTED_DEPTH) {
    throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  }
  const substituted = segment.scripts.flatMap(
    (script) => readTokens(script, segment.cwd, reading, depth + 1, segment.dotGlob).map((p) => ({ ...p, pipedOut: true }))
  );
  return [...substituted, ...ownParts(segment, segments, reading, depth)];
}
function ownParts(segment, segments, reading, depth) {
  const { home } = reading;
  const { words, cwd, assignments, values, lost, terminal, writes, alternates, wrappers, wrapperOptions } = unwrap(segment.words, segment.cwd, reading);
  const program = words[0] ?? null;
  const name = program === null ? null : programName(program, reading);
  const args = words.slice(1);
  let git = null;
  if (name === "git") git = readGit(args, cwd, home);
  else if (name !== null && PUSH_PROGRAMS.has(name)) git = { subcommand: "push", args, dir: cwd };
  const gitDirLost = name === "git" ? unknownGitDir(args) : null;
  const scriptFacts = scriptFactsOf(name, args);
  if (scriptFacts !== null) reading.unreadable ??= scriptFacts.unreadable ?? scriptFacts.dynamic;
  if (runsUnknownScript(name, args)) reading.unreadable ??= `${name} runs a script only known when it runs`;
  const offset = segment.words.length - words.length + 1;
  const tempArgs = args.map((w, n) => segment.words[offset + n] === w && reading.tempHead.has(segment.wordTokens[offset + n]));
  const operandsWritten = [...operandWrites(name, args, segment.globs, tempArgs), ...scriptFacts?.writes ?? []];
  const written = [...redirectWrites(segment), ...operandsWritten];
  const backups = name !== null && makesBackup(name, args) ? operandsWritten.map((p) => `${segment.globs.get(p) ?? escapeGlob(p)}*`) : [];
  const recursive = recursiveOperands(name, args);
  const part = {
    words,
    assignments: [...segment.assignments, ...assignments],
    assignmentValues: [...segment.assignmentValues, ...values],
    program,
    name,
    cwd,
    writeTargets: [
      ...writes,
      ...written.map((p) => joinRaw(cwd, expandTilde(p, home))),
      ...git === null ? [] : gitWrites(git).map((p) => joinRaw(git.dir, expandTilde(p, home)))
    ],
    writeGlobs: [
      ...written.flatMap((p) => {
        const glob = segment.globs.get(p);
        return glob === void 0 ? [] : [globPathOf(glob, escapeGlob(cwd), home)];
      }),
      ...backups.map((glob) => globPathOf(glob, escapeGlob(cwd), home))
    ],
    recursiveTargets: recursive.filter((p) => !segment.globs.has(p)).map((p) => joinRaw(cwd, expandTilde(p, home))),
    recursiveGlobs: recursive.flatMap((p) => {
      const glob = segment.globs.get(p);
      return glob === void 0 ? [] : [globPathOf(glob, escapeGlob(cwd), home)];
    }),
    globs: segment.globs,
    writePatterns: new Map(written.flatMap((p) => {
      const glob = segment.globs.get(p);
      return glob === void 0 ? [] : [[joinRaw(cwd, expandTilde(p, home)), globPathOf(glob, escapeGlob(cwd), home)]];
    })),
    substitutedWrites: [
      ...markedWrites(segment.substituted, segment, words, name, redirectWrites(segment), operandsWritten),
      // a mktemp whose path can't be read (round 22, CR MEDIUM-1): refused as a bare `$(…)` is
      ...name === "mktemp" && operandsWritten.includes(UNKNOWN) ? [UNKNOWN] : []
    ].map((p) => joinRaw(cwd, expandTilde(p, home))),
    unknownWrites: markedWrites(segment.unknown, segment, words, name, redirectWrites(segment), operandsWritten).map((p) => joinRaw(cwd, expandTilde(p, home))),
    stdinScripts: stdinScriptsOf(segment, name, args, reading),
    lostDir: segment.lostDir ?? lost ?? gitDirLost,
    hosts: args.flatMap(hostOf),
    git,
    pipedOut: segment.exits.some((e) => isPipe(e.op)),
    orTrue: segment.exits.some((e) => e.op === "||" && isTrue(segments[e.following]?.words ?? [])),
    followedByAnd: segment.exits[0]?.op === "&&",
    backgrounded: segment.exits.some((e) => e.op === "&"),
    wrappers,
    wrapperOptions,
    dotGlob: segment.dotGlob,
    terminal
  };
  if (name === "sched") reading.unreadable ??= "zsh sched runs a command later";
  const bodies = [
    ...segment.assignments.flatMap((n, k) => n === ZSH_FUNCTIONS ? [segment.assignmentValues[k] || UNKNOWN] : []),
    ...functionsBodies(words, [])
  ];
  if (bodies.length > 0 || definesFunction(segment.assignments, words)) hide(part, reading, "defines a zsh function from text");
  const settings = [
    ...functionParts(bodies, part, reading, depth),
    ...settingParts(part, reading, depth),
    ...scriptCommandParts(scriptFacts, part, reading, depth),
    ...alternateParts(alternates, segment, segments, part, reading, depth),
    ...startParts(startReadings(words, reading), segment, segments, part, reading, depth)
  ];
  for (const target of part.writeTargets) reading.written.add(import_node_path3.default.resolve(target));
  const script = scriptOf(name, program === null ? null : import_node_path3.default.posix.basename(program), args) ?? stdinShellScript(name, args, part.stdinScripts) ?? expectSpawns(name, args, cwd, reading, stdinFed(segment));
  if (script === null) return [part, ...settings];
  const later = name !== null && LATER_LAUNCHERS.has(name);
  const hidden = `runs a \`${name}\` script the gate can't read in full`;
  if (later && script.includes(UNKNOWN)) {
    hide(part, reading, hidden);
    return [part, ...settings];
  }
  if (!later && (DYNAMIC_SCRIPT.test(script) || script.includes(UNKNOWN))) {
    reading.unreadable ??= `${name} runs a script that is not literal`;
    return [part, ...settings];
  }
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  const kind = name === "emulate" ? emulateKind(emulateMode(args).mode) : shellSetsUnknownOption(name, args);
  const optionSet = kind === null ? null : { why: `${name} ${args.join(" ")}`, pattern: null, ...kind === "partial" ? { plainKnown: true } : {} };
  const read = () => readScript(script, cwd, reading, depth + 1, part.dotGlob || shellDots(name, args, part.assignments, part.assignmentValues), optionSet);
  const nested = later ? readWhole(read, part, reading, hidden).map(asCleanup) : read();
  return [part, ...settings, ...nested.map((p) => ({
    ...p,
    assignments: [...part.assignments, ...p.assignments],
    pipedOut: p.pipedOut || part.pipedOut,
    orTrue: p.orTrue || part.orTrue,
    // the script runs where and as its shell runs: in the background, under the same launchers
    backgrounded: p.backgrounded || part.backgrounded,
    wrappers: [...part.wrappers, ...p.wrappers],
    wrapperOptions: [...part.wrapperOptions, ...p.wrapperOptions],
    // an `expect` spawn runs with a terminal of its own
    terminal: p.terminal || part.terminal || name === "expect"
  }))];
}
var LATER_LAUNCHERS = /* @__PURE__ */ new Set(["trap", "emulate", "sched"]);
function asCleanup(part) {
  if (!part.recursiveTargets.some((t) => t.includes(UNKNOWN))) return part;
  const unknown = part.recursiveTargets.filter((t) => t.includes(UNKNOWN));
  return {
    ...part,
    recursiveTargets: part.recursiveTargets.filter((t) => !t.includes(UNKNOWN)),
    unknownWrites: [.../* @__PURE__ */ new Set([...part.unknownWrites ?? [], ...unknown])],
    cleanupWrites: unknown
  };
}
function hide(part, reading, why) {
  reading.unreadable ??= why;
  part.hiddenScript ??= why;
}
function readWhole(read, part, reading, why) {
  const outer = reading.unreadable;
  reading.unreadable = null;
  try {
    return read();
  } finally {
    const inner = reading.unreadable;
    reading.unreadable = outer ?? inner;
    if (inner !== null) hide(part, reading, why);
  }
}
var ZSH_DISABLED_FUNCTIONS = "dis_functions";
function definesFunction(assignments, words) {
  if (assignments.includes(ZSH_FUNCTIONS) || assignments.includes(ZSH_DISABLED_FUNCTIONS)) return true;
  let p = 0;
  while (CD_PREFIXES.has(words[p])) p++;
  const [program, ...args] = words.slice(p);
  if (program === "enable") return args.some((a) => /^-[A-Za-z]*f/.test(a));
  if (program === "set") {
    const at = args.findIndex((a) => /^[-+][A-Za-z]*A/.test(a));
    const array = at === -1 ? void 0 : args[at + 1] ?? UNKNOWN;
    return array !== void 0 && (array.includes(UNKNOWN) || array === ZSH_FUNCTIONS || array === ZSH_DISABLED_FUNCTIONS);
  }
  if (program !== void 0 && VARIABLE_BUILTINS.has(program)) {
    return args.some((a) => {
      const name = assignmentOf(a)?.name;
      return name === ZSH_FUNCTIONS || name === ZSH_DISABLED_FUNCTIONS;
    });
  }
  return false;
}
function alternateParts(alternates, segment, segments, part, reading, depth) {
  if (alternates.length === 0) return [];
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  return alternates.flatMap(
    (words) => ownParts({ ...segment, words, assignments: [], assignmentValues: [], scripts: [] }, segments, reading, depth + 1).map((p) => ({
      ...p,
      assignments: [...part.assignments, ...p.assignments],
      terminal: true
    }))
  );
}
function shiftedMarks(marked, offset) {
  return { words: new Set([...marked.words].flatMap((n) => n >= offset ? [n - offset] : [])), redirects: marked.redirects };
}
function startParts(starts, segment, segments, part, reading, depth) {
  if (starts.length === 0) return [];
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  return starts.flatMap((start) => {
    const leading = start.words.findIndex((w) => !ASSIGNMENT2.test(w));
    if (leading === -1) return [];
    const words = start.words.slice(leading);
    const settings = [...start.settings, ...start.words.slice(0, leading)];
    const offset = segment.words.length - words.length;
    const suffix = offset >= 0 && words.every((w, n) => segment.words[offset + n] === w);
    const marks = suffix ? { substituted: shiftedMarks(segment.substituted, offset), unknown: shiftedMarks(segment.unknown, offset), wordTokens: segment.wordTokens.slice(offset) } : { wordTokens: [] };
    return ownParts({ ...segment, ...marks, words, assignments: assignedNames(settings), assignmentValues: assignedValues(settings), scripts: [] }, segments, reading, depth + 1).map((p) => ({
      ...p,
      assignments: [...part.assignments, ...p.assignments],
      runBy: part.program ?? void 0
    }));
  });
}
function runsArchOrLaunchctl(word) {
  const base = import_node_path3.default.posix.basename(word).toLowerCase();
  if (base === "arch" || base === "launchctl") return true;
  if (!/[?*[]/.test(base)) return false;
  if (base.includes("[") && base.lastIndexOf("]") > base.indexOf("[") + 1) return true;
  return globMayMatch(base, "arch") || globMayMatch(base, "launchctl");
}
function globMayMatch(glob, name) {
  let at = name.split("").map(() => false).concat(false);
  at[0] = true;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    const next = at.map(() => false);
    if (c === "*") {
      let seen = false;
      for (let k = 0; k <= name.length; k++) next[k] = seen ||= at[k];
    } else {
      let test = (letter) => letter === c;
      if (c === "?") test = () => true;
      else if (c === "[") {
        const close = glob.indexOf("]", i + 2);
        if (close !== -1) {
          const inner = glob.slice(i + 1, close);
          const negate = inner.startsWith("!") || inner.startsWith("^");
          const set = negate ? inner.slice(1) : inner;
          test = (letter) => inClass(set, letter) !== negate;
          i = close;
        }
      }
      for (let k = 0; k < name.length; k++) if (at[k] && test(name[k])) next[k + 1] = true;
    }
    at = next;
  }
  return at[name.length];
}
function inClass(set, letter) {
  for (let i = 0; i < set.length; i++) {
    if (set[i + 1] === "-" && i + 2 < set.length) {
      if (letter >= set[i] && letter <= set[i + 2]) return true;
      i += 2;
    } else if (set[i] === letter) return true;
  }
  return false;
}
function startReadings(words, reading) {
  if (words.length === 0 || !runsArchOrLaunchctl(words[0])) return [];
  const starts = [];
  const settings = [];
  for (let i = 1; i < words.length; i++) {
    if (!words[i].startsWith("-") || words[i - 1] === "--") starts.push({ words: words.slice(i), settings: [...settings] });
    const value = words[i] === "-e" ? words[i + 1] : words[i].startsWith("-e") ? words[i].slice(2) : void 0;
    if (value !== void 0 && ASSIGNMENT2.test(value)) settings.push(value);
  }
  reading.startReadings += starts.length;
  if (reading.startReadings > MAX_START_READINGS) throw new ReadingLimit2(`more than ${MAX_START_READINGS} commands read after arch or launchctl`);
  return starts;
}
var EXPECT_WAITS = /* @__PURE__ */ new Map([["expect", 1], ["send", 1], ["exit", 1], ["interact", 0], ["wait", 0], ["close", 0]]);
function expectSpawns(name, args, cwd, reading, stdinFed2) {
  if (name !== "expect") return null;
  const spawns = [];
  let inline = false;
  let file = false;
  for (let n = 0; n < args.length; n++) {
    const a = args[n];
    if (a === "-c") {
      inline = true;
      expectText(args[++n] ?? "", reading, spawns);
    } else if (a === "-i") {
      reading.unreadable ??= "expect reads its script from stdin";
    } else if (EXPECT_VALUE_OPTIONS.has(a)) n++;
    else if (EXPECT_FILE_OPTIONS.has(a) || a === "--" || !a.startsWith("-") || a === "-") {
      const named2 = a.startsWith("-") && a !== "-" ? args[n + 1] : a;
      file = named2 !== void 0;
      if (named2 !== void 0) expectText(expectFile(named2, cwd, reading), reading, spawns);
      break;
    }
  }
  if (!file && (!inline || stdinFed2)) reading.unreadable ??= "expect reads its script from stdin";
  return spawns.length > 0 ? spawns.join("\n") : null;
}
var EXPECT_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-D"]);
var EXPECT_FILE_OPTIONS = /* @__PURE__ */ new Set(["-f", "-b"]);
function expectFile(file, cwd, reading) {
  if (file === "-" || file.includes(UNKNOWN) || reading.readFile === null) return null;
  const absPath = resolvePath(file, cwd, reading.home);
  if (reading.written.has(import_node_path3.default.resolve(absPath))) return null;
  const known = reading.files.get(absPath);
  if (known !== void 0) return known;
  const text = reading.readFile(absPath);
  reading.files.set(absPath, text);
  return text;
}
var MAX_SCRIPT_SCAN = 1024 * 1024;
function scan(amount, reading) {
  reading.scanned += amount;
  if (reading.scanned > MAX_SCRIPT_SCAN) throw new ReadingLimit2(`expect reads over ${MAX_SCRIPT_SCAN / 1024 / 1024} MB of script files`);
}
function tclCommandsOf(text, reading) {
  const known = reading.scriptCommands.get(text);
  if (known !== void 0) return known;
  const commands = tclCommands(text);
  reading.scriptCommands.set(text, commands);
  return commands;
}
var TCL_BLANK = /[ \t\r]/;
var TCL_SEPARATOR = /[;\n]/;
var TCL_UNREAD_BARE = /[[\]{}$\\"]/;
var TCL_UNREAD_QUOTED = /[[\]{}$]/;
var TCL_ESCAPES = /* @__PURE__ */ new Map([["a", "\x07"], ["b", "\b"], ["f", "\f"], ["n", "\n"], ["r", "\r"], ["t", "	"], ["v", "\v"]]);
var OCTAL = /^[0-7]{1,3}/;
var HEX = /^[0-9A-Fa-f]+/;
function tclUnescape(body) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    tick();
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    const c = body[i + 1] ?? "";
    const rest = body.slice(i + 1, i + 10);
    const octal = OCTAL.exec(rest)?.[0];
    if (octal !== void 0) {
      if (octal.length === 3 && octal[0] > "3") return null;
      out += String.fromCharCode(parseInt(octal, 8));
      i += octal.length;
    } else if (c === "x" || c === "u") {
      const digits = HEX.exec(rest.slice(1))?.[0] ?? "";
      const most = c === "x" ? 2 : 4;
      if (c === "x" && digits.length > most) return null;
      const used = digits.slice(0, most);
      out += used === "" ? c : String.fromCharCode(parseInt(used, 16));
      i += 1 + used.length;
    } else if (c === "U") {
      return null;
    } else if (c === "\n") {
      let j = i + 2;
      while (j < body.length && TCL_BLANK.test(body[j]) && body[j] !== "\r") j++;
      out += " ";
      i = j - 1;
    } else {
      out += TCL_ESCAPES.get(c) ?? c;
      i++;
    }
  }
  return out;
}
function tclCommands(text) {
  const commands = [];
  let words = [];
  let i = 0;
  while (i < text.length) {
    tick();
    const c = text[i];
    if (TCL_BLANK.test(c)) {
      i++;
    } else if (TCL_SEPARATOR.test(c)) {
      if (words.length > 0) commands.push(words);
      words = [];
      i++;
    } else if (c === "#" && words.length === 0) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      const after = text[j + 1];
      if (j >= text.length || after !== void 0 && !TCL_BLANK.test(after) && !TCL_SEPARATOR.test(after)) return null;
      const body = text.slice(i + 1, j);
      const decoded = TCL_UNREAD_QUOTED.test(body) ? null : tclUnescape(body);
      if (decoded === null) return null;
      words.push(decoded);
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !TCL_BLANK.test(text[j]) && !TCL_SEPARATOR.test(text[j])) j++;
      const word = text.slice(i, j);
      if (TCL_UNREAD_BARE.test(word)) return null;
      words.push(word);
      i = j;
    }
  }
  if (words.length > 0) commands.push(words);
  return commands;
}
function expectText(text, reading, spawns) {
  const commands = text === null || text.includes(UNKNOWN) ? null : (scan(text.length, reading), tclCommandsOf(text, reading));
  if (commands === null) {
    reading.unreadable ??= "expect runs text the gate can't read";
    return;
  }
  for (const words of commands) {
    tick();
    scan(1, reading);
    const spawned = expectCommand(words, reading);
    if (spawned !== null) spawns.push(spawned);
  }
}
function expectCommand(words, reading) {
  const [command, ...rest] = words;
  if (command === void 0) return null;
  const options = rest.filter((w) => w.startsWith("-"));
  const operands2 = rest.filter((w) => !w.startsWith("-"));
  if (command === "spawn" && !options.some((o) => o === "-open" || o === "-ignore") && rest.length > options.length) {
    return rest.slice(rest.findIndex((w) => !w.startsWith("-"))).map(shellQuote).join(" ");
  }
  const most = EXPECT_WAITS.get(command);
  if (most === void 0 || operands2.length > most || most === 0 && options.length > 0) reading.unreadable ??= "expect runs text the gate can't read";
  return null;
}
function shellQuote(word) {
  return `'${word.replace(/'/g, `'\\''`)}'`;
}
var GIT_VARIABLE = /^GIT_/;
var SAFE_GIT_VARIABLE = /^(?:GIT_NO_REPLACE_OBJECTS|GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)|GIT_TRACE[A-Za-z0-9_]*)$/;
function functionParts(bodies, part, reading, depth) {
  return bodies.flatMap((body) => {
    if (DYNAMIC_SCRIPT.test(body) || body.includes(UNKNOWN)) return [];
    if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
    return readScript(body, part.cwd, reading, depth + 1, part.dotGlob);
  });
}
function settingParts(part, reading, depth) {
  const values = part.assignmentValues.filter((_, n) => {
    const name = part.assignments[n];
    return !SAFE_GIT_VARIABLE.test(name) && (part.git !== null || GIT_VARIABLE.test(name));
  });
  if (part.git !== null) {
    const globals = part.words.slice(1, part.words.length - part.git.args.length - 1);
    globals.forEach((w, n) => {
      if (w === "-c" && n + 1 < globals.length) values.push(globals[n + 1].slice(globals[n + 1].indexOf("=") + 1));
    });
  }
  return values.flatMap((value) => {
    if (value === "" || DYNAMIC_SCRIPT.test(value) || value.includes(UNKNOWN)) {
      if (value !== "") reading.unreadable ??= "a setting that runs a command is not literal";
      return [];
    }
    if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
    const command = value.startsWith("!") ? value.slice(1) : value;
    return readScript(command, part.cwd, reading, depth + 1, part.dotGlob).map((p) => ({ ...p, pipedOut: true }));
  });
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
function unwrap(words, cwd, reading, first) {
  const { home } = reading;
  const wrappers = [];
  const wrapperOptions = [];
  const alternates = [];
  const assignments = [];
  const values = [];
  let lost = null;
  let terminal = false;
  const writes = [];
  let dir = cwd;
  let rest = words;
  let unwrapped = 0;
  const wrapperOf = (word) => word === void 0 ? void 0 : WRAPPERS.get(plainWriterName(programName(word, reading)));
  rest = withEquals(rest);
  for (let spec = first ?? wrapperOf(rest[0]); spec !== void 0; spec = wrapperOf(rest[0])) {
    if (++unwrapped > MAX_WRAPPERS) throw new ReadingLimit2(`more than ${MAX_WRAPPERS} wrappers`);
    wrappers.push(plainWriterName(programName(rest[0], reading)));
    terminal ||= spec.terminal === true;
    if (spec.alternate !== void 0) {
      const other = unwrap(rest, dir, reading, spec.alternate);
      writes.push(...other.writes);
      alternates.push(...other.alternates, ...other.words === rest ? [] : [other.words]);
      lost ??= other.lost;
    }
    let split2 = [];
    let shell;
    let i = 1;
    for (; i < rest.length; i++) {
      const w = rest[i];
      if (w === "--") {
        i++;
        break;
      }
      if (spec.assignments === true && ASSIGNMENT2.test(w)) {
        assignments.push(...assignedNames([w]));
        values.push(...assignedValues([w]));
        continue;
      }
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
      if (spec.dir?.includes(flag)) {
        if (value.includes(UNKNOWN)) lost = { why: `${rest[0]} ${flag} ${value}`, pattern: null };
        dir = resolvePath(value, dir, home);
      }
      if (spec.split?.includes(flag)) split2 = splitWords(value, reading);
      if (spec.shell?.includes(flag)) shell = value;
    }
    wrapperOptions.push(rest.slice(1, i));
    const files = spec.writesOperands === true ? rest.slice(i, i + (spec.operands ?? 0)).filter((w) => !w.startsWith("-")) : [];
    let after = i + files.length;
    while (spec.shell !== void 0 && shell === void 0 && after < rest.length && rest[after].startsWith("-") && rest[after] !== "-") {
      const w = rest[after];
      const eq = w.indexOf("=");
      const flag = w.startsWith("--") && eq !== -1 ? w.slice(0, eq) : w;
      if (spec.shell.includes(flag) || /^-[A-Za-z]+$/.test(w) && w.endsWith("c")) shell = eq !== -1 && w.startsWith("--") ? w.slice(eq + 1) : rest[after + 1];
      else if (spec.values.includes(flag) && eq === -1) after++;
      after++;
    }
    for (const file of files.length > 0 ? files : spec.defaultWrite === void 0 ? [] : [spec.defaultWrite]) writes.push(joinRaw(dir, expandTilde(file, home)));
    const operandsRun = spec.noCommandOperands === true ? [] : rest.slice(i + (spec.operands ?? 0));
    const next = shell !== void 0 ? ["sh", "-c", shell] : [...split2, ...operandsRun];
    if (next.length === 0) break;
    rest = withEquals(next);
  }
  return { words: rest, cwd: dir, assignments, values, lost, terminal, writes, alternates, wrappers, wrapperOptions };
}
function withEquals(words) {
  const first = words[0];
  return first !== void 0 && first.length > 1 && first.startsWith("=") ? [first.slice(1), ...words.slice(1)] : words;
}
function splitWords(value, reading) {
  return tokensOf(value, reading).flatMap((t) => t.kind === "word" ? [t.value] : []);
}
function scriptOf(name, exact, args) {
  if (exact === "eval") return args.length > 0 ? args.join(" ") : null;
  if (exact === "trap") return trapScript(args);
  if (exact === "emulate") return emulateMode(args).script;
  if (exact === "sched") return schedScript(args);
  if (name === null || !SHELLS.has(name)) return null;
  let command = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SHELL_VALUE_OPTIONS.has(a)) i++;
    else if (a.startsWith("-") || a.startsWith("+")) {
      command ||= COMMAND_STRING_FLAG.test(a);
      if (SHORT_OPTION_CLUSTER.test(a) && !ATTACHED_OPTION_NAME.test(a)) i += [...a.slice(1)].filter((l) => SHELL_VALUE_OPTIONS.has(`-${l}`)).length;
    } else return command ? a : null;
  }
  return null;
}
var STDIN_TEXT = /^0?(?:<<-?|<<<)$/;
var STDIN_FILE = /^0?<$/;
function stdinFed(segment) {
  return segment.pipedFrom !== null || segment.redirects.some((r) => STDIN_TEXT.test(r.op) || STDIN_FILE.test(r.op));
}
var STDIN_INTERPRETERS = /* @__PURE__ */ new Set(["node", "perl", "ruby", "osascript", "php"]);
var PYTHON = /^python[0-9.]*$/;
var DASH_INTERPRETERS = /* @__PURE__ */ new Set(["deno", "bun"]);
var INLINE_SCRIPT = /^(?:-[A-Za-z]*[ceEm]|--eval|--print|-p)$/;
var INTERPRETER_VALUE_OPTIONS = /* @__PURE__ */ new Set([
  "-Q",
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-C",
  "--conditions",
  "--input-type",
  "--title",
  "-I",
  "-E",
  "-l",
  "-s"
]);
var PYTHON_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-W", "-X"]);
var PYTHON_INLINE_SCRIPT = /^-[A-Za-z]*[cm]$/;
function interpreterSyntax(name) {
  return PYTHON.test(name) ? { values: PYTHON_VALUE_OPTIONS, inline: PYTHON_INLINE_SCRIPT } : { values: INTERPRETER_VALUE_OPTIONS, inline: INLINE_SCRIPT };
}
function runsItsArguments(name) {
  return WRAPPERS.has(name) || SHELLS.has(name) || STDIN_INTERPRETERS.has(name) || PYTHON.test(name) || DASH_INTERPRETERS.has(name) || name === "expect";
}
var SHELL_STDIN_FLAG = /^-(?=[A-Za-z]*s)[A-Za-z]+$/;
function readsStdinScript(name, args) {
  if (name === null) return false;
  if (SHELLS.has(name)) {
    if (scriptOf(name, name, args) !== null) return false;
    return args.some((a) => SHELL_STDIN_FLAG.test(a)) || stdinShellScript(name, args, [""]) !== null;
  }
  if (DASH_INTERPRETERS.has(name)) return args.includes("-");
  if (!STDIN_INTERPRETERS.has(name) && !PYTHON.test(name)) return false;
  const { values, inline } = interpreterSyntax(name);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-") return true;
    if (inline.test(a)) return false;
    if (values.has(a)) i++;
    else if (!a.startsWith("-")) return false;
  }
  return true;
}
function runsUnknownScript(name, args) {
  if (name === null) return false;
  const shell = SHELLS.has(name);
  if (!shell && !STDIN_INTERPRETERS.has(name) && !PYTHON.test(name)) return false;
  const { values, inline } = shell ? { values: SHELL_VALUE_OPTIONS, inline: null } : interpreterSyntax(name);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return args[i + 1]?.includes(UNKNOWN) === true;
    if (shell && SHELL_STDIN_FLAG.test(a)) return false;
    if (values.has(a)) i++;
    else if (inline?.test(a) === true) return args[i + 1]?.includes(UNKNOWN) === true;
    else if (!a.startsWith("-") && !(shell && a.startsWith("+"))) return a.includes(UNKNOWN);
  }
  return false;
}
var ECHO_OPTIONS = /^-[neE]+$/;
function printedText(source) {
  const [program, ...args] = source.words;
  if (source.words.some((w) => w.includes(UNKNOWN)) || source.scripts.length > 0) return null;
  if (program === "echo") {
    let n = 0;
    while (n < args.length && ECHO_OPTIONS.test(args[n])) n++;
    const text = args.slice(n).join(" ");
    return text.includes("\\") ? null : text;
  }
  if (program === "printf") return args.length === 1 && !/[%\\]/.test(args[0]) ? args[0] : null;
  if (program === "cat" && args.every((a) => a === "-")) {
    const text = stdinTextOf(source);
    return text.length > 0 ? text.join("\n") : null;
  }
  return null;
}
function stdinTextOf(segment) {
  return segment.redirects.flatMap((r) => {
    if (!STDIN_TEXT.test(r.op)) return [];
    return [r.op.endsWith("<<<") ? r.target : r.body ?? ""];
  });
}
function stdinScriptsOf(segment, name, args, reading) {
  const texts = stdinTextOf(segment);
  if (!readsStdinScript(name, args)) return texts;
  const last = [...segment.redirects].reverse().find((r) => STDIN_TEXT.test(r.op) || STDIN_FILE.test(r.op));
  if (last !== void 0) {
    if (STDIN_FILE.test(last.op)) reading.unreadable ??= `${name} runs a script read from a file`;
    return texts;
  }
  if (segment.pipedFrom === null) return texts;
  const piped = segment.pipedFrom === "unknown" ? null : printedText(segment.pipedFrom);
  if (piped === null) {
    reading.unreadable ??= `${name} runs a script piped from a command the gate can't read`;
    return texts;
  }
  return [...texts, piped];
}
function stdinShellScript(name, args, stdin) {
  if (name === null || !SHELLS.has(name) || stdin.length === 0) return null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SHELL_VALUE_OPTIONS.has(a)) i++;
    else if (a !== "-" && !a.startsWith("-") && !a.startsWith("+")) return null;
  }
  return stdin.join("\n");
}
function assignedNames(words) {
  return words.map((w) => assignmentOf(w)?.name ?? w.slice(0, w.indexOf("=")));
}
function assignedValues(words) {
  return words.map((w) => assignmentOf(w)?.value ?? w.slice(w.indexOf("=") + 1));
}
function stripAssignments(words) {
  const first = words.findIndex((w) => !ASSIGNMENT2.test(w));
  return first === -1 ? [] : words.slice(first);
}
function expandTilde(p, home) {
  if (p === "~") return home;
  if (p.startsWith("~/")) return home + p.slice(1);
  return p;
}
function resolvePath(p, cwd, home) {
  if (p.includes(UNKNOWN)) return cwd;
  return import_node_path3.default.resolve(cwd, expandTilde(p, home));
}
function dirAfter(words, at, pushed, home, globs, cdpath = null) {
  let p = 0;
  while (CD_PREFIXES.has(words[p])) p++;
  const [verb, ...args] = words.slice(p);
  if (verb === "cd") return cdTarget(verb, args, at, home, globs, cdpath);
  if (verb === "pushd") {
    if (args.length === 0 || STACK_ENTRY.test(args[0])) return lostAt(at, [verb, ...args].join(" "));
    if (args.includes("-n")) return at;
    pushed.push(at.dir);
    return cdTarget(verb, args, at, home, globs, cdpath);
  }
  if (verb === "popd") return lostAt({ dir: pushed.pop() ?? at.dir, lost: at.lost }, [verb, ...args].join(" "));
  return at;
}
var CDPATH = "CDPATH";
var ZSH_CDPATH = "cdpath";
function cdpathAfter(assigned, exported, cdpath) {
  let result = cdpath;
  for (const word of [...assigned, ...exported]) {
    tick();
    const assignment = assignmentOf(word);
    if (assignment === null || assignment.name !== CDPATH && assignment.name !== ZSH_CDPATH) continue;
    const { name, index, append, value } = assignment;
    if (index !== null && /[[$`]|\u0000/.test(index)) {
      result = compactCdpath([...result ?? [], UNKNOWN]);
    } else if (index !== null || append && name === ZSH_CDPATH) {
      if (value !== "") result = compactCdpath([...result ?? [], value]);
    } else if (append) {
      const [first, ...rest] = value.split(":");
      const entries = result === null || result.length === 0 ? [first, ...rest] : [...result.slice(0, -1), result[result.length - 1] + first, ...rest];
      result = entries.length === 1 && entries[0] === "" ? null : compactCdpath(entries);
    } else {
      result = value === "" ? name === ZSH_CDPATH ? result : null : compactCdpath(value.split(":"));
    }
  }
  return result;
}
function compactCdpath(entries) {
  if (entries.length === 0) return entries;
  const last = entries.length - 1;
  const kept = [];
  for (let i = 0; i < last && kept.length < 2; i++) {
    if (entries[i] !== "" && entries[i] !== ".") kept.push(entries[i]);
  }
  kept.push(entries[last]);
  return kept;
}
function cdpathArrayOf(commandWords, assigned) {
  const words = commandWords.length === 0 ? assigned : VARIABLE_BUILTINS.has(commandWords[0]) ? commandWords.slice(1) : [];
  const last = words.length === 0 ? null : assignmentOf(words[words.length - 1]);
  if (last === null || last.value !== "" || last.index !== null || last.name !== CDPATH && last.name !== ZSH_CDPATH) return null;
  return last.append ? "append" : "set";
}
function cdpathSearch(target, cdpath) {
  if (cdpath === null || import_node_path3.default.isAbsolute(target) || target.startsWith("~") || /^\.\.?(?:\/|$)/.test(target)) return void 0;
  const elsewhere = cdpath.filter((entry) => entry !== "" && entry !== ".");
  if (elsewhere.length === 0) return void 0;
  return elsewhere.length === 1 && !elsewhere[0].includes(UNKNOWN) ? elsewhere[0] : null;
}
var CD_OPTION = /^-[LPeqs@]+$/;
var STACK_ENTRY = /^[+-][0-9]+$/;
function lostAt(at, why) {
  return { dir: at.dir, lost: { why, pattern: null } };
}
function cdTarget(verb, args, at, home, globs, cdpath = null) {
  const why = [verb, ...args].join(" ");
  let rest = args;
  while (rest.length > 0 && CD_OPTION.test(rest[0])) rest = rest.slice(1);
  if (rest[0] === "--") rest = rest.slice(1);
  if (rest.length === 0) return home.includes(UNKNOWN) ? lostAt(at, why) : { dir: home, lost: null };
  const target = rest[0];
  if (rest.length > 1 || target === "-" || STACK_ENTRY.test(target) || target.includes(UNKNOWN)) return lostAt(at, why);
  const glob = globs.get(target);
  if (glob !== void 0) {
    const base = at.lost === null ? escapeGlob(at.dir) : at.lost.pattern;
    const pattern2 = base === null ? null : globPathOf(glob, base, home);
    return { dir: at.dir, lost: { why, pattern: pattern2 } };
  }
  const dir = resolvePath(target, at.dir, home);
  const searched = cdpathSearch(target, cdpath);
  if (searched !== void 0) {
    const pattern2 = searched === null || at.lost !== null ? null : escapeGlob(resolvePath(import_node_path3.default.join(searched, target), at.dir, home));
    return { dir, lost: { why, pattern: pattern2 } };
  }
  if (at.lost === null || import_node_path3.default.isAbsolute(expandTilde(target, home))) return { dir, lost: null };
  const pattern = at.lost.pattern === null ? null : globPathOf(escapeGlob(target), at.lost.pattern, home);
  return { dir, lost: { why: at.lost.why, pattern } };
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
function spelledOutTarget(args, valueLetters) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return [...out, ...args.slice(i)];
    const long = /^--(t[a-z-]*)(?:=(.*))?$/s.exec(a);
    if (long !== null && "target-directory".startsWith(long[1])) {
      const dir2 = long[2] ?? args[++i];
      if (dir2 !== void 0) out.push(`--target-directory=${dir2}`);
      continue;
    }
    if (!/^-[^-]/.test(a)) {
      out.push(a);
      continue;
    }
    let n = 1;
    while (n < a.length && a[n] !== "t" && !valueLetters.includes(a[n])) n++;
    if (a[n] !== "t") {
      out.push(a);
      continue;
    }
    if (n > 1) out.push(a.slice(0, n));
    const dir = n + 1 < a.length ? a.slice(n + 1) : args[++i];
    if (dir !== void 0) out.push(`--target-directory=${dir}`);
  }
  return out;
}
function destination(args, values = [], valueLetters = "S") {
  const spelled = spelledOutTarget(args, valueLetters);
  const target = spelled.find((a) => a.startsWith("--target-directory="));
  if (target !== void 0) return [target.slice("--target-directory=".length)];
  return operands(spelled, values).slice(-1);
}
var TRUNCATE_VALUES = ["-s", "-r", "--size", "--reference"];
var LN_VALUES = ["-t", "-S", "--target-directory", "--suffix"];
var INSTALL_VALUES = ["-m", "-o", "-g", "-t", "-S", "--mode", "--owner", "--group", "--target-directory", "--suffix"];
var RESTORE_VALUES = ["-s", "--source", "--pathspec-from-file"];
var RSYNC_VALUES = [
  "-e",
  "--rsh",
  "-f",
  "--filter",
  "--exclude",
  "--include",
  "--exclude-from",
  "--include-from",
  "--files-from",
  "-T",
  "--temp-dir",
  "--partial-dir",
  "--backup-dir",
  "--suffix",
  "--chmod",
  "--chown",
  "-B",
  "--block-size",
  "--rsync-path",
  "-M",
  "--remote-option",
  "--log-file",
  "--password-file",
  "--port",
  "--compare-dest",
  "--copy-dest",
  "--link-dest",
  "--max-size",
  "--min-size",
  "--timeout",
  "--bwlimit",
  "--out-format"
];
function rsyncWrites(args) {
  const named2 = operands(args, RSYNC_VALUES);
  return named2.length > 1 ? named2.slice(-1) : [];
}
function tarExtracts(args) {
  const first = args[0] ?? "";
  if (/^[^-]*x/.test(first) && !first.includes("/")) return true;
  return args.some((a) => a === "--extract" || a === "--get" || /^-[A-Za-z]*x/.test(a));
}
var TAR_DIRECTORY = /^--(?:cd|di(?:r(?:e(?:c(?:t(?:o(?:r(?:y)?)?)?)?)?)?)?)(?:=(.*))?$/s;
function tarWrites(args) {
  if (!tarExtracts(args)) return [];
  const dirs = [];
  args.forEach((a, i) => {
    const long = TAR_DIRECTORY.exec(a);
    if ((a === "-C" || long !== null && long[1] === void 0) && i + 1 < args.length) dirs.push(args[i + 1]);
    else if (long !== null && long[1] !== void 0) dirs.push(long[1]);
    else dirs.push(...clusterValue(a, args[i + 1], "C", TAR_VALUE_LETTERS));
  });
  const first = args[0] ?? "";
  if (!first.startsWith("-") && first.includes("C")) {
    if (/[FgHKLNVs]/.test(first)) return [UNKNOWN];
    const letters = [...first].filter((l) => l === "C" || TAR_VALUE_LETTERS.includes(l));
    const dir = args[1 + letters.indexOf("C")];
    dirs.push(dir ?? UNKNOWN);
  }
  return dirs.length > 0 ? dirs : ["."];
}
var TAR_VALUE_LETTERS = "bfITX";
function clusterValue(word, next, letter, valueLetters) {
  if (!/^-[^-]/.test(word)) return [];
  for (let n = 1; n < word.length; n++) {
    if (word[n] === letter) {
      if (n === 1 && word.length === 2) return [];
      const value = n + 1 < word.length ? word.slice(n + 1) : next;
      return value === void 0 ? [] : [value];
    }
    if (valueLetters.includes(word[n])) return [];
  }
  return [];
}
var UNZIP_NO_WRITE = /^-[A-Za-z]*[ltpvZz]/;
function unzipWrites(args) {
  if (args.some((a) => UNZIP_NO_WRITE.test(a))) return [];
  const d = args.indexOf("-d");
  if (d !== -1 && d + 1 < args.length) return [args[d + 1]];
  const dirs = args.flatMap((a, i) => clusterValue(a, args[i + 1], "d", "P"));
  return dirs.length === 0 ? ["."] : dirs;
}
var CP_VALUES = ["-S", "--suffix", "-t", "--target-directory"];
var CP_TARGET = /^--target-directory=(.*)$/s;
function cpOperands(words) {
  const args = spelledOutTarget(words, "S");
  const named2 = operands(args, CP_VALUES);
  for (let i = 0; i < args.length && args[i] !== "--"; i++) {
    const attached = CP_TARGET.exec(args[i]);
    if (attached !== null) return { sources: named2, dest: attached[1], targetDir: true };
  }
  return { sources: named2.slice(0, -1), dest: named2.at(-1) ?? null, targetDir: false };
}
function cpWrites(args, globs) {
  const { sources, dest: last, targetDir } = cpOperands(args);
  if (last === null) return [];
  const dest = [last];
  const into = !targetDir && last.endsWith("/") && sources.length > 0;
  const plain = (src) => {
    const base = import_node_path3.default.posix.basename(src);
    return !src.includes(UNKNOWN) && !globs.has(src) && !src.endsWith("/") && base !== "." && base !== "..";
  };
  const whole = args.some((a) => a === "-T" || a === "--no-target-directory" || /^-[A-Za-z]*T/.test(a));
  if (!into || whole || globs.has(dest[0]) || !sources.every(plain)) return dest;
  return sources.map((src) => dest[0] + import_node_path3.default.posix.basename(src));
}
var BACKUP_PROGRAMS = /* @__PURE__ */ new Set(["cp", "mv", "ln", "install"]);
var BACKUP_VALUE_LETTERS = /* @__PURE__ */ new Set(["S", "t", "m", "o", "g"]);
var BACKUP_LONG = /^--(?:backup|suffix)(?:=.*)?$/;
function makesBackup(name, args) {
  if (!BACKUP_PROGRAMS.has(plainWriterName(name))) return false;
  for (const a of args) {
    if (a === "--") return false;
    if (BACKUP_LONG.test(a)) return true;
    if (!a.startsWith("-") || a.startsWith("--")) continue;
    for (const letter of a.slice(1)) {
      if (letter === "b" || letter === "S") return true;
      if (BACKUP_VALUE_LETTERS.has(letter)) break;
    }
  }
  return false;
}
var FIND_LEADING_FLAGS = /^-(?:[HLPEXdsx]+|O[0-9]*)$/;
var FIND_EXPRESSION_START = /* @__PURE__ */ new Set(["(", ")", "!", ","]);
function findStarts(args) {
  const starts = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-D") i++;
    else if (a === "-f" && i + 1 < args.length) starts.push(args[++i]);
    else if (FIND_LEADING_FLAGS.test(a)) continue;
    else if (a.startsWith("-") || FIND_EXPRESSION_START.has(a)) break;
    else starts.push(a);
  }
  return starts.length > 0 ? starts : ["."];
}
var RM_RECURSIVE = /^(?:-(?=[A-Za-z]*[rR])[A-Za-z]+|--recursive)$/;
var CHANGE_RECURSIVE = /^(?:-(?=[A-Za-z]*R)[A-Za-z]+|--recursive)$/;
function hasOption(args, option) {
  const end = args.indexOf("--");
  return (end === -1 ? args : args.slice(0, end)).some((a) => option.test(a));
}
function recursiveOperands(name, args) {
  switch (name === null ? null : plainWriterName(name)) {
    case "rm":
      return hasOption(args, RM_RECURSIVE) ? operands(args) : [];
    case "chmod":
    case "chown":
      return hasOption(args, CHANGE_RECURSIVE) ? operands(args).slice(1) : [];
    case "find":
      return args.includes("-delete") ? findStarts(args) : [];
    default:
      return [];
  }
}
var DITTO_VALUES = ["--arch", "--bom", "--zlibCompressionLevel"];
var GNU_WRITERS = /* @__PURE__ */ new Set([
  "cp",
  "mv",
  "ln",
  "install",
  "rsync",
  "tar",
  "ditto",
  "tee",
  "rm",
  "dd",
  "touch",
  "truncate",
  "shred",
  "chmod",
  "chown",
  "mkdir",
  "rmdir",
  "sed",
  "split",
  "csplit",
  "find",
  "xargs"
]);
function plainWriterName(name) {
  return name.startsWith("g") && GNU_WRITERS.has(name.slice(1)) ? name.slice(1) : name;
}
function operandWrites(name, args, globs, tempArgs) {
  switch (name === null ? null : plainWriterName(name)) {
    case "ditto": {
      const named2 = operands(args, DITTO_VALUES);
      return named2.length > 1 ? named2.slice(-1) : [];
    }
    case "rsync":
      return rsyncWrites(args);
    case "tar":
    case "bsdtar":
      return tarWrites(args);
    case "unzip":
      return unzipWrites(args);
    case "mktemp":
      return mktempWrites(args, tempArgs);
    case "mv": {
      const spelled = spelledOutTarget(args, "S");
      return [...operands(spelled), ...spelled.filter((a) => a.startsWith("--target-directory=")).flatMap((a) => destination([a]))];
    }
    case "rm":
    case "tee":
    case "touch":
      return operands(args);
    case "cp":
      return cpWrites(args, globs);
    case "ln":
      return destination(args, LN_VALUES);
    case "install":
      return destination(args, INSTALL_VALUES, "mogS");
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
function scriptCommandParts(script, part, reading, depth) {
  if (script === null || script.commands.length === 0) return [];
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  return script.commands.flatMap((command) => readScript(command, part.cwd, reading, depth + 1, part.dotGlob));
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
      if (spec.inPlaceLong.some((full) => longOption(flag, full, 3))) inPlace = true;
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
function unknownGitDir(args) {
  for (let i = 0; i < args.length && args[i].startsWith("-"); i += GIT_VALUE_OPTIONS.has(args[i]) ? 2 : 1) {
    if (args[i] === "-C" && args[i + 1]?.includes(UNKNOWN) === true) return { why: `git -C ${args[i + 1]}`, pattern: null };
  }
  return null;
}
function readGit(args, cwd, home) {
  let dir = cwd;
  let unknown;
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    const a = args[i];
    if (a === "-C" && i + 1 < args.length) dir = resolvePath(args[i + 1], dir, home);
    const attached = a.startsWith("--") && a.includes("=") && GIT_VALUE_OPTIONS.has(a.slice(0, a.indexOf("=")));
    if (!GIT_VALUE_OPTIONS.has(a) && !GIT_FLAG_OPTIONS.has(a) && !attached) unknown ??= a;
    i += GIT_VALUE_OPTIONS.has(a) ? 2 : 1;
  }
  if (i >= args.length) return null;
  const subcommand = args[i];
  const rest = args.slice(i + 1);
  const noted = unknown === void 0 ? {} : { unknownOption: unknown };
  if (PUSH_LIKE.has(subcommand)) return { subcommand: "push", args: rest, dir, ...noted };
  if (subcommand === "subtree" && rest[0] === "push") return { subcommand: "push", args: subtreePushWords(rest.slice(1)), dir, ...noted };
  return { subcommand, args: rest, dir, ...noted };
}
function subtreePushWords(args) {
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (SUBTREE_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith("-")) words.push(args[i]);
  }
  return words;
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
function readEditTarget(toolName, toolInput, cwd, home) {
  if (!isEditTool(toolName) || !isRecord(toolInput)) return null;
  const rawPath = toolInput[PATH_FIELD[toolName]];
  if (typeof rawPath !== "string") return null;
  return { tool: toolName, filePath: resolvePath2(rawPath, cwd, home) };
}
function readEditCall(toolName, toolInput, cwd, home, readFile) {
  const target = readEditTarget(toolName, toolInput, cwd, home);
  if (target === null || !isRecord(toolInput)) return null;
  const changes = readChanges(target.tool, toolInput, target.filePath, readFile);
  return changes === null ? null : { ...target, changes };
}

// src/gate-run/git-bin.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
var TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp", "/var/folders", "/private/var/folders", "/dev/shm"];
var MAX_HOPS = 8;
function inTemp(file) {
  const roots = [...TEMP_ROOTS];
  const tmp = process.env.TMPDIR?.replace(/\/+$/, "");
  if (tmp !== void 0 && import_node_path4.default.isAbsolute(tmp)) roots.push(tmp);
  return roots.some((root) => file === root || file.startsWith(`${root}/`));
}
function ownerOk(stats) {
  return stats.uid === 0 || stats.uid === process.getuid?.();
}
function physical(file) {
  try {
    return import_node_path4.default.join(import_node_fs.default.realpathSync(import_node_path4.default.dirname(file)), import_node_path4.default.basename(file));
  } catch {
    return null;
  }
}
function checkedProgram(file) {
  if (!import_node_path4.default.isAbsolute(file)) return false;
  let current2 = file;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const real = physical(current2);
    if (inTemp(import_node_path4.default.normalize(current2)) || real === null || inTemp(real)) return false;
    const stats = import_node_fs.default.lstatSync(real, { throwIfNoEntry: false });
    if (stats === void 0 || !ownerOk(stats)) return false;
    if (!stats.isSymbolicLink()) return stats.isFile() && (stats.mode & 73) !== 0;
    current2 = import_node_path4.default.resolve(import_node_path4.default.dirname(real), import_node_fs.default.readlinkSync(real));
  }
  return false;
}
function developerGit() {
  try {
    const dir = (0, import_node_child_process.execFileSync)("/usr/bin/xcode-select", ["-p"], { env: {}, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3e3 }).trim();
    return import_node_path4.default.isAbsolute(dir) ? import_node_path4.default.join(dir, "usr", "bin", "git") : null;
  } catch {
    return null;
  }
}
var resolved;
function gitBinary() {
  if (resolved !== void 0) return resolved;
  const candidates = process.platform === "darwin" ? [developerGit()] : ["/usr/bin/git", "/bin/git"];
  const found2 = candidates.find((file) => file !== null && checkedProgram(file));
  if (found2 === void 0) throw new Error("no git at a fixed, checked path");
  resolved = found2;
  return found2;
}

// src/tool-gate/git-reader.ts
var import_node_child_process2 = require("node:child_process");
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var TIMEOUT_MS = 1500;
var WOULD_REMOVE = "Would remove ";
var MAX_DRY_RUN_LINES = 2048;
var MAX_OUTPUT_BYTES = 1024 * 1024;
var HARDENING = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];
var runHere = (gitBin, args, cwd, timeoutMs, maxLines) => runGit(gitBin, args, cwd, timeoutMs, maxLines);
var runner = runHere;
function setGitRunner(next) {
  runner = next ?? runHere;
}
function killGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
  }
}
function gitEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith("GIT_")) env[name] = value;
  return { ...env, LC_ALL: "C", LANG: "C", LANGUAGE: "C" };
}
function runGit(gitBin, args, cwd, timeoutMs, maxLines = Infinity, tracker = null) {
  return new Promise((resolve2) => {
    let child;
    try {
      child = (0, import_node_child_process2.spawn)(gitBin, [...HARDENING, ...args], { cwd, env: gitEnv(), detached: true, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve2(null);
      return;
    }
    const pid = child.pid;
    if (pid !== void 0) tracker?.started(pid);
    const chunks = [];
    let bytes = 0;
    let lines = 0;
    let done = false;
    const finish = (out) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pid !== void 0) {
        killGroup(pid);
        tracker?.ended(pid);
      }
      resolve2(out);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.stdout?.on("data", (chunk) => {
      chunks.push(chunk);
      bytes += chunk.length;
      for (const byte of chunk) if (byte === 10) lines++;
      if (bytes > MAX_OUTPUT_BYTES || lines > maxLines) finish(null);
    });
    child.once("error", () => finish(null));
    child.once("close", (code) => finish(code === 0 ? Buffer.concat(chunks).toString("utf8") : null));
  });
}
function redirectedRepo(dir, projectRoot) {
  for (let at = dir; ; at = import_node_path5.default.dirname(at)) {
    const stat = import_node_fs2.default.lstatSync(import_node_path5.default.join(at, ".git"), { throwIfNoEntry: false });
    if (stat !== void 0) return !stat.isDirectory() && at !== projectRoot;
    if (import_node_path5.default.dirname(at) === at) return false;
  }
}
function nearestFolder(dir) {
  const isFolder = (p) => {
    try {
      return import_node_fs2.default.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
    } catch {
      return false;
    }
  };
  let at = dir;
  while (!isFolder(at) && import_node_path5.default.dirname(at) !== at) at = import_node_path5.default.dirname(at);
  return at;
}
function checkedGit() {
  try {
    return gitBinary();
  } catch {
    return null;
  }
}
function gitReaderFor(projectRoot, gitBin) {
  const run = async (_bin, args, cwd, timeoutMs, maxLines) => {
    const bin = gitBin ?? checkedGit();
    return bin === null ? null : runner(bin, args, cwd, timeoutMs, maxLines);
  };
  return {
    async currentBranch(dir, timeoutMs = TIMEOUT_MS) {
      const out = await run("", ["symbolic-ref", "--short", "-q", "HEAD"], nearestFolder(dir), timeoutMs, Infinity);
      const branch = out?.trim() ?? "";
      return branch === "" ? null : branch;
    },
    async wouldClean(dir, options, pathspecs, timeoutMs = TIMEOUT_MS) {
      try {
        if (redirectedRepo(dir, projectRoot)) return null;
      } catch {
        return null;
      }
      const args = ["-c", "core.quotePath=false", "clean", ...options, "--dry-run", "--", ...pathspecs];
      const out = await run("", args, dir, timeoutMs, MAX_DRY_RUN_LINES);
      if (out === null) return null;
      const removed = out.split("\n").filter((line) => line.startsWith(WOULD_REMOVE)).map((line) => line.slice(WOULD_REMOVE.length));
      return removed.some((p) => p.startsWith('"')) ? null : removed;
    }
  };
}
var realGitReader = gitReaderFor(null);
function ignoredPaths(top, paths, timeoutMs) {
  const bin = checkedGit();
  if (bin === null) return null;
  const run = (0, import_node_child_process2.spawnSync)(bin, [...HARDENING, "check-ignore", "--", ...paths], { cwd: top, env: gitEnv(), encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"] });
  if (run.status !== 0 && run.status !== 1) return null;
  return run.stdout.split("\n").filter((line) => line !== "");
}

// src/tool-gate/path-resolver.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var MAX_LINKS = 40;
var NOTHING_BELOW = /* @__PURE__ */ new Set(["ENOENT", "ENAMETOOLONG", "ENOTDIR"]);
function namesReversed(p) {
  return p.split("/").filter((name) => name !== "" && name !== ".").reverse();
}
function parentOf(resolved2) {
  const slash = resolved2.lastIndexOf("/");
  return slash <= 0 ? "/" : resolved2.slice(0, slash);
}
var NO_LIMITS = { maxLookups: Infinity, maxSteps: Infinity };
function resolve(absPath, lookup, step) {
  let resolved2 = "/";
  let links = 0;
  let missingDepth = 0;
  const todo = namesReversed(absPath);
  for (let name = todo.pop(); name !== void 0; name = todo.pop()) {
    step();
    if (name === "..") {
      resolved2 = parentOf(resolved2);
      if (missingDepth > 0) missingDepth--;
      continue;
    }
    const next = resolved2 === "/" ? `/${name}` : `${resolved2}/${name}`;
    if (missingDepth > 0) {
      resolved2 = next;
      missingDepth++;
      continue;
    }
    const { target, nothingBelow } = lookup(next);
    if (nothingBelow) missingDepth = 1;
    if (target === null) {
      resolved2 = next;
      continue;
    }
    if (++links > MAX_LINKS) return null;
    if (target.startsWith("/")) resolved2 = "/";
    todo.push(...namesReversed(target));
  }
  return resolved2;
}
function createPathResolver(limits = NO_LIMITS, readlink = import_node_fs3.default.readlinkSync) {
  const lookups = /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  let steps2 = 0;
  const step = () => {
    tick();
    if (++steps2 > limits.maxSteps) throw new OverBudget(`it makes the gate walk more than ${limits.maxSteps} path names`);
  };
  const lookup = (p) => {
    const known = lookups.get(p);
    if (known !== void 0) return known;
    if (lookups.size >= limits.maxLookups) throw new OverBudget(`it makes the gate look up more than ${limits.maxLookups} paths on disk`);
    let found2;
    try {
      found2 = { target: readlink(p), nothingBelow: false };
    } catch (error) {
      found2 = { target: null, nothingBelow: NOTHING_BELOW.has(error.code ?? "") };
    }
    lookups.set(p, found2);
    return found2;
  };
  return {
    realpath(absPath) {
      const known = results.get(absPath);
      if (known !== void 0) return known;
      const resolved2 = resolve(absPath, lookup, step) ?? absPath;
      results.set(absPath, resolved2);
      return resolved2;
    }
  };
}

// src/tool-gate/regular-file.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
function readRegularFile(absPath, maxBytes, noFollow = false) {
  const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = import_node_fs4.default.constants;
  let fd;
  try {
    fd = import_node_fs4.default.openSync(absPath, O_RDONLY | O_NONBLOCK | (noFollow ? O_NOFOLLOW : 0));
  } catch (error) {
    return error.code === "ENOENT" ? "missing" : "not-regular";
  }
  try {
    const stat = import_node_fs4.default.fstatSync(fd);
    if (!stat.isFile() || stat.size >= maxBytes) return "not-regular";
    return { text: import_node_fs4.default.readFileSync(fd, "utf8") };
  } catch {
    return "not-regular";
  } finally {
    import_node_fs4.default.closeSync(fd);
  }
}

// src/tool-gate/repo-finder.ts
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);
var MAX_POINTER_BYTES = 4096;
var GITDIR_LINE = /^gitdir: (.+?)\r?\n?$/;
var HEAD_CONTENT = /^(?:ref:\s*refs\/.*|[0-9a-f]{40}|[0-9a-f]{64})\s*$/;
var WORKTREES = "worktrees";
var MODULES = "modules";
var GIT = ".git";
function isDir(p) {
  try {
    return import_node_fs5.default.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
function pointer(file) {
  const read = readRegularFile(file, MAX_POINTER_BYTES);
  return typeof read === "object" ? read.text : null;
}
function commonDirOf(gitDir) {
  const file = import_node_path6.default.join(gitDir, "commondir");
  if (import_node_fs5.default.lstatSync(file, { throwIfNoEntry: false }) === void 0) return gitDir;
  const text = pointer(file);
  return text === null ? null : import_node_path6.default.resolve(gitDir, text.trim());
}
function isGitDir(dir) {
  const head = import_node_path6.default.join(dir, "HEAD");
  const stat = import_node_fs5.default.lstatSync(head, { throwIfNoEntry: false });
  if (stat === void 0) return false;
  if (stat.isSymbolicLink()) {
    if (!import_node_fs5.default.readlinkSync(head).startsWith("refs/")) return false;
  } else {
    const text = pointer(head);
    if (text === null || !HEAD_CONTENT.test(text)) return false;
  }
  const common = commonDirOf(dir);
  return common !== null && isDir(import_node_path6.default.join(common, "objects")) && isDir(import_node_path6.default.join(common, "refs"));
}
function found(top, gitDir, viaFile) {
  const commonDir = commonDirOf(gitDir);
  if (commonDir === null) return { kind: "unsure", why: `${import_node_path6.default.join(gitDir, "commondir")} can't be read` };
  return { kind: "repo", top, gitDir, commonDir, viaFile };
}
function walk2(start) {
  for (let dir = start; ; dir = import_node_path6.default.dirname(dir)) {
    tick();
    const dotGit = import_node_path6.default.join(dir, GIT);
    const stat = import_node_fs5.default.lstatSync(dotGit, { throwIfNoEntry: false });
    if (stat?.isDirectory() === true) {
      if (isGitDir(dotGit)) return found(dir, dotGit, false);
    } else if (stat?.isFile() === true) {
      const match = GITDIR_LINE.exec(pointer(dotGit) ?? "");
      const gitDir = match === null ? null : import_node_path6.default.resolve(dir, match[1]);
      if (gitDir === null || !isGitDir(gitDir)) return { kind: "unsure", why: `${dotGit} points at no git folder` };
      return found(dir, gitDir, true);
    } else if (stat !== void 0) {
      return { kind: "unsure", why: `${dotGit} is neither a folder nor a file` };
    }
    if (isGitDir(dir)) return { kind: "unsure", why: `${dir} is itself a git folder` };
    if (import_node_path6.default.dirname(dir) === dir) return { kind: "none" };
  }
}
function findRepo(dir) {
  try {
    return walk2(import_node_fs5.default.realpathSync(dir));
  } catch (error) {
    if (error instanceof OverBudget) throw error;
    return { kind: "unsure", why: `${dir} can't be read` };
  }
}
function isDotGit(dir) {
  return import_node_path6.default.basename(dir) === GIT;
}
function ownGitFolder(gitDir, commonDir) {
  const parent = import_node_path6.default.dirname(gitDir);
  if (import_node_path6.default.basename(parent) === WORKTREES) {
    const main = import_node_path6.default.dirname(parent);
    return isDotGit(main) && import_node_fs5.default.realpathSync(commonDir) === import_node_fs5.default.realpathSync(main);
  }
  return commonDir === gitDir && gitDir.includes(`${import_node_path6.default.sep}${GIT}${import_node_path6.default.sep}${MODULES}${import_node_path6.default.sep}`);
}
function repoTrust(dir) {
  let at = dir;
  while (!isDir(at) && import_node_path6.default.dirname(at) !== at) {
    tick();
    at = import_node_path6.default.dirname(at);
  }
  const repo = findRepo(at);
  if (repo.kind === "none") return "none";
  if (repo.kind === "unsure") return { untrusted: repo.why };
  try {
    if (!repo.viaFile) {
      return repo.commonDir === repo.gitDir ? "trusted" : { untrusted: `${import_node_path6.default.join(repo.gitDir, "commondir")} sends git to another .git folder's settings` };
    }
    const gitDir = import_node_fs5.default.realpathSync(repo.gitDir);
    if (ownGitFolder(gitDir, repo.commonDir === repo.gitDir ? gitDir : repo.commonDir)) return "trusted";
  } catch {
  }
  return { untrusted: `${import_node_path6.default.join(repo.top, GIT)} points at a git folder outside a .git folder` };
}

// src/tool-gate/recorder.ts
var import_node_path11 = __toESM(require("node:path"), 1);

// src/tool-gate/state-store.ts
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_path9 = __toESM(require("node:path"), 1);

// src/gate-run/run-store.ts
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);

// src/gate-run/messages.ts
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

// src/gate-run/run-store.ts
var SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
var MAX_AGE_MS = 2 * 24 * 3600 * 1e3;
var REPOS_FILE = "repos.json";
var KNOWN_REASONS = new Set(Object.values(REASONS));
function isSafeId(id) {
  return typeof id === "string" && SAFE_ID.test(id);
}
function runRoot(home) {
  return import_node_path7.default.join(home, ".oss", "gate-state");
}
function privateFolder(dir) {
  try {
    import_node_fs6.default.mkdirSync(dir, { mode: 448 });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  if (!import_node_fs6.default.lstatSync(dir).isDirectory()) throw new Error("gate-run state folder is not a plain folder");
}
function sessionFolder(home, sessionId) {
  if (!import_node_path7.default.isAbsolute(home)) throw new Error("HOME is not an absolute path");
  if (!isSafeId(sessionId)) throw new Error("session_id is not a safe file name");
  import_node_fs6.default.mkdirSync(import_node_path7.default.join(home, ".oss"), { recursive: true, mode: 448 });
  privateFolder(runRoot(home));
  const dir = import_node_path7.default.join(runRoot(home), sessionId);
  privateFolder(dir);
  return dir;
}
function sessionState(home, sessionId) {
  if (!import_node_path7.default.isAbsolute(home) || !isSafeId(sessionId)) return "unusable";
  for (const dir of [runRoot(home), import_node_path7.default.join(runRoot(home), sessionId)]) {
    const stats = import_node_fs6.default.lstatSync(dir, { throwIfNoEntry: false });
    if (stats === void 0) return "missing";
    if (!stats.isDirectory()) return "unusable";
  }
  return "ok";
}
function existingSessionFolder(home, sessionId) {
  return sessionState(home, sessionId) === "ok" ? import_node_path7.default.join(runRoot(home), sessionId) : null;
}
function writePrivateFile(file, text) {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW, O_NONBLOCK } = import_node_fs6.default.constants;
  const fd = import_node_fs6.default.openSync(file, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_NONBLOCK, 384);
  try {
    if (!import_node_fs6.default.fstatSync(fd).isFile()) throw new Error("gate-run state file is not a regular file");
    import_node_fs6.default.writeFileSync(fd, text);
  } finally {
    import_node_fs6.default.closeSync(fd);
  }
}
function readPrivateFile(file) {
  let fd;
  try {
    fd = import_node_fs6.default.openSync(file, import_node_fs6.default.constants.O_RDONLY | import_node_fs6.default.constants.O_NOFOLLOW | import_node_fs6.default.constants.O_NONBLOCK);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    if (!import_node_fs6.default.fstatSync(fd).isFile()) throw new Error("gate-run state file is not a regular file");
    return import_node_fs6.default.readFileSync(fd, "utf8");
  } finally {
    import_node_fs6.default.closeSync(fd);
  }
}
function markFile(home, sessionId, agentId, which) {
  if (!isSafeId(agentId)) throw new Error("agent_id is not a safe file name");
  return import_node_path7.default.join(sessionFolder(home, sessionId), `${agentId}.${which}`);
}
function mark(home, sessionId, agentId, which) {
  writePrivateFile(markFile(home, sessionId, agentId, which), `${(/* @__PURE__ */ new Date()).toISOString()}
`);
}
function appendPrivateFile(file, text) {
  const { O_WRONLY, O_CREAT, O_APPEND, O_NOFOLLOW, O_NONBLOCK } = import_node_fs6.default.constants;
  const fd = import_node_fs6.default.openSync(file, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW | O_NONBLOCK, 384);
  try {
    if (!import_node_fs6.default.fstatSync(fd).isFile()) throw new Error("gate-run state file is not a regular file");
    import_node_fs6.default.writeSync(fd, text);
  } finally {
    import_node_fs6.default.closeSync(fd);
  }
}
function reviewedReposFor(home, sessionId) {
  const dir = existingSessionFolder(home, sessionId);
  if (dir === null) return [];
  try {
    const value = JSON.parse(readPrivateFile(import_node_path7.default.join(dir, REPOS_FILE)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((repo) => typeof repo === "string" && import_node_path7.default.isAbsolute(repo) && !repo.includes("'"));
  } catch {
    return [];
  }
}

// src/tool-gate/local-exclude.ts
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);
var OSS_STATE = [import_node_path8.default.posix.join(".oss", "tool-gates") + "/", import_node_path8.default.posix.join(".oss", "workflow-state.json")];
var MAX_EXCLUDE_BYTES = 1024 * 1024;
var CHECK_IGNORE_MS = 300;
var alreadyIgnored = /* @__PURE__ */ new Set();
function excludeOssState(projectRoot) {
  const repo = findRepo(projectRoot);
  if (repo.kind !== "repo") return;
  const info = import_node_path8.default.join(repo.commonDir, "info");
  if (!import_node_fs7.default.lstatSync(info).isDirectory() || import_node_fs7.default.realpathSync(info) !== import_node_path8.default.join(import_node_fs7.default.realpathSync(repo.commonDir), "info")) return;
  const file = import_node_path8.default.join(info, "exclude");
  const read = readRegularFile(file, MAX_EXCLUDE_BYTES, true);
  if (read === "not-regular") return;
  const text = read === "missing" ? "" : read.text;
  const listed = new Set(text.split("\n"));
  const missing2 = OSS_STATE.filter((line) => !listed.has(line));
  if (missing2.length === 0 || alreadyIgnored.has(repo.top)) return;
  const ignored = ignoredPaths(repo.top, missing2, timeLeft(CHECK_IGNORE_MS));
  if (ignored === null) return;
  const added = missing2.filter((line) => !ignored.includes(line));
  if (added.length === 0) {
    alreadyIgnored.add(repo.top);
    return;
  }
  appendPrivateFile(file, (text === "" || text.endsWith("\n") ? "" : "\n") + added.map((line) => `${line}
`).join(""));
}

// src/tool-gate/state-store.ts
var LOGGABLE_PROGRAM = /^[A-Za-z0-9._+-]{1,64}$/;
function programField(program) {
  const name = import_node_path9.default.basename(program ?? "");
  return LOGGABLE_PROGRAM.test(name) ? { program: name } : {};
}
var MAX_CYCLE_BYTES = 1024 * 1024;
function isCycleRecord(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return (v.startedAt === null || typeof v.startedAt === "string") && (v.lastResult === "red" || v.lastResult === "green") && Array.isArray(v.files) && v.files.every((f) => typeof f === "string") && (v.adoptedCommand === null || typeof v.adoptedCommand === "string");
}
function fileStateStore(repoRoot) {
  const ossDir = import_node_path9.default.join(repoRoot, ".oss");
  const stateDir = import_node_path9.default.join(ossDir, "tool-gates");
  const cycleFile = import_node_path9.default.join(stateDir, "cycle.json");
  const eventsFile = import_node_path9.default.join(stateDir, "events.ndjson");
  const { O_CREAT, O_EXCL, O_NOFOLLOW, O_WRONLY } = import_node_fs8.default.constants;
  function refuseSymlinkedDirs() {
    for (const dir of [ossDir, stateDir]) {
      if (import_node_fs8.default.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`tool-gate state: ${dir} is a symlink`);
      }
    }
  }
  function safeStateDir() {
    refuseSymlinkedDirs();
    import_node_fs8.default.mkdirSync(stateDir, { recursive: true });
    const real = import_node_fs8.default.realpathSync(stateDir);
    if (!real.startsWith(import_node_fs8.default.realpathSync(repoRoot) + import_node_path9.default.sep)) {
      throw new Error(`tool-gate state: ${stateDir} resolves outside the repo`);
    }
    try {
      excludeOssState(repoRoot);
    } catch {
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
      const fd = import_node_fs8.default.openSync(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW);
      try {
        import_node_fs8.default.writeFileSync(fd, JSON.stringify(cycle));
      } finally {
        import_node_fs8.default.closeSync(fd);
      }
      import_node_fs8.default.renameSync(temp, cycleFile);
    },
    appendEvent(event) {
      safeStateDir();
      appendPrivateFile(eventsFile, JSON.stringify(event) + "\n");
    }
  };
}

// src/tool-gate/workflow-state.ts
var import_node_path10 = __toESM(require("node:path"), 1);
var BUILD_COMMAND = "build";
var MAX_STATE_BYTES = 1024 * 1024;
function fileWorkflowState(projectDir) {
  return {
    read() {
      const read = readRegularFile(import_node_path10.default.join(projectDir, ".oss", "workflow-state.json"), MAX_STATE_BYTES, true);
      if (read === "missing") return null;
      if (read === "not-regular") throw new Error("workflow state is not a regular file under 1 MB");
      const data = JSON.parse(read.text);
      const record3 = typeof data === "object" && data !== null ? data : {};
      return {
        currentCommand: typeof record3.currentCommand === "string" ? record3.currentCommand : null,
        currentCommandStartedAt: typeof record3.currentCommandStartedAt === "string" ? record3.currentCommandStartedAt : null
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
    (word) => word.toLowerCase().split(/[^a-z0-9]+/).some((piece) => TEST_WORDS.has(piece)) || matchAnyPath(settings.testFilePatterns, import_node_path11.default.resolve(part.cwd, word), { home, root })
  );
}
var MAX_ADOPTED_LENGTH = 512;
function adoptedPattern(words) {
  let kept = words[0] ?? "";
  for (const word of words.slice(1)) {
    if (kept.length + 1 + word.length > MAX_ADOPTED_LENGTH) break;
    kept = `${kept} ${word}`;
  }
  return kept.slice(0, MAX_ADOPTED_LENGTH);
}
function runResult(call, testParts, last, failedWithExitCode) {
  const hidden = call.isInterrupt === true || testParts.some((part) => part.pipedOut || part.orTrue);
  if (hidden) return "unknown";
  if (call.hookEvent === "PostToolUse") return "green";
  return failedWithExitCode && last !== void 0 && testParts.includes(last) ? "red" : "unknown";
}
function recordTestRun(call, ctx) {
  const facts = readCommand(call.command, call.cwd, ctx.home, false, void 0, void 0, void 0, false);
  if ("unreadable" in facts) return;
  const previous = ctx.store.readCycle();
  const thisBuild = previous !== null && previous.startedAt === ctx.buildStartedAt ? previous : { files: [], adoptedCommand: null };
  const patterns = thisBuild.adoptedCommand === null ? ctx.settings.testCommandPatterns : [...ctx.settings.testCommandPatterns, thisBuild.adoptedCommand];
  let testParts = facts.parts.filter((part) => patterns.some((pattern) => matchCommand(pattern, part.words)));
  const last = facts.parts[facts.parts.length - 1];
  const failedWithExitCode = call.hookEvent === "PostToolUseFailure" && EXIT_CODE.test(call.error ?? "");
  let adoptedCommand = thisBuild.adoptedCommand;
  if (testParts.length === 0) {
    if (ctx.currentCommand !== BUILD_COMMAND || thisBuild.adoptedCommand !== null || !failedWithExitCode || call.isInterrupt === true || last === void 0 || NEVER_ADOPTED.has(import_node_path11.default.basename(last.program ?? "")) || facts.parts.some((part) => part.pipedOut || part.orTrue) || !isTestLike(last, ctx.settings, ctx.root ?? call.cwd, ctx.home)) {
      return;
    }
    adoptedCommand = adoptedPattern(last.words);
    testParts = [last];
    ctx.store.appendEvent({ ts: ctx.ts, tool: "Bash", kind: "runner-adopted", ...programField(last.program), result: "red" });
  }
  const result = runResult(call, testParts, last, failedWithExitCode);
  ctx.store.appendEvent({ ts: ctx.ts, tool: "Bash", kind: "test-run", ...programField(testParts[0]?.program), result });
  if (result === "unknown") return;
  ctx.store.writeCycle({
    startedAt: ctx.buildStartedAt,
    lastResult: result,
    files: result === "red" ? [] : thisBuild.files,
    adoptedCommand
  });
}

// src/tool-gate/tree-finder.ts
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_path12 = __toESM(require("node:path"), 1);
function* readEntries(dir) {
  const handle = import_node_fs9.default.opendirSync(dir);
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) yield entry;
  } finally {
    handle.closeSync();
  }
}
var NO_FOLDER = /* @__PURE__ */ new Set(["ENOENT", "ENOTDIR"]);
function createTreeFinder(limits = { maxDirs: Infinity }, readdir = readEntries, now = () => performance.now()) {
  let deadline;
  const maxEntries = limits.maxEntries ?? Infinity;
  const read = /* @__PURE__ */ new Map();
  let entriesRead = 0;
  const entriesOf = (dir) => {
    const known = read.get(dir);
    if (known !== void 0) return known;
    if (read.size >= limits.maxDirs) throw new OverBudget(`it makes the gate search more than ${limits.maxDirs} folders on disk`);
    deadline ??= limits.timeMs === void 0 ? Infinity : now() + limits.timeMs;
    if (now() > deadline) throw new OverBudget("searching the folders on disk took too long");
    const entries = [];
    try {
      for (const entry of readdir(dir)) {
        tick();
        if (++entriesRead > maxEntries) throw new OverBudget(`it makes the gate search more than ${maxEntries} names on disk`);
        entries.push(entry);
      }
    } catch (error) {
      if (error instanceof OverBudget) throw error;
      if (!NO_FOLDER.has(error.code ?? "")) throw new OverBudget(`the gate can't list ${dir}`);
    }
    read.set(dir, entries);
    return entries;
  };
  return {
    namedBelow(dir, wanted) {
      const found2 = [];
      const todo = [dir];
      for (let next = todo.pop(); next !== void 0; next = todo.pop()) {
        for (const entry of entriesOf(next)) {
          const full = import_node_path12.default.join(next, entry.name);
          if (wanted(entry.name)) found2.push(full);
          else if (entry.isDirectory()) todo.push(full);
        }
      }
      return found2;
    }
  };
}

// src/tool-gate/rule-file.ts
var import_node_path13 = __toESM(require("node:path"), 1);
var PLUGIN_ONLY_KEYS = ["backgroundAgents", "reviewPrograms", "reviewWriteOptions", "reviewNpxPackages"];
var LIST_KEYS = [
  "protectedBranches",
  "testFilePatterns",
  "testCommandPatterns",
  "sourceExtensions",
  "protectedPaths",
  "productionHosts",
  "gateAgents"
];
var KNOWN_KEYS = /* @__PURE__ */ new Set(["version", "tagsAllowed", ...PLUGIN_ONLY_KEYS, ...LIST_KEYS]);
var MAX_REPO_BYTES = 64 * 1024;
var MAX_REPO_ADDED = 64;
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
  const record3 = data;
  const keys = Object.keys(record3);
  if (keys.some((key2) => !KNOWN_KEYS.has(key2))) return { ok: false, reason: "has an unknown key" };
  if (record3.version !== 1) return { ok: false, reason: "version must be 1" };
  const value = { version: 1 };
  if ("tagsAllowed" in record3) {
    if (typeof record3.tagsAllowed !== "boolean") return { ok: false, reason: "tagsAllowed must be true or false" };
    value.tagsAllowed = record3.tagsAllowed;
  } else if (requireAll) {
    return { ok: false, reason: "tagsAllowed is missing" };
  }
  for (const key2 of PLUGIN_ONLY_KEYS) {
    if (!(key2 in record3)) continue;
    if (!requireAll) return { ok: false, reason: `${key2} is set by the plugin only` };
    const list = record3[key2];
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string" && item.length > 0)) {
      return { ok: false, reason: `${key2} must be a list of non-empty strings` };
    }
    value[key2] = list;
  }
  for (const key2 of LIST_KEYS) {
    if (!(key2 in record3)) {
      if (requireAll) return { ok: false, reason: `${key2} is missing` };
      continue;
    }
    const list = record3[key2];
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string" && item.length > 0)) {
      return { ok: false, reason: `${key2} must be a list of non-empty strings` };
    }
    value[key2] = list;
  }
  return { ok: true, value };
}
function merge(base, repo) {
  const merged = { ...base };
  for (const key2 of LIST_KEYS) {
    const added = repo[key2];
    if (added === void 0) continue;
    if (!base[key2].every((value) => added.includes(value))) return `${key2} drops a base value`;
    if (new Set(added.filter((value) => !base[key2].includes(value))).size > MAX_REPO_ADDED) {
      return `${key2} adds more than ${MAX_REPO_ADDED} values`;
    }
    if ((key2 === "testFilePatterns" || key2 === "testCommandPatterns") && !added.every((value) => base[key2].includes(value))) {
      return `${key2} is set by the plugin only`;
    }
    merged[key2] = [.../* @__PURE__ */ new Set([...base[key2], ...added])];
  }
  if (repo.tagsAllowed === true && !base.tagsAllowed) return "tagsAllowed true loosens the base false";
  if (repo.tagsAllowed === false) merged.tagsAllowed = false;
  return merged;
}
function loadSettings(readFile, pluginRoot, repoRoot) {
  if (!import_node_path13.default.isAbsolute(pluginRoot)) throw new Error("tool-gate plugin root is not an absolute path");
  const baseText = readFile(import_node_path13.default.join(pluginRoot, "config", "tool-gates.json"));
  if (baseText === null) throw new Error("tool-gate base settings file is missing");
  const baseParsed = parse(baseText, true);
  if (!baseParsed.ok) throw new Error(`tool-gate base settings file is invalid: ${baseParsed.reason}`);
  const base = baseParsed.value;
  const reject = (reason) => ({
    settings: base,
    rejected: `.oss/tool-gates.json ignored: ${reason}`
  });
  let repoText;
  try {
    repoText = readFile(import_node_path13.default.join(repoRoot, ".oss", "tool-gates.json"));
  } catch {
    return reject("not a regular file under 1 MB");
  }
  if (repoText === null) return { settings: base };
  if (Buffer.byteLength(repoText, "utf8") > MAX_REPO_BYTES) return reject("larger than 64 KB");
  const repoParsed = parse(repoText, false);
  if (!repoParsed.ok) return reject(repoParsed.reason);
  const merged = merge(base, repoParsed.value);
  if (typeof merged === "string") return reject(merged);
  return { settings: merged };
}
var MAX_USER_PROGRAMS = 256;
var MAX_USER_PROGRAM_CHARS = 200;
function withUserReviewPrograms(settings, userConfigText2) {
  if (userConfigText2 === null) return settings;
  let added;
  try {
    const config = JSON.parse(userConfigText2);
    const gates = typeof config === "object" && config !== null ? config.toolGates : void 0;
    added = typeof gates === "object" && gates !== null ? gates.reviewPrograms : void 0;
  } catch {
    return settings;
  }
  const isName = (v) => typeof v === "string" && v.trim() !== "" && v.length <= MAX_USER_PROGRAM_CHARS && !/[\u0000-\u001f]/.test(v);
  if (!Array.isArray(added) || added.length > MAX_USER_PROGRAMS || !added.every(isName)) return settings;
  return { ...settings, reviewPrograms: [.../* @__PURE__ */ new Set([...settings.reviewPrograms ?? [], ...added.map((v) => v.trim())])] };
}

// src/tool-gate/calling-agent.ts
function callingAgentOf(record3) {
  const name = record3.agent_type;
  return typeof name === "string" && name !== "" ? name : void 0;
}

// src/utils/gate-agents.ts
var path14 = __toESM(require("path"), 1);

// src/utils/regular-file.ts
var fs10 = __toESM(require("fs"), 1);
var FLAGS2 = fs10.constants.O_RDONLY | fs10.constants.O_NONBLOCK;
function notRegular(file) {
  return Object.assign(new Error(`ENOENT: not a regular file, open '${file}'`), { code: "ENOENT" });
}
function refused(st, owner) {
  return !st.isFile() || owner !== void 0 && st.uid !== owner;
}
function readRegularFileSync(file, owner) {
  if (!fs10.statSync(file).isFile()) {
    throw notRegular(file);
  }
  const fd = fs10.openSync(file, FLAGS2);
  try {
    if (refused(fs10.fstatSync(fd), owner)) {
      throw notRegular(file);
    }
    return fs10.readFileSync(fd, "utf-8");
  } finally {
    fs10.closeSync(fd);
  }
}
function missing(err) {
  return err?.code === "ENOENT";
}
function readRegularFileSyncOrNull(file) {
  let st;
  try {
    st = fs10.statSync(file);
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
  const base = namesIn(path14.join(pluginRoot, "config", "tool-gates.json"));
  if (base === null) throw new Error("plugin gateAgents is missing or invalid");
  return [.../* @__PURE__ */ new Set([...base, ...namesIn(path14.join(repoRoot, ".oss", "tool-gates.json")) ?? []])];
}

// src/tool-gate/rules/gate-agent-write.ts
var import_node_fs11 = __toESM(require("node:fs"), 1);
var import_node_path17 = __toESM(require("node:path"), 1);

// src/tool-gate/rules/protected-path.ts
var import_node_path15 = __toESM(require("node:path"), 1);

// src/tool-gate/review-places.ts
var import_node_fs10 = __toESM(require("node:fs"), 1);
var import_node_path14 = __toESM(require("node:path"), 1);
var FIRMLINK_ROOT = "/System/Volumes/Data";
var TOOLCHAIN_PLACES = [
  { rel: ".gitconfig", kind: "file" },
  ...[
    ".config/git",
    ".nvm",
    ".npm",
    ".cargo",
    ".rustup",
    "go",
    ".pyenv",
    ".local/bin",
    ".local/lib",
    ".local/share/uv",
    ".deno",
    ".bun",
    ".volta",
    ".asdf",
    ".rbenv",
    ".sdkman",
    "Library/Caches/pip",
    "Library/pnpm",
    "miniconda3",
    // round 10, CR MEDIUM-3
    "Library/Python",
    ".gem",
    "Library/Caches/pypoetry/virtualenvs",
    ".local/pipx",
    ".local/share/mise",
    ".rvm",
    ".local/share/fnm",
    "Library/Application Support/fnm",
    ".yarn/berry",
    // round 11, CR LOW-B (their credential files stay denied: credential-places.ts)
    ".pub-cache",
    ".virtualenvs",
    ".cabal",
    ".ghcup",
    ".opam",
    ".composer"
  ].map((rel) => ({ rel, kind: "folder" }))
];
var USER_LEVEL = [".oss", ".claude"];
function realOrNull(p) {
  try {
    return import_node_fs10.default.realpathSync(p);
  } catch {
    return null;
  }
}
function within(dir, p, caseInsensitive) {
  const d = caseInsensitive ? dir.toLowerCase() : dir;
  const q = caseInsensitive ? p.toLowerCase() : p;
  return q === d || d === "/" || q.startsWith(`${d}/`);
}
function withoutFirmlink(p, caseInsensitive) {
  let at = p;
  while (within(FIRMLINK_ROOT, at, caseInsensitive)) at = at.slice(FIRMLINK_ROOT.length) || "/";
  return at;
}
function linkInto(p, privateDir, caseInsensitive) {
  let at = "/";
  for (const segment of import_node_path14.default.normalize(p).split("/").filter((s) => s !== "")) {
    const next = import_node_path14.default.join(at, segment);
    const stat = import_node_fs10.default.lstatSync(next, { throwIfNoEntry: false });
    if (stat === void 0) return false;
    if (!stat.isSymbolicLink()) {
      at = next;
      continue;
    }
    const target = realOrNull(next);
    if (within(privateDir, next, caseInsensitive) || target === null || within(privateDir, target, caseInsensitive)) return true;
    at = target;
  }
  return false;
}
var MAX_PRIVATE_ENTRIES = 5e3;
function linkUnder(dir, max = MAX_PRIVATE_ENTRIES) {
  const todo = [dir];
  let seen = 0;
  for (let at = todo.pop(); at !== void 0; at = todo.pop()) {
    let entries;
    try {
      entries = import_node_fs10.default.readdirSync(at, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > max) return "too-many";
      if (entry.isSymbolicLink()) return "link";
      if (entry.isDirectory()) todo.push(import_node_path14.default.join(at, entry.name));
    }
  }
  return "none";
}
function reviewFoldersRoot(privateDir) {
  for (let at = privateDir; import_node_path14.default.dirname(at) !== at; at = import_node_path14.default.dirname(at)) if (import_node_path14.default.basename(at) === "oss-review") return at;
  return null;
}
function withReal(paths) {
  return [...new Set(paths.flatMap((p) => [p, realOrNull(p) ?? p]))];
}
function readableUnderHome(places) {
  const toolchain = places.homes.flatMap((home) => TOOLCHAIN_PLACES.map((place) => ({ at: import_node_path14.default.join(home, place.rel), kind: place.kind })));
  const own = places.privateDir === void 0 || places.privateDir === null ? [] : [{ at: places.privateDir, kind: "folder" }];
  return [...places.repos.map((at) => ({ at, kind: "folder" })), ...own, ...toolchain];
}
function transcriptRoots(tmpdirs) {
  const given = ["/tmp", "/private/tmp", ...tmpdirs.filter((t) => t !== void 0 && import_node_path14.default.isAbsolute(t)).map((t) => import_node_path14.default.normalize(t).replace(/(.)\/+$/, "$1"))];
  return withReal(given).filter((p) => p !== "/");
}
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function transcriptPattern(root) {
  return `^${escapeRegex(root)}/claude-[^/]+/[^/]+/[^/]+/tasks(/|$)`;
}
function inTranscripts(p, roots, caseInsensitive) {
  return roots.some((root) => new RegExp(transcriptPattern(root), caseInsensitive ? "i" : "").test(p));
}
function reachesTranscripts(dir, roots, caseInsensitive) {
  return roots.some((root) => within(dir, root, caseInsensitive) || new RegExp(`^${escapeRegex(root)}/claude-[^/]+(/|$)`, caseInsensitive ? "i" : "").test(dir));
}
function readRootsProblem(roots, homes, caseInsensitive) {
  const guarded = withReal([...homes, ...homes.flatMap((home) => USER_LEVEL.map((rel) => import_node_path14.default.join(home, rel)))]);
  for (const root of withReal(roots)) {
    const hit = guarded.find((p) => within(root, p, caseInsensitive));
    if (hit !== void 0) return `the reviewed repo \`${root}\` is or holds the home folder or ~/.oss or ~/.claude`;
  }
  return null;
}

// src/tool-gate/rules/protected-path.ts
var HOME_PREFIX = "~/";
var MAX_PATH_CHARS = 4096;
var MAX_PATH_SEGMENTS = 512;
function isTooLong(p) {
  return p.length > MAX_PATH_CHARS || p.split("/").length > MAX_PATH_SEGMENTS;
}
var TOO_LONG = {
  rule: "protected-path",
  reason: "Refused: writes a path too long for the gate to check (over 4096 characters or 512 folders). To keep long text, write it to a short path with a heredoc (cat > /tmp/notes.md <<EOF \u2026 EOF)."
};
var WILDCARD = /[*?]/;
function placesOf(root, home, paths, caseInsensitive) {
  const given = { home: unfirm(home), root: unfirm(root), caseInsensitive };
  const resolved2 = { home: unfirm(paths.realpath(home)), root: unfirm(paths.realpath(root)), caseInsensitive };
  return given.home === resolved2.home && given.root === resolved2.root ? [given] : [given, resolved2];
}
function unfirm(p) {
  return withoutFirmlink(p, true);
}
function formsOf(absPath, paths) {
  return [...new Set([import_node_path15.default.normalize(absPath), paths.realpath(absPath)].map(unfirm))];
}
var protectedAnswers = /* @__PURE__ */ new WeakMap();
var holdingAnswers = /* @__PURE__ */ new WeakMap();
function answered(store, at, globs, form, decide2) {
  let lists = store.get(at);
  if (lists === void 0) {
    lists = /* @__PURE__ */ new WeakMap();
    store.set(at, lists);
  }
  let answers = lists.get(globs);
  if (answers === void 0) {
    answers = /* @__PURE__ */ new Map();
    lists.set(globs, answers);
  }
  let answer2 = answers.get(form);
  if (answer2 === void 0) {
    answer2 = decide2();
    answers.set(form, answer2);
  }
  return answer2;
}
function isProtected(absPath, settings, places, paths) {
  const globs = settings.protectedPaths;
  return formsOf(absPath, paths).some((p) => places.some((at) => answered(protectedAnswers, at, globs, p, () => matchAnyPath(globs, p, at))));
}
function fixedFolder(glob, at) {
  let full;
  if (glob.startsWith(HOME_PREFIX)) full = import_node_path15.default.join(at.home, glob.slice(HOME_PREFIX.length));
  else if (import_node_path15.default.isAbsolute(glob)) full = import_node_path15.default.normalize(glob);
  else full = import_node_path15.default.join(at.root, glob);
  const segments = full.split(import_node_path15.default.sep);
  const first = segments.findIndex((segment) => WILDCARD.test(segment));
  return first === -1 ? full : segments.slice(0, first).join(import_node_path15.default.sep) || import_node_path15.default.sep;
}
function comparable(p, caseInsensitive) {
  return import_node_path15.default.resolve(caseInsensitive ? p.toLowerCase() : p);
}
function atOrBelow(dir, of) {
  return of === dir || of.startsWith(dir.endsWith(import_node_path15.default.sep) ? dir : `${dir}${import_node_path15.default.sep}`);
}
function isSameOrAncestor(dir, of, caseInsensitive) {
  return atOrBelow(comparable(dir, caseInsensitive), comparable(of, caseInsensitive));
}
var fixedFolders = /* @__PURE__ */ new WeakMap();
function fixedFoldersOf(globs, at) {
  let lists = fixedFolders.get(at);
  if (lists === void 0) {
    lists = /* @__PURE__ */ new WeakMap();
    fixedFolders.set(at, lists);
  }
  let folders = lists.get(globs);
  if (folders === void 0) {
    folders = globs.map((glob) => comparable(fixedFolder(glob, at), at.caseInsensitive === true));
    lists.set(globs, folders);
  }
  return folders;
}
function holdsProtected(absPath, settings, places, paths) {
  const globs = settings.protectedPaths;
  const heads = folderHeadsOf(globs);
  return formsOf(absPath, paths).some(
    (p) => places.some(
      (at) => answered(holdingAnswers, at, globs, p, () => {
        const dir = comparable(p, at.caseInsensitive === true);
        return fixedFoldersOf(globs, at).some((folder) => atOrBelow(dir, folder)) || matchAnyPath(heads, p, at);
      })
    )
  );
}
var folderHeads = /* @__PURE__ */ new WeakMap();
function folderHeadsOf(globs) {
  let heads = folderHeads.get(globs);
  if (heads === void 0) {
    heads = [];
    for (const glob of globs) {
      const segments = glob.split("/");
      for (let k = 1; k < segments.length; k++) {
        const head = segments.slice(0, k);
        if (head.some((segment) => !/^\**$/.test(segment))) heads.push(head.join("/"));
      }
    }
    heads = [...new Set(heads)];
    folderHeads.set(globs, heads);
  }
  return heads;
}
var PATTERN_SEGMENT = /(?:^|[^\\])[*?[]/;
function splitPattern(pattern) {
  const segments = pattern.split("/");
  const first = segments.findIndex((segment) => PATTERN_SEGMENT.test(segment));
  if (first === -1) return null;
  return { prefix: segments.slice(0, first).join("/") || "/", rest: segments.slice(first).join("/") };
}
function patternReachesProtected(pattern, settings, places, paths, exemptAnchor = false, dots = false) {
  return prefixForms(pattern, paths).some((form) => places.some((at) => shellGlobMayMatch(form, settings.protectedPaths, at, exemptAnchor, dots)));
}
function prefixForms(pattern, paths) {
  const forms2 = [unfirm(pattern)];
  const split2 = splitPattern(pattern);
  if (split2 !== null && !split2.prefix.includes("\\")) forms2.push(`${escapeGlob(unfirm(paths.realpath(split2.prefix)))}/${split2.rest}`);
  return [...new Set(forms2)];
}
var INTO_FOLDER = /* @__PURE__ */ new Set(["cp", "mv", "ln", "install", "ditto", "rsync"]);
var DESTINATION_FOLDER_WRITERS = /* @__PURE__ */ new Set([...INTO_FOLDER, "tar", "bsdtar", "unzip", "mktemp"]);
function mayBeProtectedFolder(pattern, settings, places, paths) {
  return patternReachesProtected(`${pattern}/*`, settings, places, paths, true, false);
}
function displayPath(absPath, root, home) {
  if (absPath === root) return ".";
  if (absPath.startsWith(`${root}/`)) return absPath.slice(root.length + 1);
  if (absPath.startsWith(`${home}/`)) return HOME_PREFIX + absPath.slice(home.length + 1);
  return absPath;
}
function refusal(absPath, what, root, home) {
  return {
    rule: "protected-path",
    reason: `Refused: writes \`${displayPath(absPath, root, home)}\`, ${what}. Ask the user to change it with \`!\`.`
  };
}
function checkProtectedPathEdit(call, settings, root, home, paths, caseInsensitive = false) {
  if (isTooLong(call.filePath)) return TOO_LONG;
  const places = placesOf(root, home, paths, caseInsensitive);
  if (isProtected(call.filePath, settings, places, paths)) return refusal(call.filePath, "a protected file", root, home);
  if (holdsProtected(call.filePath, settings, places, paths)) {
    return refusal(call.filePath, "which holds protected files", root, home);
  }
  return null;
}
function checkProtectedPathBash(part, settings, root, home, paths, caseInsensitive = false, places = placesOf(root, home, paths, caseInsensitive), tree = createTreeFinder()) {
  const underSetHome = [...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs].find((t) => t.includes(HOME_UNKNOWN));
  if (underSetHome !== void 0) return homeSetRefusal(part);
  const into = INTO_FOLDER.has(plainWriterName(import_node_path15.default.basename(part.program ?? "")));
  for (const target of part.writeTargets) {
    if (isTooLong(target)) return TOO_LONG;
    if (isProtected(target, settings, places, paths)) return refusal(target, "a protected file", root, home);
    if (holdsProtected(target, settings, places, paths) || into && mayBeProtectedFolder(escapeGlob(target), settings, places, paths)) {
      return refusal(target, "which holds protected files", root, home);
    }
  }
  for (const pattern of part.writeGlobs) {
    if (isTooLong(pattern)) return TOO_LONG;
    if (patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob) || into && mayBeProtectedFolder(pattern, settings, places, paths)) {
      return refusal(pattern, "a wildcard the shell could expand to a protected path", root, home);
    }
  }
  const unknown = unknownWrite(part, settings, places, paths);
  if (unknown !== null) return unknown;
  const lost = part.lostDir === null ? null : lostPatternWrite(part, settings, places, paths, root, home) ?? lostTail(part, settings, places);
  return lost ?? nestedProtected(part, settings, paths, tree, caseInsensitive, root, home);
}
function lostPatternWrite(part, settings, places, paths, root, home) {
  const at = part.lostDir?.pattern ?? null;
  if (at === null) return null;
  const folder = `${part.cwd}/`;
  let matchers = null;
  for (const target of part.writeTargets) {
    if (!target.startsWith(folder)) continue;
    const tail = escapeGlob(target.slice(folder.length));
    const pattern = `${at}/${tail}`;
    let reaches;
    if (tail.split("/").some((segment) => PATTERN_SEGMENT.test(segment))) {
      reaches = patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob);
    } else {
      matchers ??= prefixForms(at, paths).flatMap((form) => places.map((place) => shellGlobTailMatcher(form, settings.protectedPaths, place, false, part.dotGlob)));
      reaches = matchers.some((reach) => reach(tail));
    }
    if (reaches) {
      return refusal(pattern, `after \`${part.lostDir?.why}\`, a path that could be protected`, root, home);
    }
  }
  return null;
}
function unknownWrite(part, settings, places, paths) {
  const substituted = part.substitutedWrites ?? [];
  const into = DESTINATION_FOLDER_WRITERS.has(plainWriterName(part.name ?? ""));
  const attached = into ? part.writeTargets.filter((t) => t.includes(UNKNOWN)) : [];
  for (const target of /* @__PURE__ */ new Set([...substituted, ...part.unknownWrites ?? [], ...attached])) {
    if (part.recursiveTargets.includes(target)) continue;
    const pattern = part.writePatterns?.get(target) ?? escapeGlob(target);
    if (part.recursiveGlobs.includes(pattern)) continue;
    const tail = unknownTailOf(pattern);
    if ((part.cleanupWrites ?? []).includes(target) && cleanupMayHold(pattern, tail, part.cwd, settings, places, paths)) {
      return {
        rule: "protected-path",
        reason: `Refused: a script run later (a \`trap\`, \`emulate -c\` or \`sched\`) removes a folder with a part only known when it runs (a variable), which could hold protected files. Name the folder in full, or keep the unknown part at the start (\`rm -rf "$dir"\`).`
      };
    }
    if (into && tail !== null && places.some((at) => tailMayHoldProtected(tail.replace(/\/+$/, ""), settings.protectedPaths, at, true))) {
      return {
        rule: "protected-path",
        reason: `Refused: \`${import_node_path15.default.basename(part.program ?? "")}\` writes into, or moves, a folder with a part only known when it runs (a variable or \`$(\u2026)\`), which could hold protected files. Write the folder out in full.`
      };
    }
    if (tail === null) {
      const after = pattern.slice(pattern.lastIndexOf(UNKNOWN) + UNKNOWN.length);
      const wildcardsOnly = after.startsWith("/") && endsInGitRef(after.replace(/^\/+/, ""), settings);
      if (!wildcardsOnly && !substituted.includes(target) && !literalHeadReaches(pattern, part.cwd, settings, places, paths)) continue;
    } else if (!endsInGitRef(tail, settings) && !places.some((at) => tailMayBeProtected(tail, settings.protectedPaths, at, true, false))) {
      continue;
    }
    return {
      rule: "protected-path",
      reason: `Refused: \`${import_node_path15.default.basename(part.program ?? "")}\` writes a path with a part only known when it runs (a variable or \`$(\u2026)\`), which could be a protected file. Write the path out in full, or set the variable to a plain value earlier in the same command.`
    };
  }
  return null;
}
var GIT_POINTER_FILES = ["head", "orig_head", "fetch_head", "packed-refs", "commondir", "gitdir", "grafts", "alternates", "shallow"];
function endsInGitRef(tail, settings) {
  const trimmed = tail.replace(/\/+$/, "");
  const pattern = trimmed.slice(trimmed.lastIndexOf("/") + 1).replace(/\.lock$/i, "");
  const branches = settings.protectedBranches.map((b) => b.slice(b.lastIndexOf("/") + 1).toLowerCase());
  const names = [...GIT_POINTER_FILES, ...branches];
  if (hasShellWildcard(pattern)) return names.some((name) => shellPatternMatchesPath(pattern, name, { caseInsensitive: true }, true));
  return names.includes(unescapeGlob(pattern).toLowerCase());
}
function unknownTailOf(pattern) {
  const after = pattern.slice(pattern.lastIndexOf(UNKNOWN) + UNKNOWN.length);
  const rest = after.replace(/^\/+/, "");
  if (/^[*?/]*$/.test(rest)) return null;
  return after.startsWith("/") ? rest : `*${rest}`;
}
function literalHeadReaches(pattern, cwd, settings, places, paths) {
  const first = pattern.indexOf(UNKNOWN);
  const folder = `${escapeGlob(cwd)}/`;
  const head = pattern.slice(0, first);
  if (head === folder || head === "/") return false;
  return patternReachesProtected(`${head}*`, settings, places, paths, true, false);
}
function everythingBelow(rel) {
  return rel === "" ? "**" : `${rel}/**`;
}
function below(p, folder) {
  if (p === folder) return "";
  return p.startsWith(`${folder}/`) ? p.slice(folder.length + 1) : null;
}
function foldersDownTo(start, found2) {
  const rel = found2.slice(start.length + 1).split("/");
  return rel.map((_, n) => `${start}/${rel.slice(0, n + 1).join("/")}`);
}
function unescapeGlob(pattern) {
  return pattern.replace(/\\(.)/g, "$1");
}
function homeSetRefusal(part) {
  return {
    rule: "protected-path",
    reason: `Refused: \`${import_node_path15.default.basename(part.program ?? "")}\` writes through \`~\` or \`$HOME\` in a call that also sets HOME, so the gate can't tell which folder it writes, a protected one included. Leave HOME alone and write the path out in full.`
  };
}
function unreadableFolder(part) {
  return {
    rule: "protected-path",
    reason: `Refused: \`${import_node_path15.default.basename(part.program ?? "")}\` changes everything in a folder the gate can't read (a variable or command output). A recursive write must name its folder literally, so the gate can check it holds no .git or other protected file. Write the path out, for example \`/tmp/tmp.abc123\` instead of \`"$d"\`.`
  };
}
function nestedRefusal(target, found2, root, home) {
  return {
    rule: "protected-path",
    reason: `Refused: removes or changes \`${displayPath(target, root, home)}\` with everything in it, including \`${displayPath(found2, root, home)}\`, a protected path. Ask the user to run it with \`!\`.`
  };
}
function nestedProtected(part, settings, paths, tree, caseInsensitive, root, home) {
  const wanted = floatingNames(settings.protectedPaths, caseInsensitive);
  if (wanted === null) return null;
  const lostIn = (p) => part.lostDir !== null && !plainUnderOption(part, p) && below(p, part.cwd) !== null;
  const realRoot = paths.realpath(root);
  const realHome = paths.realpath(home);
  for (const target of part.recursiveTargets) {
    if (lostIn(target)) continue;
    if (isTooLong(target)) return TOO_LONG;
    if (target.includes(UNKNOWN)) return unreadableFolder(part);
    const [found2] = tree.namedBelow(paths.realpath(target), wanted);
    if (found2 !== void 0) return nestedRefusal(target, found2, realRoot, realHome);
  }
  for (const pattern of part.recursiveGlobs) {
    const split2 = splitPattern(pattern);
    if (split2 === null || lostIn(unescapeGlob(split2.prefix))) continue;
    if (isTooLong(pattern)) return TOO_LONG;
    if (pattern.includes(UNKNOWN)) return unreadableFolder(part);
    const start = paths.realpath(unescapeGlob(split2.prefix));
    const real = `${escapeGlob(start)}/${split2.rest}`;
    for (const found2 of tree.namedBelow(start, wanted)) {
      const reached = foldersDownTo(start, found2).find((p) => shellPatternMatchesPath(real, p, { caseInsensitive }, part.dotGlob));
      if (reached !== void 0) return nestedRefusal(reached, found2, realRoot, realHome);
    }
  }
  return null;
}
var LOST_CD_HINT = "use the full path, or cd to a plain folder in the same command (`cd src && \u2026`)";
function cleanupMayHold(pattern, tail, cwd, settings, places, paths) {
  const head = pattern.slice(0, pattern.indexOf(UNKNOWN));
  if (head !== `${escapeGlob(cwd)}/` && head !== "/" && prefixForms(`${head}*`, paths).some((form) => places.some((at) => shellGlobMayHold(form, settings.protectedPaths, at, true)))) return true;
  return tail !== null && places.some((at) => tailMayHoldProtected(tail, settings.protectedPaths, at, true));
}
function plainUnderOption(part, target) {
  return part.lostDir?.plainKnown === true && !target.includes(UNKNOWN) && part.writePatterns?.has(target) !== true;
}
function lostTail(part, settings, places) {
  const folder = `${part.cwd}/`;
  const patternFolder = escapeGlob(part.cwd);
  const unknownFolder = part.lostDir?.pattern === null;
  const relative = (paths, to) => paths.flatMap((p) => {
    const rel = below(p, to);
    return rel === null ? [] : [rel];
  });
  const tails = [
    // a folder known by no pattern could itself be any protected folder, so what its `/**` covers counts too (round 10)
    ...part.writeTargets.filter((t) => t.startsWith(folder) && !plainUnderOption(part, t)).map((t) => [escapeGlob(t.slice(folder.length)), unknownFolder, true]),
    // a wildcard, or a whole folder, could cover what any protected folder holds; rm -r and find reach dot entries
    ...relative(part.writeGlobs, patternFolder).map((g) => [g, true, part.dotGlob]),
    ...relative(part.recursiveTargets.filter((t) => !plainUnderOption(part, t)), part.cwd).map((t) => [everythingBelow(escapeGlob(t)), true, true]),
    ...relative(part.recursiveGlobs, patternFolder).map((g) => [everythingBelow(g), true, true])
  ];
  const tail = tails.find(([t, contents, dots]) => places.some((at) => tailMayBeProtected(t, settings.protectedPaths, at, dots, contents)))?.[0];
  if (tail === void 0) return null;
  return {
    rule: "protected-path",
    reason: `Refused: writes \`${tail}\` after \`${part.lostDir?.why}\`, in a folder the gate can't follow, where it could be a protected file. Instead, ${LOST_CD_HINT}, or ask the user to run it with \`!\`.`
  };
}

// src/tool-gate/rules/review-commands.ts
var import_node_path16 = __toESM(require("node:path"), 1);
function optionName(word) {
  const eq = word.indexOf("=");
  return eq === -1 ? word : word.slice(0, eq);
}
function optionValues(words, names) {
  const values = [];
  words.forEach((word, i) => {
    const name = optionName(word);
    if (!names.includes(name)) return;
    const value = name === word ? words[i + 1] : word.slice(name.length + 1);
    if (value !== void 0) values.push(value);
  });
  return values;
}
function positionals(words, valueOptions) {
  const found2 = [];
  for (let i = 0; i < words.length; i++) {
    if (valueOptions.has(words[i])) i++;
    else if (!words[i].startsWith("-")) found2.push(words[i]);
  }
  return found2;
}
var LAUNCHERS2 = /* @__PURE__ */ new Set([
  "nohup",
  "setsid",
  "disown",
  "screen",
  "tmux",
  "daemonize",
  "coproc",
  "pm2",
  "forever"
]);
var LASTING = /* @__PURE__ */ new Set([
  "at",
  "batch",
  "launchctl",
  "crontab",
  "systemd-run",
  "claude",
  "start-stop-daemon",
  "open",
  "osascript",
  "xdg-open",
  "launchd"
]);
var SSH_VALUE_LETTERS = /* @__PURE__ */ new Set([..."BbcDEeFIiJLlmOoPpQRSWw"]);
var CONTAINER_PROGRAMS = /* @__PURE__ */ new Set(["docker", "podman"]);
var BREW_STARTS = /* @__PURE__ */ new Set(["start", "run", "restart"]);
var CONTAINER_GLOBAL_VALUES = /* @__PURE__ */ new Set(["-H", "--host", "-c", "--context", "--config", "-l", "--log-level", "--url", "--connection"]);
var DETACH = /^-[A-Za-z]*d[A-Za-z]*$/;
function sshInBackground(args) {
  for (let i = 0; i < args.length && args[i].startsWith("-"); i++) {
    const word = args[i];
    if (word.startsWith("--")) continue;
    for (let k = 1; k < word.length; k++) {
      if (word[k] === "f") return true;
      if (SSH_VALUE_LETTERS.has(word[k])) {
        if (k === word.length - 1) i++;
        break;
      }
    }
  }
  return false;
}
function containerDetached(args) {
  const [first, second, third] = positionals(args, CONTAINER_GLOBAL_VALUES);
  const sub = first === "container" ? second : first;
  const detached = args.some((w) => w === "--detach" || w.startsWith("--detach=") || DETACH.test(w));
  if (sub === "start") return true;
  if (sub === "run") return detached;
  return first === "compose" && (second === "up" || third === "up") && detached;
}
function sudoInBackground(options) {
  return options.some((w) => w === "--background" || !w.startsWith("--") && /^-[A-Za-z]*b/.test(w));
}
function launchOf(part) {
  const names = [part.name, ...part.wrappers];
  if (names.some((name) => name !== null && LASTING.has(name))) return "lasting";
  if (part.name === "brew" && brewServiceStart(part.words.slice(1))) return "lasting";
  if (part.backgrounded || names.some((name) => name !== null && LAUNCHERS2.has(name))) return "background";
  if (part.wrappers.some((name, i) => name === "sudo" && sudoInBackground(part.wrapperOptions[i] ?? []))) return "background";
  return backgroundProgram(part) ? "background" : null;
}
function brewServiceStart(args) {
  const [first, second] = args.filter((w) => !w.startsWith("-"));
  return first === "services" && second !== void 0 && BREW_STARTS.has(second);
}
function backgroundProgram(part) {
  const args = part.words.slice(1);
  if (part.name === "ssh") return sshInBackground(args);
  if (part.name !== null && CONTAINER_PROGRAMS.has(part.name)) return containerDetached(args);
  if (part.name === "docker-compose" || part.name === "podman-compose") return args.includes("up") && args.some((w) => w === "--detach" || DETACH.test(w));
  if (part.name === "emacs") return args.some((w) => ["--daemon", "--bg-daemon"].includes(optionName(w)));
  return false;
}
var INTERPRETERS = /* @__PURE__ */ new Set([
  "node",
  "nodejs",
  "deno",
  "bun",
  "tsx",
  "ts-node",
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "source",
  ".",
  "ruby",
  "perl",
  "php"
]);
var PYTHON2 = /^python[0-9.]*$/;
var INTERPRETER_VALUES = /* @__PURE__ */ new Set([
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-e",
  "--eval",
  "-p",
  "--print",
  "-c",
  "-m",
  "-o",
  "-O",
  "-W",
  "-X",
  "--rcfile",
  "--init-file"
]);
function isInterpreter(name) {
  return name !== null && (INTERPRETERS.has(name) || PYTHON2.test(name));
}
function scriptArgument(part) {
  if (!isInterpreter(part.name)) return null;
  return positionals(part.words.slice(1), INTERPRETER_VALUES)[0] ?? null;
}
var READ_ONLY_GIT = /* @__PURE__ */ new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "ls-remote",
  "rev-parse",
  "rev-list",
  "cat-file",
  "describe",
  "shortlog",
  "merge-base",
  "name-rev",
  "for-each-ref",
  "show-ref",
  "diff-tree",
  "diff-index",
  "diff-files",
  "whatchanged",
  "check-ignore",
  "check-attr",
  "var",
  "version",
  "help",
  "count-objects",
  "range-diff",
  "cherry",
  "verify-commit",
  "verify-tag"
]);
var LIST_FIRST_WORDS = /* @__PURE__ */ new Map([
  ["stash", /* @__PURE__ */ new Set(["list", "show"])],
  ["worktree", /* @__PURE__ */ new Set(["list"])],
  ["notes", /* @__PURE__ */ new Set(["list", "show"])],
  ["submodule", /* @__PURE__ */ new Set(["status", "summary"])]
]);
var BRANCH_FLAGS = /* @__PURE__ */ new Set([
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-v",
  "-vv",
  "--verbose",
  "--list",
  "-l",
  "--show-current",
  "--column",
  "--no-column",
  "--color",
  "--no-color"
]);
var BRANCH_VALUES = /* @__PURE__ */ new Set(["--contains", "--merged", "--no-merged", "--format", "--sort", "--points-at"]);
var TAG_FLAGS = /* @__PURE__ */ new Set(["-l", "--list"]);
var TAG_VALUES = /* @__PURE__ */ new Set(["--contains", "--points-at", "--sort", "--format"]);
var CONFIG_READS = /* @__PURE__ */ new Set(["--get", "--get-all", "--get-regexp", "--list", "-l"]);
var CONFIG_MODIFIERS = /* @__PURE__ */ new Set(["--show-origin", "--show-scope", "--name-only"]);
var CONFIG_FILE_OPTIONS = ["global", "system", "file"];
function listOnly(args, flags, values, listFlags) {
  let positional = false;
  let listing = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    const name = optionName(word);
    if (listFlags.includes(word)) listing = true;
    if (!word.startsWith("-")) positional = true;
    else if (values.has(name)) {
      if (name === word && args[i + 1] !== void 0 && !args[i + 1].startsWith("-")) i++;
    } else if (!flags.has(name)) return false;
  }
  return !positional || listing;
}
function readOnlyTag(args) {
  return listOnly(args.filter((w) => !/^-n[0-9]*$/.test(w)), TAG_FLAGS, TAG_VALUES, ["-l", "--list"]);
}
function readOnlyRemote(args) {
  const rest = args[0] === "-v" || args[0] === "--verbose" ? args.slice(1) : args;
  return rest.length === 0 || rest[0] === "show" || rest[0] === "get-url";
}
function readOnlyConfig(args) {
  const options = args.filter((w) => w.startsWith("-"));
  return options.some((w) => CONFIG_READS.has(w)) && options.every((w) => CONFIG_READS.has(w) || CONFIG_MODIFIERS.has(w));
}
function writesUserGitConfig(subcommand, args) {
  return subcommand === "config" && args.some(namesConfigFile) && !args.some((w) => CONFIG_READS.has(w));
}
function namesConfigFile(word) {
  if (word === "-f") return true;
  const name = optionName(word);
  return name.startsWith("--") && name.length > 2 && CONFIG_FILE_OPTIONS.some((o) => o.startsWith(name.slice(2)));
}
function writingArgument(subcommand, args) {
  return args.some((w) => {
    const name = optionName(w);
    if (name === "--output") return true;
    if (subcommand === "grep" && (name === "--open-files-in-pager" || /^-[A-Za-z]*O/.test(w))) return true;
    return subcommand === "ls-remote" && (name === "--upload-pack" || name === "--exec" || w === "-u");
  });
}
function readOnlyGit(subcommand, args) {
  if (writingArgument(subcommand, args)) return false;
  if (READ_ONLY_GIT.has(subcommand)) return true;
  switch (subcommand) {
    case "branch":
      return listOnly(args, BRANCH_FLAGS, BRANCH_VALUES, ["-l", "--list"]);
    case "tag":
      return readOnlyTag(args);
    case "remote":
      return readOnlyRemote(args);
    case "config":
      return readOnlyConfig(args);
    case "reflog":
      return args.length === 0 || args[0] === "show";
    case "symbolic-ref":
      return !args.some((w) => ["-d", "--delete", "-m"].includes(optionName(w))) && args.filter((w) => !w.startsWith("-")).length === 1;
    default:
      return LIST_FIRST_WORDS.get(subcommand)?.has(args[0] ?? "") === true;
  }
}
function gitByOtherName(part) {
  if (part.name === null || part.program === null) return false;
  return part.name.startsWith("git-") || part.name === "hub" || part.program.split("/").includes("git-core");
}
var GH_READS = /* @__PURE__ */ new Map([
  ["pr", /* @__PURE__ */ new Set(["view", "list", "diff", "checks", "status"])],
  ["issue", /* @__PURE__ */ new Set(["view", "list"])],
  ["run", /* @__PURE__ */ new Set(["view", "list"])]
]);
var GH_GLOBAL_VALUES = /* @__PURE__ */ new Set(["-R", "--repo", "--hostname"]);
var GH_FIELDS = /* @__PURE__ */ new Set(["-f", "-F", "--field", "--raw-field", "--input"]);
function ghApiMethod(args) {
  for (let i = 0; i < args.length; i++) {
    const word = args[i];
    if (word === "-X" || word === "--method") return (args[i + 1] ?? "").toUpperCase();
    if (word.startsWith("--method=")) return word.slice("--method=".length).toUpperCase();
    if (word.startsWith("-X") && !word.startsWith("--")) return word.slice(2).toUpperCase();
  }
  return args.some((w) => GH_FIELDS.has(optionName(w))) ? "POST" : "GET";
}
function readOnlyGh(args) {
  const [group, action] = positionals(args, GH_GLOBAL_VALUES);
  if (group === void 0) return true;
  if (group === "api") return ghApiMethod(args) === "GET";
  return GH_READS.get(group)?.has(action ?? "") === true;
}
var DEPENDENCY_CHANGES = /* @__PURE__ */ new Map([
  ["npm", /* @__PURE__ */ new Set([
    "install",
    "i",
    "in",
    "ins",
    "inst",
    "insta",
    "instal",
    "isnt",
    "isnta",
    "isntal",
    "isntall",
    "add",
    "it",
    "cit",
    "clean-install-test",
    "sit",
    "install-test",
    "install-ci-test",
    "ci",
    "clean-install",
    "ic",
    "install-clean",
    "isntall-clean",
    "uninstall",
    "un",
    "unlink",
    "remove",
    "rm",
    "r",
    "update",
    "up",
    "upgrade",
    "udpate",
    "link",
    "ln",
    "rebuild",
    "rb",
    "dedupe",
    "ddp",
    "prune",
    "audit fix",
    "pkg set",
    "pkg delete"
  ])],
  ["pnpm", /* @__PURE__ */ new Set(["install", "i", "add", "update", "up", "remove", "rm", "link", "rebuild", "prune", "import"])],
  ["yarn", /* @__PURE__ */ new Set(["", "install", "add", "upgrade", "up", "remove", "link", "import"])],
  ["bun", /* @__PURE__ */ new Set(["install", "i", "add", "update", "remove", "link"])],
  ["pip", /* @__PURE__ */ new Set(["install", "uninstall", "download"])],
  ["uv", /* @__PURE__ */ new Set(["add", "remove", "sync", "pip install", "pip sync", "pip uninstall"])],
  ["poetry", /* @__PURE__ */ new Set(["install", "add", "update", "remove"])],
  ["gem", /* @__PURE__ */ new Set(["install"])],
  ["bundle", /* @__PURE__ */ new Set(["", "install", "update"])],
  ["cargo", /* @__PURE__ */ new Set(["install", "add", "update"])],
  ["go", /* @__PURE__ */ new Set(["get", "install", "mod download"])]
]);
var NPM_EXEC = /* @__PURE__ */ new Set(["exec", "x"]);
var PACKAGE_OPTIONS = ["-p", "--package"];
var PACKAGE_DIR_OPTIONS = ["--prefix", "-C", "--cwd", "--dir"];
var PACKAGE_DIR_VALUES = new Set(PACKAGE_DIR_OPTIONS);
var PIP = /^pip[0-9.]*$/;
var NODE_CLIS = [
  [/^npm-cli\.c?js$/, "npm"],
  [/^pnpm\.c?js$/, "pnpm"],
  [/^yarn(-[0-9][0-9A-Za-z.-]*)?\.c?js$/, "yarn"]
];
function packageCommand(part) {
  const { name } = part;
  if (name === null) return null;
  const args = part.words.slice(1);
  if (PIP.test(name)) return { manager: "pip", words: args };
  if (PYTHON2.test(name)) {
    const m = args.indexOf("-m");
    return m !== -1 && args[m + 1] === "pip" ? { manager: "pip", words: args.slice(m + 2) } : null;
  }
  if (name === "node" || name === "nodejs") {
    const script = scriptArgument(part);
    const cli = script === null ? void 0 : NODE_CLIS.find(([file]) => file.test(import_node_path16.default.posix.basename(script)));
    return cli === void 0 || script === null ? null : { manager: cli[1], words: args.slice(args.indexOf(script) + 1) };
  }
  if (name === "npx") return { manager: "npx", words: args };
  return DEPENDENCY_CHANGES.has(name) ? { manager: name, words: args } : null;
}
function changesInstalled(command) {
  const [first = "", second = ""] = positionals(command.words, PACKAGE_DIR_VALUES);
  const ownOptions = (words) => {
    const tool = words.findIndex((w) => !w.startsWith("-"));
    return words.slice(0, tool === -1 ? words.length : tool);
  };
  if (command.manager === "npx") return ownOptions(command.words).some((w) => PACKAGE_OPTIONS.includes(optionName(w)));
  if (command.manager === "npm" && NPM_EXEC.has(first)) {
    return ownOptions(command.words.slice(command.words.indexOf(first) + 1)).some((w) => PACKAGE_OPTIONS.includes(optionName(w)));
  }
  const changes = DEPENDENCY_CHANGES.get(command.manager);
  return changes !== void 0 && (changes.has(first) || changes.has(`${first} ${second}`));
}
var RISKY_VARIABLES = /* @__PURE__ */ new Set([
  "HOME",
  "PATH",
  "CDPATH",
  "IFS",
  "ENV",
  "BASH_ENV",
  "PROMPT_COMMAND",
  "SHELLOPTS",
  "BASHOPTS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PYTHONHOME",
  "PERL5LIB",
  "PERL5OPT",
  "RUBYOPT",
  "RUBYLIB",
  "ZDOTDIR",
  "path",
  "cdpath",
  "fpath",
  // round 6 (sec L-A): what a build or test run loads or runs
  "GOFLAGS",
  "RUSTC_WRAPPER",
  "RUSTFLAGS",
  "JAVA_TOOL_OPTIONS",
  "MAVEN_OPTS",
  "BUNDLE_GEMFILE",
  "MAKEFLAGS"
]);
var RISKY_PREFIXES = ["LD_", "DYLD_", "GIT_", "BASH_FUNC_", "PYTEST_"];
var RISKY_CARGO = /^CARGO_(?:TARGET_DIR|HOME|BUILD_.*|.*_RUNNER)$/;
var RISKY_SUFFIX = /_CONFIG(?:_FILE)?$/;
var VARIABLE_SETTERS = /* @__PURE__ */ new Set(["export", "declare", "typeset", "readonly", "local"]);
function riskyVariable(name) {
  const bare = name.replace(/[[+].*$/, "");
  return RISKY_VARIABLES.has(bare) || RISKY_PREFIXES.some((prefix) => bare.startsWith(prefix)) || RISKY_CARGO.test(bare) || RISKY_SUFFIX.test(bare) || bare.toLowerCase().startsWith("npm_config_");
}
function riskyAssignment(part) {
  const inline = part.assignments.find(riskyVariable);
  if (inline !== void 0) return inline;
  const args = part.words.slice(1);
  if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
    if (args.some((w) => /^-[A-Za-z]*n/.test(w))) return `${part.program} -n`;
    return args.map((w) => w.split("=")[0]).find((w) => !w.startsWith("-") && riskyVariable(w)) ?? null;
  }
  if (part.name === "printf") return optionValues(args, ["-v"]).find(riskyVariable) ?? null;
  return null;
}
function setterNameNotLiteral(part, unknown) {
  const { program } = part;
  if (program === null) return false;
  const args = part.words.slice(1);
  let names = [];
  if (VARIABLE_SETTERS.has(program)) names = args.map((w) => w.startsWith("-") ? w : w.split("=")[0] ?? "");
  else if (program === "printf") names = [...optionValues(args, ["-v"]), ...args.filter((w) => /^-v./.test(w)).map((w) => w.slice(2))];
  else if (READ_BUILTINS.has(program)) names = [...readNames(program, args), ...args.filter((w) => w.startsWith("-") && w.includes(unknown))];
  else if (program === "unset") names = args;
  else if (program === "getopts") names = positionals(args, NO_VALUES).slice(1, 2);
  return names.some((name) => name.includes(unknown));
}
function riskyExpansionVariable(command) {
  return expansionSet(command, riskyVariable);
}
function riskyLoopVariable(command) {
  for (const match of command.matchAll(/(?:^|[\s;&|(])(?:for|select)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (riskyVariable(match[1])) return match[1];
  }
  return null;
}
var WRITE_TOOLS = /* @__PURE__ */ new Set(["mkdir", "rm", "cp", "mv", "touch", "tee", "ln"]);
var ALLOWED_WRAPPERS = /* @__PURE__ */ new Set(["timeout", "nice", "time", "env", "command", "xargs"]);
var SHELL_STATE = /* @__PURE__ */ new Set(["cd", "pushd", "popd", "unset", ":", "exit", "return"]);
var READ_BUILTINS = /* @__PURE__ */ new Set(["read", "mapfile", "readarray"]);
var READ_VALUES = /* @__PURE__ */ new Set(["-d", "-n", "-N", "-p", "-t", "-u", "-i"]);
var MAPFILE_VALUES = /* @__PURE__ */ new Set(["-d", "-n", "-O", "-s", "-u", "-C", "-c"]);
function readNames(program, args) {
  if (program !== "read") return positionals(args, MAPFILE_VALUES);
  return [...positionals(args, /* @__PURE__ */ new Set([...READ_VALUES, "-a"])), ...optionValues(args, ["-a"])];
}
var VERSION_PROGRAMS = /* @__PURE__ */ new Set(["node", "npm", "pnpm", "yarn", "bun"]);
var SET_FLAGS = /^[-+][euxvo]+$|^[-+]o$|^(?:pipefail|errexit|nounset|xtrace)$/;
var FIND_WRITES = /* @__PURE__ */ new Set(["-delete", "-fprint", "-fprint0", "-fprintf", "-fls", "-ok", "-okdir"]);
var FIND_RUNS = /* @__PURE__ */ new Set(["-exec", "-execdir"]);
function findExecs(part) {
  if (part.name !== "find") return [];
  const args = part.words.slice(1);
  const found2 = [];
  for (let i = 0; i < args.length; i++) {
    if (!FIND_RUNS.has(args[i])) continue;
    const end = args.findIndex((w, k) => k > i && (w === ";" || w === "+"));
    found2.push(args.slice(i + 1, end === -1 ? args.length : end));
    if (end === -1) break;
    i = end;
  }
  return found2;
}
var SNAPSHOT_UPDATES = /* @__PURE__ */ new Set(["-u", "--update", "--updateSnapshot"]);
var SED_IN_PLACE = /^-[A-Za-z]*i|^--in-place/;
function tscChecksOnly(args) {
  const has = (...names) => args.some((w) => names.includes(optionName(w)));
  if (has("--init", "--outDir", "--outFile", "--incremental", "-i", "--tsBuildInfoFile", "--generateTrace", "--watch", "-w", "--declarationDir")) return false;
  if (has("-b", "--build")) return has("--dry");
  return has("--noEmit", "--showConfig");
}
var JS_TOOLS = /* @__PURE__ */ new Map([
  ["tsc", tscChecksOnly],
  ["eslint", () => true],
  ["prettier", (args) => args.some((w) => ["--check", "-c", "--list-different", "-l"].includes(w)) && !args.includes("-w")],
  ["biome", () => true]
]);
var JS_RUNNERS = /* @__PURE__ */ new Set(["npm", "pnpm", "yarn", "bun"]);
var RUN_SCRIPT = /* @__PURE__ */ new Set(["run", "run-script"]);
var PACKAGE_READS = /* @__PURE__ */ new Map([
  ["npm", /* @__PURE__ */ new Set(["audit", "ls", "list", "outdated", "view", "info", "why", "explain", "find-dupes"])],
  ["pnpm", /* @__PURE__ */ new Set(["audit", "ls", "list", "why", "outdated"])],
  ["yarn", /* @__PURE__ */ new Set(["audit", "why", "info", "list"])],
  ["pip", /* @__PURE__ */ new Set(["list", "show", "freeze", "check"])],
  ["pip3", /* @__PURE__ */ new Set(["list", "show", "freeze", "check"])]
]);
var TOOLCHAINS = /* @__PURE__ */ new Map([
  ["go", /* @__PURE__ */ new Set(["build", "vet", "test", "list", "version", "env"])],
  ["cargo", /* @__PURE__ */ new Set(["build", "check", "clippy", "test"])],
  ["swift", /* @__PURE__ */ new Set(["build", "test"])]
]);
var CURL_WRITES = /* @__PURE__ */ new Set([
  "--output",
  "--remote-name",
  "--remote-name-all",
  "--dump-header",
  "--cookie-jar",
  "--trace",
  "--trace-ascii",
  "--libcurl",
  "--output-dir",
  "--create-dirs",
  "--config",
  "--etag-save",
  "--hsts",
  "--alt-svc",
  "--stderr"
]);
var CURL_SENDS = /^--(?:data.*|json|form.*|upload-file|netrc.*)$/;
var WGET_SENDS = /^--(?:post-data|post-file|method|body-data|body-file)$/;
var WGET_WRITES = ["--execute", "--config", "--save-cookies", "--warc-file", "--rejected-log", "--hsts-file", "--output-file", "--append-output", "--directory-prefix"];
var REAL_SHORT_LONG = /* @__PURE__ */ new Set(["--json", "--sarif", "--cov"]);
var GETOPT_PROGRAMS = /* @__PURE__ */ new Set(["sort", "date", "file", "uniq", "wget", "tar", "gtar"]);
function longOptionMatch(word, option, shortest = 3) {
  const name = optionName(word);
  if (name === option) return true;
  return option.startsWith("--") && name.startsWith("--") && name.length >= 2 + shortest && option.startsWith(name) && !REAL_SHORT_LONG.has(name);
}
var NO_VALUES = /* @__PURE__ */ new Set();
var MAVEN_VALUES = ["-pl", "--projects", "-f", "--file", "-P", "--activate-profiles", "-D", "-s", "--settings", "-T", "--threads", "-rf", "--resume-from"];
var GRADLE_VALUES = ["-p", "--project-dir", "-b", "--build-file", "-x", "--exclude-task", "--tests", "--max-workers"];
var VALUE_OPTIONS = /* @__PURE__ */ new Map([
  ["mvn", new Set(MAVEN_VALUES)],
  ["mvnw", new Set(MAVEN_VALUES)],
  ["gradle", new Set(GRADLE_VALUES)],
  ["gradlew", new Set(GRADLE_VALUES)],
  ["go", /* @__PURE__ */ new Set(["-C"])],
  ["xcodebuild", /* @__PURE__ */ new Set(["-scheme", "-destination", "-project", "-workspace", "-configuration", "-sdk", "-target", "-testPlan", "-only-testing", "-skip-testing", "-arch", "-resultBundlePath", "-derivedDataPath", "-enableCodeCoverage"])],
  ["kubectl", /* @__PURE__ */ new Set(["-n", "--namespace", "--context", "-l", "--selector", "-o", "--output", "--kubeconfig", "-c", "--container"])],
  ["docker", /* @__PURE__ */ new Set(["-f", "--file", "-p", "--project-name", "-H", "--host", "--context", "--profile", "--env-file"])],
  ["trivy", /* @__PURE__ */ new Set(["--severity", "--format", "-f", "-s", "--scanners", "--skip-dirs", "--timeout"])],
  ["uniq", /* @__PURE__ */ new Set(["-f", "--skip-fields", "-s", "--skip-chars", "-w", "--check-chars"])],
  ["xxd", /* @__PURE__ */ new Set(["-c", "-cols", "-g", "-groupsize", "-l", "-len", "-s", "-seek", "-o", "-offset", "-n", "-name"])],
  ["pnpm", /* @__PURE__ */ new Set(["--filter", "-F", "-C", "--dir", "--workspace-dir"])],
  ["yarn", /* @__PURE__ */ new Set(["--cwd"])]
]);
var SINGLE_DASH_LONG = /* @__PURE__ */ new Set(["go", "gofmt", "terraform", "javac", "java", "xcodebuild", "mvn", "mvnw", "find", "kubectl", "docker"]);
var MAVEN_GOALS = /* @__PURE__ */ new Set(["validate", "compile", "test-compile", "test", "verify", "clean", "dependency:tree", "dependency:list", "dependency:analyze", "help:effective-pom"]);
var GRADLE_TASK = /^(?:test|check|build|assemble|compile|lint|dependencies|dependencyInsight|clean|tasks|projects|properties|help)[A-Za-z0-9]*$|^[a-z][A-Za-z0-9]*(?:Check|Test|Report)$|^detekt$/;
var MAVEN_CHECK_GOAL = /^[A-Za-z0-9.-]+:(?:check|report)$/;
var GRADLE_WRITES = /Fix|Format|Apply|Update|Publish|Install|Upload|Deploy|Release|Baseline|Wrapper/;
var GOALS = /* @__PURE__ */ new Map([
  ["mvn", (g) => MAVEN_GOALS.has(g) || MAVEN_CHECK_GOAL.test(g)],
  ["mvnw", (g) => MAVEN_GOALS.has(g) || MAVEN_CHECK_GOAL.test(g)],
  ["gradle", gradleTask],
  ["gradlew", gradleTask],
  ["xcodebuild", (g) => ["build", "test", "build-for-testing", "test-without-building", "analyze", "clean"].includes(g) || buildSetting(g)],
  ["rake", (g) => g === "test" || g === "spec"]
]);
function gradleTask(word) {
  const task = word.slice(word.lastIndexOf(":") + 1);
  return GRADLE_TASK.test(task) && !GRADLE_WRITES.test(task);
}
function buildSetting(word) {
  const eq = word.indexOf("=");
  return eq > 0 && !/(?:ROOT|DIR|PATH|LOCATION)$/.test(word.slice(0, eq));
}
function goalsAllowed(name, args) {
  const allowed = GOALS.get(name);
  if (allowed === void 0) return null;
  const goals = positionals(args, valueOptionsOf(name));
  return goals.length === 0 ? null : goals.every(allowed);
}
function valueOptionsOf(name) {
  return VALUE_OPTIONS.get(name) ?? NO_VALUES;
}
function jsTool(tool, args) {
  const check = tool === void 0 ? void 0 : JS_TOOLS.get(tool);
  return check !== void 0 && check(args);
}
function isJsTool(name) {
  return JS_TOOLS.has(name);
}
function buildForm(name, args) {
  if (JS_TOOLS.has(name)) return jsTool(name, args);
  if (name === "make") return true;
  const [first, second] = positionals(args, valueOptionsOf(name));
  const toolchain = TOOLCHAINS.get(name);
  if (toolchain !== void 0) return first !== void 0 && toolchain.has(first);
  if (PACKAGE_READS.get(name)?.has(first ?? "") === true) return second !== "fix";
  if (!JS_RUNNERS.has(name)) return false;
  if (first !== void 0 && RUN_SCRIPT.has(first)) return second !== void 0;
  if (name === "npm" && first === "pkg") return second === "get";
  return (name === "pnpm" || name === "yarn") && first !== void 0 && checkScriptName(first);
}
function scriptRun(first) {
  return RUN_SCRIPT.has(first) || checkScriptName(first);
}
var CHANGING_PARTS = /* @__PURE__ */ new Set(["fix", "write", "format", "update", "deploy", "release", "publish", "migrate", "seed", "prepare"]);
var WRITING_PARTS = /* @__PURE__ */ new Set(["fix", "write", "deploy", "release", "publish", "migrate", "seed"]);
var CHECKING_PARTS = /* @__PURE__ */ new Set(["check", "verify"]);
var CHECK_NAME_PARTS = /* @__PURE__ */ new Set(["check", "verify", "ci", "lint", "test", "typecheck", "build"]);
function scriptParts(script) {
  return script.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[:_.\s-]/);
}
function dryRun(script) {
  return /dry[-_:]?run/i.test(script);
}
function changingScript(script) {
  const parts = scriptParts(script);
  if (!parts.some((p) => CHANGING_PARTS.has(p)) || dryRun(script)) return false;
  if (parts.some((p) => WRITING_PARTS.has(p))) return true;
  return !parts.some((p) => CHECKING_PARTS.has(p)) && !(parts.length === 1 && parts[0] === "lint");
}
function runsChangingScript(name, args) {
  return changingScriptRun(name, args) !== null;
}
function changingScriptRun(name, args) {
  if (!JS_RUNNERS.has(name)) return null;
  const [first, second] = positionals(args, valueOptionsOf(name));
  const script = first !== void 0 && RUN_SCRIPT.has(first) ? second : first;
  return script !== void 0 && changingScript(script) ? script : null;
}
function checkScriptName(script) {
  return SCRIPT_NAMES.test(script) || scriptParts(script).some((p) => CHECK_NAME_PARTS.has(p)) && !changingScript(script) && /^[A-Za-z0-9:_-]+$/.test(script);
}
var SCRIPT_NAMES = /^(?:test|lint|typecheck|type-check|check|build|verify)(?::[A-Za-z0-9:_-]+)?$/;
function fetchForm(name, args) {
  const shortHas = (letters) => args.some((w) => !w.startsWith("--") && w.startsWith("-") && letters.test(w.slice(1)));
  if (name === "curl") {
    const rest = withoutDevNull(args);
    const methods = [...optionValues(rest, ["-X", "--request"]), ...rest.filter((w) => /^-X./.test(w)).map((w) => w.slice(2))];
    const formats = [...optionValues(rest, ["-w", "--write-out"]), ...rest.filter((w) => /^-w./.test(w)).map((w) => w.slice(2))];
    const short = (letters) => rest.some((w) => !w.startsWith("--") && w.startsWith("-") && letters.test(w.slice(1)));
    return !rest.some((w) => CURL_WRITES.has(optionName(w)) || CURL_SENDS.test(optionName(w))) && !short(/[oODcKdFTn]/) && methods.every((m) => m === "GET" || m === "HEAD") && !formats.some((f) => f.includes("%output{") || f.startsWith("@"));
  }
  if (name !== "wget") return false;
  if (args.some((w) => WGET_SENDS.test(optionName(w)) || WGET_WRITES.some((o) => longOptionMatch(w, o))) || shortHas(/e/)) return false;
  const prints = args.includes("--spider") || args.includes("--output-document=-") || args.some((w, i) => /^-[A-Za-z]*O-$/.test(w) || /^-[A-Za-z]*O$/.test(w) && args[i + 1] === "-");
  const logs = args.some((w) => ["--output-file", "--append-output", "--directory-prefix"].includes(optionName(w))) || shortHas(/[oaP]/);
  return prints && !logs;
}
function withoutDevNull(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if ((w === "--output" || /^-[A-Za-z]*o$/.test(w)) && args[i + 1] === "/dev/null") {
      if (w.length > 2 && !w.startsWith("--")) out.push(w.slice(0, -1));
      i++;
    } else if (w === "--output=/dev/null" || /^-[A-Za-z]*o\/dev\/null$/.test(w)) {
      const head = w.startsWith("--") ? "" : w.slice(0, w.indexOf("o/dev/null"));
      if (head.length > 1) out.push(head);
    } else {
      out.push(w);
    }
  }
  return out;
}
function knownForm(part, testCommandPatterns, matches) {
  const { name, program } = part;
  if (name === null || program === null) return true;
  const args = part.words.slice(1);
  if (SHELL_STATE.has(program) || VARIABLE_SETTERS.has(program)) return true;
  if (runsChangingScript(name, args)) return false;
  if (program === "set") return args.every((w) => SET_FLAGS.test(w));
  if (READ_BUILTINS.has(program)) return part.writeTargets.length === 0 && !readNames(program, args).some(riskyVariable);
  if (VERSION_PROGRAMS.has(name) && args.length === 1 && (args[0] === "--version" || args[0] === "-v")) return true;
  if (name === "git" && part.git !== null) return true;
  if (name === "gh" || WRITE_TOOLS.has(name)) return true;
  if (testCommandPatterns.some((pattern) => matches(pattern, part.words))) return !args.some((w) => SNAPSHOT_UPDATES.has(optionName(w)));
  if (isInterpreter(name) && !JS_RUNNERS.has(name)) return false;
  return buildForm(name, args) || fetchForm(name, args);
}
function namedProgramMisused(part) {
  const args = part.words.slice(1);
  if (part.name === "sed") {
    const facts = sedFacts([...args]);
    return args.some((w) => SED_IN_PLACE.test(w)) || runsScriptFile("sed", [...args]) || facts.commands.length > 0 || facts.unreadable !== null;
  }
  if (part.name === "uniq" || part.name === "xxd") return positionals(args, valueOptionsOf(part.name)).length > 1;
  if (part.name !== "find") return false;
  return args.some((w) => FIND_WRITES.has(w));
}
function interpreterForm(part) {
  const args = part.words.slice(1);
  const { name } = part;
  if (name === "node" || name === "nodejs") {
    if (args.some((w) => ["-e", "--eval", "-p", "--print", "--test"].includes(optionName(w)))) return "inline";
  } else if (name !== null && PYTHON2.test(name)) {
    if (args.includes("-c")) return "inline";
    if (args.includes("-m")) return null;
  } else if (name === "ruby" || name === "php") {
    if (args.some((w) => w.startsWith("-"))) return null;
  } else if (name === "bash" || name === "sh") {
    if (args.some((w) => /^-[A-Za-z0-9]*c/.test(w))) return "inline";
    if (args.some((w) => /^-[A-Za-z0-9]*s/.test(w) || w === "-")) return null;
  } else {
    return null;
  }
  const script = scriptArgument(part);
  return script === null || script.startsWith("/dev/") ? null : "script";
}
function ownJobs(args, unknown) {
  return args.length > 0 && args.every((w) => w.startsWith("%") || w.startsWith("-") || w.includes(unknown));
}

// src/tool-gate/rules/gate-agent-write.ts
var WILDCARD_SEGMENT = /[*?[]/;
var REPORT_ONLY = "Review agents review and report only: report the problem and the fix, and the stack's builder agent (for example oss:typescript-pro) makes the change.";
var GIT_SETUP_OPTIONS = ["-c", "--config-env", "--exec-path", "--git-dir", "--work-tree"];
var GIT_DIR_VARIABLES = /* @__PURE__ */ new Set(["GIT_DIR", "GIT_WORK_TREE"]);
var REVIEW_CHECK_FILES = /* @__PURE__ */ new Set(["gate-run.cjs", "gate-run.js", "oss-gate-run.sh"]);
var USER_LEVEL_OFF_LIMITS = [
  ".oss",
  ".claude",
  ".gitconfig",
  ".config",
  ".ssh",
  ".npmrc",
  // the shell's own start-up files run in every later session
  ".bashrc",
  ".bash_profile",
  ".bash_login",
  ".bash_logout",
  ".profile",
  ".zshrc",
  ".zshenv",
  ".zprofile",
  ".zlogin",
  ".zlogout"
];
var MOVES_UNSEEN = /* @__PURE__ */ new Set(["eval", "source", ".", "ln"]);
var COMMAND_STRING = /[\s;&|<>()`]/;
var OFFLOADER = /(^|\/)agent-offload\.[cm]?[jt]s$/;
var FOLDER_MOVES = /* @__PURE__ */ new Set(["cd", "pushd", "popd"]);
var DEV_SINK = /^\/dev\/(?:null|stdout|stderr|stdin|tty|fd\/[0-9]+)$/;
var MAX_WORD = 4096;
function inTemp2(target, scope, paths, caseInsensitive) {
  if (target.includes(UNKNOWN) || target.length > MAX_WORD) return false;
  if (DEV_SINK.test(target)) return true;
  const fixed = fixedPart(target);
  const roots = rootsOf(scope.temp, paths);
  const forms2 = [import_node_path17.default.normalize(fixed), paths.realpath(fixed)];
  return forms2.every((p) => roots.some((r) => isSameOrAncestor(r, p, caseInsensitive))) && !touches(target, [...offLimits(scope), scope.home], paths, caseInsensitive);
}
function offLimits(scope) {
  return [...scope.repos, ...userLevel(scope)];
}
function userLevel(scope) {
  return USER_LEVEL_OFF_LIMITS.map((p) => import_node_path17.default.join(scope.home, p));
}
function fixedPart(p) {
  const segments = p.split("/");
  const first = segments.findIndex((segment) => WILDCARD_SEGMENT.test(segment));
  return first === -1 ? p : segments.slice(0, first).join("/") || "/";
}
function rootsOf(places, paths) {
  return places.flatMap((place) => [place, paths.realpath(place)]);
}
function touches(absPath, places, paths, caseInsensitive) {
  const fixed = fixedPart(absPath);
  const forms2 = [import_node_path17.default.normalize(fixed), paths.realpath(fixed)];
  const roots = rootsOf(places, paths);
  return forms2.some((p) => roots.some((r) => isSameOrAncestor(r, p, caseInsensitive) || isSameOrAncestor(p, r, caseInsensitive)));
}
function insideRepo(dir, repos, paths, caseInsensitive) {
  if (dir.includes(UNKNOWN)) return true;
  const fixed = fixedPart(dir);
  const forms2 = [import_node_path17.default.normalize(fixed), paths.realpath(fixed)];
  return forms2.some((p) => rootsOf(repos, paths).some((r) => isSameOrAncestor(r, p, caseInsensitive)));
}
function refusal2(what) {
  return { rule: "gate-agent-write", reason: `Refused by gate-agent-write: ${what}. ${REPORT_ONLY}` };
}
function checkGateAgentEdit(call, agent, settings, scope, paths, caseInsensitive = false) {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  const own = scope.privateDir ?? null;
  if (own !== null && inOwnFolder(call.filePath, own, scope, paths, caseInsensitive)) return null;
  if (newOffloadPrompt(call.filePath, scope.temp) && (scope.offloadFolders ?? []).includes(import_node_path17.default.dirname(call.filePath))) return null;
  const instead = own === null ? "its private folder can't be made right now" : `write in its own private folder \`${own}\` instead`;
  return refusal2(`a review agent's Write and Edit tools may write only in its own private folder, not \`${call.filePath}\`; ${instead}`);
}
function inOwnFolder(file, own, scope, paths, caseInsensitive) {
  if (file.includes(UNKNOWN) || file.length > MAX_WORD || !import_node_path17.default.isAbsolute(file)) return false;
  const forms2 = [import_node_path17.default.normalize(file), paths.realpath(import_node_path17.default.normalize(file))];
  return forms2.every((p) => isSameOrAncestor(own, p, caseInsensitive) && p !== own) && !touches(file, [...offLimits(scope), scope.home], paths, caseInsensitive) && // round 11, SEC CRITICAL-1: no link in the private folder on the way
  !linkInto(file, own, caseInsensitive);
}
function newOffloadPrompt(file, temp) {
  if (!import_node_path17.default.isAbsolute(file) || import_node_path17.default.normalize(file) !== file || import_node_path17.default.basename(file) !== "prompt.md") return false;
  const folder = import_node_path17.default.dirname(file);
  if (!/^oss-offload\.[A-Za-z0-9.]+$/.test(import_node_path17.default.basename(folder)) || !offloadFolderSafe(folder, temp)) return false;
  return import_node_fs11.default.lstatSync(file, { throwIfNoEntry: false }) === void 0;
}
function absolute(word, cwd, home) {
  if (word === "~" || word.startsWith("~/")) return import_node_path17.default.join(home, word.slice(1));
  return word.startsWith("~") ? UNKNOWN : import_node_path17.default.resolve(cwd, word);
}
function gitGlobals(part, git) {
  return part.words.slice(1, Math.max(1, part.words.length - git.args.length - 1));
}
function runsInRepo(part, dirs, scope, paths, caseInsensitive) {
  return part.lostDir !== null || [part.cwd, ...dirs].some((dir) => insideRepo(dir, scope.repos, paths, caseInsensitive));
}
function checkGit(part, scope, paths, caseInsensitive) {
  const { git } = part;
  if (git === null) return null;
  if (writesUserGitConfig(git.subcommand, git.args)) return refusal2("a review agent may not change the user's or the system's git config");
  const pointed = [
    ...optionValues(gitGlobals(part, git), ["--git-dir", "--work-tree"]),
    ...part.assignments.flatMap((name, i) => GIT_DIR_VARIABLES.has(name) ? [part.assignmentValues[i] ?? UNKNOWN] : [])
  ].map((p) => import_node_path17.default.resolve(part.cwd, p));
  if (!runsInRepo({ ...part, cwd: git.dir }, pointed, scope, paths, caseInsensitive)) return null;
  const setup = gitGlobals(part, git).some((w) => GIT_SETUP_OPTIONS.includes(optionName(w)));
  if (!setup && git.unknownOption === void 0 && readOnlyGit(git.subcommand, git.args)) return null;
  return refusal2(`a review agent may only run read-only git commands in the repo it reviews, not \`git ${git.subcommand}\``);
}
function gitVariable(part, earlier) {
  for (const p of [...earlier, part]) {
    const assigned = p.assignments.find((name) => name.startsWith("GIT_"));
    if (assigned !== void 0) return assigned;
    if (p.program !== null && VARIABLE_SETTERS.has(p.program)) {
      const named2 = p.words.slice(1).find((w) => w.startsWith("GIT_"));
      if (named2 !== void 0) return named2.split("=")[0];
    }
  }
  return null;
}
function changesDependencies(part, scope, paths, caseInsensitive) {
  if (part.words.length === 2 && (part.words[1] === "--version" || part.words[1] === "-v")) return false;
  const command = packageCommand(part);
  if (command === null || !changesInstalled(command)) return false;
  const dirs = optionValues(command.words, PACKAGE_DIR_OPTIONS).map((d) => absolute(d, part.cwd, scope.home));
  return runsInRepo(part, dirs, scope, paths, caseInsensitive);
}
function lnOperands(part, home) {
  let options = true;
  return part.words.slice(1).flatMap((word) => {
    if (options && word === "--") {
      options = false;
      return [];
    }
    if (options && word.startsWith("-")) return word.includes("=") ? [word.slice(word.indexOf("=") + 1)] : [];
    return [word];
  }).map((word) => absolute(word, part.cwd, home));
}
function pathWords(part, home) {
  const words = [];
  for (const word of part.words.slice(1)) {
    if (COMMAND_STRING.test(word)) return null;
    if (!word.startsWith("-")) words.push(word);
    else if (word.includes("=")) words.push(word.slice(word.indexOf("=") + 1));
    else if (!word.startsWith("--") && word.length > 2) words.push(word.slice(2));
  }
  return words.map((w) => absolute(w, part.cwd, home));
}
function runsOutsideRepos(part, scope, paths, caseInsensitive, earlier) {
  if (part.lostDir !== null || !scope.exists(part.cwd)) return false;
  if ([...earlier, part].some((p) => MOVES_UNSEEN.has(p.program ?? "") || p.assignments.includes("HOME") || riskyAssignment(p) !== null)) return false;
  const words = pathWords(part, scope.home);
  if (words === null) return false;
  const places = [part.cwd, ...part.git === null ? [] : [part.git.dir], ...words, ...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs];
  return places.every((p) => inTemp2(p, scope, paths, caseInsensitive));
}
function programNotLiteral(part) {
  const script = scriptArgument(part);
  return [part.program, script].some((word) => word !== null && (word.includes(UNKNOWN) || part.globs.has(word)));
}
function runsReviewCheck(part, home, paths) {
  return [part.program, scriptArgument(part)].some((word) => {
    if (word === null) return false;
    const file = absolute(word, part.cwd, home);
    return [file, paths.realpath(file)].some((p) => REVIEW_CHECK_FILES.has(import_node_path17.default.posix.basename(p)));
  });
}
function checkOffload(part, agent) {
  if (!part.words.some((w) => OFFLOADER.test(w))) return null;
  const named2 = optionValues(part.words, ["--agent"]);
  const own = agent.slice(agent.lastIndexOf(":") + 1);
  if (named2.length === 1 && !named2[0].includes(UNKNOWN) && isGateAgent(named2[0], [own])) return null;
  return refusal2("a review agent may not offload under another agent's name; offload once, under its own name");
}
function namedEntry(part, settings, scope, inRepo) {
  const { program, name } = part;
  if (program === null || name === null) return null;
  for (const entry of settings.reviewPrograms ?? []) {
    const [first = "", ...rest] = entry.split(" ").filter((w) => w !== "");
    const runs = first.includes("/") ? absolute(first, "/", scope.home) === absolute(program, part.cwd, scope.home) : first === name && (!program.includes("/") || inRepo);
    if (runs && entryWordsMatch(part, rest)) return [first, ...rest];
  }
  return null;
}
function entryWordsMatch(part, entryWords) {
  const args = part.words.slice(1);
  if (isInterpreter(part.name)) return entryWords.every((word, i) => args[i] === word);
  const subcommands = entryWords.filter((w) => !w.startsWith("-"));
  const operands2 = positionals(args, valueOptionsOf(part.name ?? ""));
  const extra = NO_EXTRA_SUBCOMMANDS.has(part.name ?? "") && operands2.slice(subcommands.length).some((w) => !/[./]/.test(w));
  return !extra && subcommands.every((word, i) => operands2[i] === word) && entryWords.filter((w) => w.startsWith("-")).every((option) => args.some((w) => w === option || optionName(w) === option));
}
var NO_EXTRA_SUBCOMMANDS = /* @__PURE__ */ new Set(["cargo", "go", "rustc", "dotnet", "swift", "terraform"]);
function writeOption(part, settings) {
  const args = part.words.slice(1);
  const singleDash = SINGLE_DASH_LONG.has(part.name ?? "");
  const dashed = (word) => optionName(word).replace(/^--/, "-");
  return (settings.reviewWriteOptions ?? []).some((entry) => {
    const [first = "", option] = entry.split(" ");
    if (option === void 0) return args.some((w) => longOptionMatch(w, first));
    if (first !== part.name) return false;
    if (singleDash) return args.some((w) => dashed(w) === dashed(option));
    if (!/^-[A-Za-z0-9]$/.test(option)) return args.some((w) => longOptionMatch(w, option, GETOPT_PROGRAMS.has(part.name ?? "") ? 1 : 3));
    return args.some((w) => !w.startsWith("--") && new RegExp(`^-[A-Za-z0-9]*${option.slice(1)}`).test(w));
  });
}
function plainNamed(word, settings) {
  return !word.includes("/") && (settings.reviewPrograms ?? []).includes(word) && word !== "find";
}
var PACKAGE_RUNNERS = /* @__PURE__ */ new Set(["npx", "bunx"]);
var RUNNER_EXEC_OPTIONS = /* @__PURE__ */ new Set(["-p", "--package", "-c", "--call"]);
var SUBCOMMAND_RUNNERS = /* @__PURE__ */ new Map([["poetry", "run"], ["pipenv", "run"], ["bundle", "exec"], ["uv", "run"]]);
var UV_NO_SYNC = /* @__PURE__ */ new Set(["--frozen", "--no-sync"]);
var UV_QUIET = /* @__PURE__ */ new Set(["--offline", "-q", "--quiet"]);
function packageAllowed(runner2, tool, settings, scope, fetchesMissing, cwd) {
  if (tool.includes("/")) return false;
  const installed = binFolders(cwd, scope).some((dir) => scope.exists(import_node_path17.default.join(dir, tool)));
  return isJsTool(tool) && (!fetchesMissing || installed) || (settings.reviewNpxPackages ?? []).includes(tool) || settings.testCommandPatterns.includes(`${runner2} ${tool}`) || installed;
}
function binFolders(cwd, scope) {
  const folders = scope.repos.map((repo2) => import_node_path17.default.join(repo2, "node_modules", ".bin"));
  const repo = cwd.includes(UNKNOWN) ? void 0 : scope.repos.find((r) => isSameOrAncestor(r, cwd, false));
  if (repo === void 0) return folders;
  for (let dir = cwd; dir !== repo && dir !== import_node_path17.default.dirname(dir); dir = import_node_path17.default.dirname(dir)) folders.push(import_node_path17.default.join(dir, "node_modules", ".bin"));
  return folders;
}
var FETCHING_RUNNERS = /* @__PURE__ */ new Set(["npx", "bunx", "npm exec", "npm x"]);
function afterRunnerOptions(runner2, args, settings, scope, cwd) {
  const at = args.findIndex((w) => !w.startsWith("-") || w === "--");
  if (args.slice(0, at === -1 ? args.length : at).some((w) => RUNNER_EXEC_OPTIONS.has(optionName(w)))) return { refused: `${runner2} -p` };
  const words = args.slice(at === -1 ? args.length : args[at] === "--" ? at + 1 : at);
  const [tool] = words;
  const fetches = FETCHING_RUNNERS.has(runner2) && !args.slice(0, at === -1 ? args.length : at).includes("--no-install");
  if (tool === void 0 || !packageAllowed(runner2 === "bunx" ? "bunx" : "npx", tool, settings, scope, fetches, cwd)) return { refused: `${runner2} ${tool ?? ""}` };
  return { words };
}
function runnerOf(part, settings, scope) {
  const { name, words } = part;
  if (name === null) return null;
  const args = words.slice(1);
  if (/^python[0-9.]*$/.test(name) && args[0] === "-m") {
    const module2 = args[1];
    if (module2 === void 0 || module2.includes("/")) return { refused: `${name} -m` };
    if (settings.testCommandPatterns.some((p) => matchCommand(p, part.words))) return module2 === "unittest" ? { words: [] } : { words: [module2.replaceAll("_", "-"), ...args.slice(2)] };
    return { words: [module2.replaceAll("_", "-"), ...args.slice(2)] };
  }
  if (PACKAGE_RUNNERS.has(name)) return afterRunnerOptions(name, args, settings, scope, part.cwd);
  const [first] = positionals(args, valueOptionsOf(name));
  const after = first === void 0 ? [] : args.slice(args.indexOf(first) + 1);
  if (name === "npm" && (first === "exec" || first === "x") || (name === "pnpm" || name === "yarn") && first === "exec") {
    return afterRunnerOptions(`${name} ${first}`, after, settings, scope, part.cwd);
  }
  if ((name === "pnpm" || name === "yarn") && first !== void 0 && !scriptRun(first) && packageAllowed(name, first, settings, scope, false, part.cwd) && !(settings.reviewNpxPackages ?? []).includes(first)) {
    return { words: [first, ...after] };
  }
  const sub = SUBCOMMAND_RUNNERS.get(name);
  if (sub === void 0 || args[0] !== sub) return null;
  let rest = args.slice(1);
  if (name === "uv") {
    const options = rest.slice(0, Math.max(0, rest.findIndex((w) => !w.startsWith("-"))));
    if (!options.some((w) => UV_NO_SYNC.has(w)) || !options.every((w) => UV_NO_SYNC.has(w) || UV_QUIET.has(w))) return { refused: "uv run (without --frozen or --no-sync)" };
    rest = rest.slice(options.length);
  }
  return rest[0] === void 0 || rest[0].startsWith("-") ? { refused: `${name} ${sub}` } : { words: rest };
}
function shellWord(word) {
  return `'${word.replaceAll("'", "'\\''")}'`;
}
var WRAPPER_WRITES = /* @__PURE__ */ new Map([
  ["time", /^(?:-[A-Za-z]*[oa]|--output|--append)/],
  ["env", /^(?:-[A-Za-z]*[CS]|--chdir|--split-string)/]
]);
function wrapperWrites(part) {
  return part.wrappers.some((w, i) => {
    const writes = WRAPPER_WRITES.get(w);
    return writes !== void 0 && (part.wrapperOptions[i] ?? []).some((o) => writes.test(o));
  });
}
function mktempTargets(part, home) {
  const args = part.words.slice(1);
  const dirs = optionValues(args, ["-p", "--tmpdir"]);
  const templates = positionals(args, /* @__PURE__ */ new Set(["-p", "--tmpdir", "-t", "--suffix"]));
  const base = dirs[0] ?? part.cwd;
  return [...dirs.map((d) => absolute(d, part.cwd, home)), ...templates.map((t) => absolute(t, absolute(base, part.cwd, home), home))];
}
function toolWrites(part, scope, paths, caseInsensitive) {
  const args = part.words.slice(1);
  const into = (values) => values.some((v) => !inTemp2(absolute(v, part.cwd, scope.home), scope, paths, caseInsensitive));
  if (optionValues(args, ["--reporter"]).some((v) => v.split(",").includes("html"))) return true;
  switch (part.name) {
    case "mypy":
      return args.some((w) => /^--[a-z-]+-report$/.test(optionName(w)));
    case "golangci-lint":
      return args.some((w) => optionName(w).startsWith("--output.")) || optionValues(args, ["--out-format"]).some((v) => v.includes(":"));
    case "xcodebuild":
      return into(optionValues(args, ["-resultBundlePath", "-derivedDataPath", "-archivePath", "-exportPath"]));
    case "staticcheck": {
      const debug = args.filter((w) => /^--?debug\./.test(w));
      return debug.some((w) => !w.includes("=")) || into(debug.map((w) => w.slice(w.indexOf("=") + 1)));
    }
    case "dotnet":
      return args.some((w) => /^[-/](?:bl|binarylogger)(?::|$)/i.test(w) && (!w.includes(":") || into([w.slice(w.indexOf(":") + 1)])));
    case "mvn":
    case "mvnw":
      return args.some((w) => /^-Dexec\./.test(w)) || optionValues(args, ["-D"]).some((v) => v.startsWith("exec."));
    case "javac": {
      const out = optionValues(args, ["-d", "-s", "-h"]);
      return !args.includes("-d") || into(out) || args.some((w) => ["-processorpath", "--processor-module-path", "-processor", "--processor-path"].includes(w) || w.startsWith("-Xplugin"));
    }
    default:
      return false;
  }
}
function checkAllowlist(part, agent, settings, scope, paths, caseInsensitive) {
  if (part.program === null) return null;
  const offList = (what) => refusal2(
    `\`${what}\` is not on the review allowlist (the plugin's reviewPrograms setting in config/tool-gates.json, plus git and gh read forms, test runs, builds, lint and type checks); a user can add a program under toolGates.reviewPrograms in ~/.oss/config.json`
  );
  const wrapper = part.wrappers.find((w) => !ALLOWED_WRAPPERS.has(w));
  if (wrapper !== void 0) return offList(wrapper);
  if (wrapperWrites(part)) return offList(part.wrappers.join(" "));
  const script = changingScriptRun(part.name ?? "", part.words.slice(1));
  if (script !== null) return refusal2(`a review agent may not run the package script \`${script}\` (its name says it changes things: deploy, publish, release, migrate, seed or fix)`);
  if (part.wrappers.includes("xargs") && (!plainNamed(part.program, settings) || BY_WORD_COUNT.has(part.name ?? ""))) return offList(`xargs ${part.program}`);
  const inRepo = part.program.includes("/") && insideRepo(absolute(part.program, part.cwd, scope.home), scope.repos, paths, caseInsensitive);
  if (toolWrites(part, scope, paths, caseInsensitive)) return offList(part.words.slice(0, 2).join(" "));
  if (runsRepoCode(part, settings) && !staysInRepo(part, scope, paths, caseInsensitive)) {
    return refusal2(`a review agent may run \`${part.words.slice(0, 2).join(" ")}\` only from the repo it reviews, with every path and config it names inside that repo`);
  }
  const goals = goalsAllowed(part.name ?? "", part.words.slice(1));
  if (goals !== null && (settings.reviewPrograms ?? []).some((e) => e.split(" ")[0] === part.name) && (!part.program.includes("/") || inRepo)) {
    return goals && !writeOption(part, settings) ? null : offList(part.words.slice(0, 3).join(" "));
  }
  if (part.name === "mktemp") return mktempTargets(part, scope.home).some((p) => !inTemp2(p, scope, paths, caseInsensitive)) ? offList("mktemp") : null;
  const entry = namedEntry(part, settings, scope, inRepo);
  if (entry !== null) {
    const misused = namedProgramMisused(part) || writeOption(part, settings);
    return misused ? offList(part.words.slice(0, entry.length + 1).join(" ")) : null;
  }
  if (part.program.includes("/") && !inRepo) return offList(part.program);
  if (knownForm(part, settings.testCommandPatterns, matchCommand) && !writeOption(part, settings)) return null;
  if (part.name === "kill") return isGateAgent(agent, settings.backgroundAgents ?? []) && ownJobs(part.words.slice(1), UNKNOWN) ? null : offList("kill");
  const form = interpreterForm(part);
  if (form !== null && writeOption(part, settings)) return offList(part.words.slice(0, 2).join(" "));
  if (form === "inline") {
    if (scope.fallback !== true) return nodeTestRun(part) ? checkNodeTestFiles(part, scope, paths, caseInsensitive) : null;
    return nodeTestRun(part) ? checkNodeTestFallback(part, scope, paths, caseInsensitive) : NO_SANDBOX;
  }
  if (form === "script") {
    const file = absolute(scriptArgument(part) ?? "", part.cwd, scope.home);
    const inRepoFile = insideRepo(file, scope.repos, paths, caseInsensitive);
    if (scope.fallback === true && !inRepoFile) return NO_SANDBOX;
    const where = isGateAgent(agent, settings.backgroundAgents ?? []) || inRepoFile;
    return where && scope.exists(file) ? null : offList(`${part.program} ${scriptArgument(part) ?? ""}`);
  }
  if (isJsTool(part.name ?? "")) {
    const name = part.name ?? "";
    const form2 = name === "tsc" ? `${name} --noEmit` : name;
    return refusal2(
      `\`${part.words.slice(0, 2).join(" ")}\` is not on the review allowlist: a review agent runs ${name} only to check, never to write files; run the repo's own copy as \`npx --no-install ${form2} \u2026\` or \`node_modules/.bin/${form2} \u2026\``
    );
  }
  return offList(part.program);
}
function nodeTestRun(part) {
  return (part.name === "node" || part.name === "nodejs") && part.words.slice(1).some((w) => optionName(w) === "--test") && !part.words.slice(1).some((w) => ["-e", "--eval", "-p", "--print"].includes(optionName(w)));
}
var NODE_TEST_VALUES = /* @__PURE__ */ new Set(["--test-name-pattern", "--test-skip-pattern", "--test-reporter", "--test-reporter-destination", "--test-concurrency", "--test-timeout", "--test-shard", "--test-isolation", "--test-coverage-include", "--test-coverage-exclude", "--cpu-prof-dir", "--diagnostic-dir", "--heap-prof-dir"]);
var NODE_TEST_OPTIONS = /* @__PURE__ */ new Set([...NODE_TEST_VALUES, "--test", "--test-only", "--test-force-exit", "--experimental-test-coverage", "--test-update-snapshots", "--enable-source-maps", "--no-warnings", "--experimental-strip-types", "--experimental-test-module-mocks", "--test-coverage-branches", "--test-coverage-functions", "--test-coverage-lines", "--cpu-prof", "--heap-prof"]);
var NODE_REPORTERS = /* @__PURE__ */ new Set(["spec", "tap", "dot", "junit", "lcov"]);
var NODE_TEST_OUTPUTS = ["--test-reporter-destination", "--cpu-prof-dir", "--diagnostic-dir", "--heap-prof-dir"];
function checkNodeTestFallback(part, scope, paths, caseInsensitive) {
  const args = part.words.slice(1);
  const refused3 = refusal2("with no OS sandbox, a review agent may run `node --test` only on the repo's own tests, from the repo, with test selection and reporting options only (no --import, --require, loader, env file, watch mode or reporter module), writing reports only to the temp folders");
  if (part.cwd.includes(UNKNOWN) || !insideRepo(part.cwd, scope.repos, paths, caseInsensitive)) return refused3;
  if (args.some((w) => w.startsWith("-") && w !== "-" && !NODE_TEST_OPTIONS.has(optionName(w)))) return refused3;
  if (optionValues(args, ["--test-reporter"]).some((r) => !NODE_REPORTERS.has(r))) return refused3;
  const given = (names) => args.some((w) => names.includes(optionName(w)));
  if (given(["--test-update-snapshots"])) return refused3;
  if (given(["--cpu-prof"]) && !given(["--cpu-prof-dir", "--diagnostic-dir"])) return refused3;
  if (given(["--heap-prof"]) && !given(["--heap-prof-dir", "--diagnostic-dir"])) return refused3;
  const outputs = optionValues(args, NODE_TEST_OUTPUTS).filter((v) => v !== "stdout" && v !== "stderr");
  if (outputs.some((v) => !inTemp2(absolute(v, part.cwd, scope.home), scope, paths, caseInsensitive))) return refused3;
  const inRepo = (w) => !w.includes(UNKNOWN) && insideRepo(absolute(w, part.cwd, scope.home), scope.repos, paths, caseInsensitive);
  const operands2 = [...positionals(args, NODE_TEST_VALUES), ...optionValues(args, ["--test-coverage-include", "--test-coverage-exclude"])];
  return operands2.every(inRepo) ? null : refused3;
}
function checkNodeTestFiles(part, scope, paths, caseInsensitive) {
  const files = positionals(part.words.slice(1), NODE_TEST_VALUES).map((w) => absolute(w, part.cwd, scope.home));
  return files.every((f) => insideRepo(f, scope.repos, paths, caseInsensitive) && !f.includes(UNKNOWN)) ? null : refusal2("a review agent may run `node --test` only on test files in the repo it reviews");
}
var NO_SANDBOX = refusal2(
  "with no OS sandbox on this machine, a review agent may not run inline code (python -c, node -e, bash -c \u2026) or a script outside the repo it reviews; run the repo's own checks and scripts, or report what you need to the main agent"
);
var CONTAINER_TOOLS = /* @__PURE__ */ new Set(["docker", "docker-compose", "podman", "kubectl", "helm", "k9s"]);
var XCODEBUILD_QUERIES = /* @__PURE__ */ new Set(["-list", "-version", "-showBuildSettings", "-showsdks", "-showdestinations", "-help", "-usage"]);
function unbuildableStack(part) {
  const name = part.name ?? "";
  const args = part.words.slice(1);
  if (["mvn", "mvnw", "gradle", "gradlew"].includes(name)) return true;
  if (name === "swift") return ["build", "test", "run"].includes(args[0] ?? "");
  if (name === "dotnet") return ["build", "test", "run"].includes(args[0] ?? "");
  if (name === "xcodebuild") return !args.some((w) => XCODEBUILD_QUERIES.has(w));
  return false;
}
function gitCreates(git, home) {
  const named2 = git.args.filter((w) => !w.startsWith("-"));
  const options = optionValues(git.args, ["--separate-git-dir", "--template"]);
  if (git.subcommand === "init") return [...named2.length > 0 ? named2.slice(0, 1) : ["."], ...options].map((w) => absolute(w, git.dir, home));
  if (git.subcommand !== "clone") return [];
  const into = named2[1] ?? import_node_path17.default.posix.basename(named2[0] ?? "").replace(/\.git$/, "");
  return [into, ...options].map((w) => absolute(w, git.dir, home));
}
var PROMPT_PLACEHOLDER = "'<path printed in step 1>'";
var PROMPT_PATH = "'((?:/[A-Za-z0-9_.+-]+)+)/(oss-offload\\.[A-Za-z0-9.]+)/prompt\\.md'";
function setupLines(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
}
function ownAgentFile(agent) {
  if (agent === void 0) return null;
  const bare = agent.slice(agent.lastIndexOf(":") + 1).trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(bare) ? `${bare}.md` : null;
}
function isOwnSetupStep(command, agentFileText, temp, excluded = [], folderSafe = () => true) {
  const call = setupLines(command);
  for (const match of agentFileText.matchAll(/^( *)```bash\n([\s\S]*?)^\1```/gm)) {
    const block = setupLines(match[2] ?? "");
    if (block.length !== call.length) continue;
    const same = block.every((line, i) => {
      const at = line.indexOf(PROMPT_PLACEHOLDER);
      if (at === -1) return line === call[i];
      const shape = new RegExp(`^${escapeRegExp(line.slice(0, at))}${PROMPT_PATH}${escapeRegExp(line.slice(at + PROMPT_PLACEHOLDER.length))}$`);
      const found2 = shape.exec(call[i] ?? "");
      const folder = found2?.[1];
      return folder !== void 0 && !(call[i] ?? "").includes("/../") && temp.some((root) => isSameOrAncestor(root, folder, false)) && !excluded.some((place) => isSameOrAncestor(place, folder, false)) && folderSafe(`${folder}/${found2?.[2] ?? ""}`);
    });
    if (same) return true;
  }
  return false;
}
function offloadFolderSafe(folder, temp) {
  const parent = import_node_path17.default.dirname(folder);
  if (!temp.includes(parent)) return false;
  try {
    const uid = process.getuid?.();
    const dir = import_node_fs11.default.lstatSync(folder);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== uid || (dir.mode & 511) !== 448) return false;
    if (import_node_fs11.default.realpathSync(folder) !== import_node_path17.default.join(import_node_fs11.default.realpathSync(parent), import_node_path17.default.basename(folder))) return false;
    const prompt = import_node_fs11.default.lstatSync(import_node_path17.default.join(folder, "prompt.md"), { throwIfNoEntry: false });
    return prompt === void 0 || prompt.isFile() && prompt.uid === uid && prompt.nlink === 1;
  } catch {
    return false;
  }
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function checkGateAgentUnreadable(agent, settings, reason) {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  return refusal2(`a review agent's command must be read in full by the gate, and part of this one can't be (${reason}); write it out without variables standing for programs or scripts`);
}
function checkGateAgentCommand(agent, settings, command) {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  const variable = riskyLoopVariable(command) ?? riskyExpansionVariable(command);
  return variable === null ? null : refusal2(`a review agent may not set \`${variable}\` (it changes what runs or where)`);
}
function checkGateAgentBash(part, agent, settings, scope, paths, caseInsensitive = false, call = {}) {
  const earlier = call.earlier ?? [];
  if (agent === void 0 || !isGateAgent(agent, settings.gateAgents)) return null;
  if ([part.program ?? "", ...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs].some((w) => w.length > MAX_WORD)) {
    return refusal2(`a review agent may not write to a path over ${MAX_WORD} characters; to keep long text, write it to a temp file with a heredoc (cat > /tmp/notes.md <<'EOF' \u2026 EOF)`);
  }
  if (programNotLiteral(part)) {
    return refusal2("a review agent may only run programs named in full, not from a variable, `$( \u2026 )` or a wildcard");
  }
  if (part.lostDir !== null) {
    return refusal2(`a review agent may not run a command in a folder only known when it runs (after \`${part.lostDir.why}\`)`);
  }
  const risky = riskyAssignment(part);
  if (risky !== null) return refusal2(`a review agent may not set \`${risky}\` (it changes what runs or where)`);
  if (setterNameNotLiteral(part, UNKNOWN)) return refusal2("a review agent may only set variables named in full, not from a variable or `$( \u2026 )`");
  const sandbox = isGateAgent(agent, settings.backgroundAgents ?? []) && runsOutsideRepos(part, scope, paths, caseInsensitive, earlier);
  const launch = call.background === true && !FOLDER_MOVES.has(part.program ?? "") ? "background" : launchOf(part);
  if (launch !== null && !(launch === "background" && sandbox)) {
    return refusal2("a review agent may not start work that outlives its run (a background job, nohup, tmux, ssh -f, a detached container, brew services, a nested claude session \u2026)");
  }
  if (runsReviewCheck(part, scope.home, paths)) return refusal2("a review agent may not run the review check itself");
  if (scope.darwin === true && unbuildableStack(part)) return refusal2("this stack's build and tests can't run in the review sandbox; review the code by reading it");
  if (scope.darwin === true && CONTAINER_TOOLS.has(part.name ?? "")) return refusal2("docker/kubectl can't run in the review sandbox; review the files (Dockerfile, compose, manifests) instead");
  if (scope.sandboxed === true && part.name === "gh") return refusal2("gh can't read its login inside the review sandbox; ask the main agent for what you need from GitHub");
  const variable = part.git === null ? null : gitVariable(part, earlier);
  if (variable !== null) {
    return refusal2(`a review agent may not run git with \`${variable}\` set in the same call; run git without GIT_* variables`);
  }
  if (part.git !== null && gitCreates(part.git, scope.home).some((p) => !inTemp2(p, scope, paths, caseInsensitive))) {
    return refusal2("a review agent may make a git repo only in the temp folders (/tmp or the session temp folder, written out in full)");
  }
  const git = checkGit(part, scope, paths, caseInsensitive);
  if (git !== null) return git;
  if (gitByOtherName(part) && runsInRepo(part, [], scope, paths, caseInsensitive)) {
    return refusal2(`a review agent may only run read-only git commands in the repo it reviews, not \`${part.name ?? ""}\``);
  }
  if (part.name === "gh" && !readOnlyGh(part.words.slice(1))) {
    return refusal2("a review agent may only run read-only gh commands (pr view/list/diff/checks/status, issue view/list, run view/list, api GET)");
  }
  if (changesDependencies(part, scope, paths, caseInsensitive)) {
    return refusal2("a review agent may not change the reviewed repo's installed dependencies");
  }
  if (part.name === "ln" && lnOperands(part, scope.home).some((p) => !inTemp2(p, scope, paths, caseInsensitive))) {
    return refusal2("a review agent may link only files in the temp folders (/tmp or the session temp folder, written out in full); a link elsewhere would let a write change what it points at");
  }
  const offload = checkOffload(part, agent);
  if (offload !== null) return offload;
  if (tarEscapes(part)) return refusal2("a review agent may not unpack with absolute names or renamed paths (tar -P, --insecure, -s, --transform), which writes wherever the archive says");
  const mkdirs = part.name === "mkdir" ? part.words.slice(1).filter((w) => !w.startsWith("-")).map((w) => absolute(w, part.cwd, scope.home)) : [];
  const writes = [...part.writeTargets, ...part.writeGlobs, ...part.recursiveTargets, ...part.recursiveGlobs, ...mkdirs, ...extractTargets(part, scope.home)];
  if (writes.length > 0 && uncertainFolderMove(earlier)) {
    return refusal2("a review agent may not write after a `cd`, `pushd` or `popd` that may fail (the folder it writes in is then not known); join them with `&&`, or write the path out in full");
  }
  const copied = writes.find((target) => copiedFolders(earlier, scope.home).some((dest) => isSameOrAncestor(dest, target, caseInsensitive) && dest !== target));
  if (copied !== void 0) {
    return refusal2(`a review agent may not write under a folder copied earlier in the same call (\`${copied}\`): a copied link there could lead anywhere`);
  }
  for (const target of writes) {
    if (target.includes(UNKNOWN)) {
      return refusal2("a review agent may not write a path only known when the command runs; write the path out in full");
    }
    if (!inTemp2(target, scope, paths, caseInsensitive)) {
      return refusal2(`a review agent may write only in the temp folders (/tmp or the session temp folder, written out in full), not \`${target}\``);
    }
  }
  const output = [...outputValues(part, scope.home), ...variablePaths(part, scope.home)].find((p) => !inTemp2(p, scope, paths, caseInsensitive));
  if (output !== void 0) {
    return refusal2(`a review agent may point output, cache and report paths only at the temp folders (/tmp or the session temp folder, written out in full), not \`${output.includes(UNKNOWN) ? "a path only known when it runs" : output}\``);
  }
  if (sandbox) return null;
  if (namesUserFiles(part, scope, paths, caseInsensitive)) {
    return refusal2("a review agent may not point a program at the user's own files (~/.oss, ~/.claude, ~/.config, ~/.ssh, shell start-up files \u2026), except to read them");
  }
  const depth = call.depth ?? 0;
  const inner = { agent, settings, scope, paths, caseInsensitive, earlier: [...earlier, part], depth: depth + 1 };
  for (const words of findExecs(part)) {
    const refused3 = checkInnerCommand(words.map((w) => w === "{}" ? '"$OSS_FIND_PATH"' : shellWord(w)).join(" "), part, "find -exec", inner);
    if (refused3 !== null) return refused3;
  }
  if (/^python[0-9.]*$/.test(part.name ?? "") && part.words[1] === "-m" && !staysInRepo(part, scope, paths, caseInsensitive)) {
    return refusal2("a review agent may run `python -m` only from the repo it reviews, with every path it names inside that repo");
  }
  const runner2 = runnerOf(part, settings, scope);
  if (runner2 === null) return checkAllowlist(part, agent, settings, scope, paths, caseInsensitive);
  if ("refused" in runner2) {
    return refusal2(
      `\`${runner2.refused}\` is not on the review allowlist; a runner may run only the checks the gate knows, and a JS tool only from the repo's own node_modules/.bin or with \`npx --no-install\``
    );
  }
  if (runner2.words.length === 0) return null;
  if (runner2.words.some((w) => w.includes(UNKNOWN))) return refusal2("a review agent may only run programs named in full behind a runner");
  return checkInnerCommand(runner2.words.map(shellWord).join(" "), part, "a runner", inner);
}
function uncertainFolderMove(earlier) {
  return earlier.some((part, i) => FOLDER_MOVES.has(part.program ?? "") && !earlier.slice(i).every((p) => p.followedByAnd));
}
var CP_KEEPS_LINKS = /^-[A-Za-z]*[aPRrH]/;
var CP_KEEPS_LINKS_LONG = /* @__PURE__ */ new Set(["--archive", "--recursive", "--no-dereference"]);
function copiedFolders(earlier, home) {
  return earlier.flatMap((part) => {
    if (part.name !== "cp") return [];
    const args = part.words.slice(1);
    if (!args.some((w) => !w.startsWith("--") && CP_KEEPS_LINKS.test(w) || CP_KEEPS_LINKS_LONG.has(optionName(w)))) return [];
    const operands2 = args.filter((w) => !w.startsWith("-"));
    const dest = operands2.at(-1);
    return operands2.length >= 2 && dest !== void 0 ? [absolute(dest, part.cwd, home)] : [];
  });
}
var MAX_INNER_DEPTH = 4;
function checkInnerCommand(text, part, by, check) {
  if (check.depth > MAX_INNER_DEPTH) return refusal2(`a review agent may not nest runners more than ${MAX_INNER_DEPTH} deep`);
  const inner = readCommand(text, part.cwd, check.scope.home, false, void 0, void 0, void 0, false);
  const [innerPart] = inner.parts;
  if ("unreadable" in inner || inner.parts.length !== 1 || innerPart === void 0) return refusal2(`a review agent's ${by} must run one program the gate can read`);
  if (BEHIND_RUNNER_REFUSED.has(innerPart.name ?? "") || innerPart.wrappers.length > 0) {
    return refusal2(`a review agent may not run \`${[...innerPart.wrappers, innerPart.name ?? ""].join(" ")}\` through ${by}`);
  }
  return checkGateAgentBash(innerPart, check.agent, check.settings, check.scope, check.paths, check.caseInsensitive, { earlier: check.earlier, depth: check.depth });
}
var BEHIND_RUNNER_REFUSED = /* @__PURE__ */ new Set(["mkdir", "rm", "rmdir", "cp", "mv", "touch", "tee", "ln", "cd", "pushd", "popd", "unset", "set", "export", "git", "gh"]);
var OUTPUT_OPTIONS = [
  "--output",
  "--output-file",
  "--output-dir",
  "--outdir",
  "--outfile",
  "--out-file",
  "--out-dir",
  "--report-path",
  "--log-file",
  "--cache-dir",
  "--cache-location",
  "--basetemp",
  "--junitxml",
  "--junit-xml"
];
var OWN_OUTPUT_FORMS = /* @__PURE__ */ new Set(["find", "git", "gh", "curl"]);
var SHORT_O_NOT_FILE = /* @__PURE__ */ new Set(["grep", "egrep", "fgrep", "rg", "ls", "od"]);
function outputNamed(name) {
  if (!name.startsWith("--") || name === "--reporter" || name.endsWith("-reporter") || /config|manifest|root|project/.test(name)) return false;
  return /output|report|profile[-_]|-path$/.test(name);
}
var TOOL_OUTPUT_OPTIONS = [
  ...["-coverprofile", "-cpuprofile", "-memprofile", "-blockprofile", "-mutexprofile", "-trace", "-outputdir"].flatMap((o) => [`go ${o}`, `go -${o}`]),
  "jest --coverageDirectory",
  "jest --coverage-directory",
  "jest --outputFile",
  "pytest --html",
  "cargo --target-dir",
  "node --test-reporter-destination",
  "node --cpu-prof-dir",
  "node --diagnostic-dir",
  "node --heap-prof-dir"
];
function toolOutputValues(part) {
  const prefix = `${part.name ?? ""} `;
  const options = TOOL_OUTPUT_OPTIONS.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length));
  return options.length === 0 ? [] : optionValues(part.words.slice(1), options).filter((v) => v !== "stdout" && v !== "stderr");
}
var TOO_LONG2 = "\0LONG\0";
function pathLike(value) {
  return /^[~/.]/.test(value) || value.includes("/");
}
function outputValues(part, home) {
  if (OWN_OUTPUT_FORMS.has(part.name ?? "")) return [];
  const args = part.words.slice(1);
  const values = [];
  args.forEach((word, i) => {
    tick();
    const name = optionName(word);
    const known = name.startsWith("--") && (OUTPUT_OPTIONS.includes(name) || name.length >= 3 && "--output".startsWith(name));
    const named2 = !known && outputNamed(name);
    const long = known || named2;
    const short = !word.startsWith("--") && /^-o/.test(word) && !SHORT_O_NOT_FILE.has(part.name ?? "");
    if (!long && !short) return;
    const value = word.includes("=") && long ? word.slice(word.indexOf("=") + 1) : short && word.length > 2 ? word.slice(2) : args[i + 1];
    if (value === void 0) return;
    if (name === "--test-reporter-destination" && (value === "stdout" || value === "stderr")) return;
    if (named2 && /format/.test(name)) {
      if (value.includes(":")) values.push({ value: value.slice(value.indexOf(":") + 1), file: true });
    } else {
      values.push({ value, file: named2 });
    }
  });
  values.push(...toolOutputValues(part).map((value) => ({ value, file: true })));
  return values.flatMap(({ value, file }) => {
    if (value.includes(UNKNOWN) || value.length > MAX_WORD) return [UNKNOWN];
    const pieces = value.includes("=") ? value.split("=").slice(1) : [value];
    return pieces.filter((piece) => file && piece !== "" && !piece.startsWith("-") || pathLike(piece)).map((piece) => absolute(piece, part.cwd, home));
  });
}
var PATH_VARIABLE = /(?:_DIR|_CACHE|_ROOT|_TMP|_TEMP|_OUT|_FILE|^TMPDIR|^GOCACHE|^GOMODCACHE|^GOPATH|^PYLINTHOME|^NODE_V8_COVERAGE)$/;
function variablePaths(part, home) {
  const pairs = part.assignments.map((name, i) => [name, part.assignmentValues[i] ?? UNKNOWN]);
  if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
    for (const word of part.words.slice(1)) {
      const at = word.indexOf("=");
      if (at > 0) pairs.push([word.slice(0, at), word.slice(at + 1)]);
    }
  }
  return pairs.filter(([name]) => PATH_VARIABLE.test(name)).flatMap(([name, value]) => value.includes(UNKNOWN) ? [UNKNOWN] : value.split(":").filter((v) => v !== "" && (name === "NODE_V8_COVERAGE" || pathLike(v))).map((v) => absolute(v, part.cwd, home)));
}
function extractTargets(part, home) {
  const args = part.words.slice(1);
  if (part.name === "unzip") {
    if (args.some((w) => /^-[A-Za-z]*[lvtcpzZ]/.test(w))) return [];
    return [optionValues(args, ["-d"])[0] ?? "."].map((d) => absolute(d, part.cwd, home));
  }
  if (part.name !== "tar" && part.name !== "bsdtar" && part.name !== "gtar") return [];
  const extracting = args.some((w, i) => !w.startsWith("--") && (w.startsWith("-") || i === 0) && /^-?[A-Za-z]*x/.test(w)) || args.some((w) => longOptionMatch(w, "--extract", 1) || longOptionMatch(w, "--get", 1));
  if (!extracting) return [];
  const dirs = [...optionValues(args, ["-C", "--directory", "--cd"]), ...args.filter((w) => w.startsWith("--directory=")).map((w) => w.slice("--directory=".length))];
  return (dirs.length > 0 ? dirs : ["."]).map((d) => absolute(d, part.cwd, home));
}
var TAR_KEEPS_NAMES = ["--absolute-names", "--absolute-paths", "--insecure"];
var TAR_RENAMES = ["--transform", "--xform"];
function tarEscapes(part) {
  if (part.name !== "tar" && part.name !== "bsdtar" && part.name !== "gtar") return false;
  const args = part.words.slice(1);
  const short = (letter) => args.some((w, i) => !w.startsWith("--") && (w.startsWith("-") || i === 0) && new RegExp(`^-?[A-Za-z]*${letter}`).test(w));
  if (args.some((w) => TAR_KEEPS_NAMES.some((o) => longOptionMatch(w, o))) || short("P")) return true;
  const extracting = short("x") || args.some((w) => longOptionMatch(w, "--extract") || longOptionMatch(w, "--get"));
  return extracting && (short("s") || args.some((w) => TAR_RENAMES.some((o) => longOptionMatch(w, o))));
}
var BY_WORD_COUNT = /* @__PURE__ */ new Set(["uniq", "xxd"]);
var REPO_CODE_PROGRAMS = /* @__PURE__ */ new Set(["make", "cargo", "go", "npm", "pnpm", "yarn", "bun", "mvn", "mvnw", "gradle", "gradlew"]);
var REPO_CODE_NAMES = /^(?:tox|dotnet|flutter|dart|deno|mix|composer|rails|turbo|eslint|prettier|pylint|rubocop|playwright|xcodebuild)$/;
var REPO_PATH_OPTIONS = [
  "-f",
  "--file",
  "-c",
  "--config",
  "-C",
  "-p",
  "-b",
  "--manifest-path",
  "--prefix",
  "--rootdir",
  "-s",
  "--dir",
  "--cwd",
  "--directory",
  "--load-plugins",
  "-r",
  "--require",
  "--plugin"
];
function runsRepoCode(part, settings) {
  const name = part.name ?? "";
  return REPO_CODE_PROGRAMS.has(name) || REPO_CODE_NAMES.test(name) || (settings.reviewNpxPackages ?? []).includes(name) || settings.testCommandPatterns.some((p) => matchCommand(p, part.words));
}
var MAX_EQUALS = 8;
function pathCandidates(part, shortOptions) {
  const out = [];
  for (const word of part.words.slice(1)) {
    tick();
    if (word.length > MAX_WORD) return [TOO_LONG2];
    const values = [];
    for (let at = word.indexOf("="); at !== -1; at = word.indexOf("=", at + 1)) {
      if (values.length === MAX_EQUALS) return [TOO_LONG2];
      values.push(word.slice(at + 1));
    }
    if (!word.startsWith("-")) out.push(word, ...values);
    else if (values.length > 0) out.push(...values);
    else {
      const attached = shortOptions.find((o) => o.length === 2 && word.startsWith(o) && word.length > 2);
      if (attached !== void 0) out.push(word.slice(2));
    }
  }
  return out;
}
function runsGivenCode(part) {
  const args = part.words.slice(1);
  if (part.name === "make") return args.some((w) => longOptionMatch(w, "--eval") || /^-[A-Za-z]*E/.test(w));
  if (part.name === "npm" || part.name === "pnpm" || part.name === "yarn") return args.some((w) => longOptionMatch(w, "--node-options"));
  return false;
}
function staysInRepo(part, scope, paths, caseInsensitive) {
  if (part.cwd.includes(UNKNOWN) || !insideRepo(part.cwd, scope.repos, paths, caseInsensitive)) return false;
  if (runsGivenCode(part)) return false;
  const args = part.words.slice(1);
  const outputs = new Set(toolOutputValues(part));
  const named2 = part.name === "xcodebuild" ? optionValues(args, ["-project", "-workspace"]) : [...pathCandidates(part, REPO_PATH_OPTIONS), ...optionValues(args, REPO_PATH_OPTIONS)];
  const words = named2.filter((w) => !outputs.has(w));
  return words.every((w) => w !== TOO_LONG2 && !w.includes(UNKNOWN) && insideRepo(absolute(w, part.cwd, scope.home), scope.repos, paths, caseInsensitive));
}
var PURE_READERS = /* @__PURE__ */ new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "ls",
  "tree",
  "find",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "wc",
  "sort",
  "uniq",
  "cut",
  "tr",
  "diff",
  "cmp",
  "comm",
  "stat",
  "file",
  "du",
  "df",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "pwd",
  "which",
  "type",
  "echo",
  "printf",
  "true",
  "false",
  "test",
  "[",
  "jq",
  "yq",
  "xxd",
  "od",
  "hexdump",
  "shasum",
  "sha256sum",
  "md5",
  "md5sum",
  "column",
  "nl",
  "fold",
  "expand",
  "sed",
  "sleep",
  "cd",
  "pushd",
  "popd",
  "printenv",
  "git",
  "gh"
]);
var MAX_CANDIDATES = 4096;
function namesUserFiles(part, scope, paths, caseInsensitive) {
  if (part.name === null || PURE_READERS.has(part.name)) return false;
  const roots = rootsOf(userLevel(scope), paths);
  const candidates = [...new Set(pathCandidates(part, ["-o", "-C", "-c", "-f", "-p"]))];
  if (candidates.length > MAX_CANDIDATES) return true;
  return candidates.some((word) => {
    tick();
    if (word === TOO_LONG2) return true;
    if (word.includes(UNKNOWN)) return false;
    const p = absolute(word, part.cwd, scope.home);
    return [import_node_path17.default.normalize(p), paths.realpath(p)].some((form) => roots.some((r) => isSameOrAncestor(r, form, caseInsensitive)));
  });
}

// src/tool-gate/rules/review-read.ts
var import_node_fs12 = __toESM(require("node:fs"), 1);
var import_node_path19 = __toESM(require("node:path"), 1);

// src/tool-gate/credential-places.ts
var import_node_path18 = __toESM(require("node:path"), 1);
var CREDENTIAL_PLACES = [
  { rel: ".ssh", kind: "folder" },
  { rel: ".config/gh", kind: "folder" },
  { rel: ".aws", kind: "folder" },
  { rel: ".codex", kind: "folder" },
  { rel: ".kube", kind: "folder" },
  { rel: ".gnupg", kind: "folder" },
  { rel: "Library/Keychains", kind: "folder" },
  { rel: ".config/stripe", kind: "folder" },
  { rel: ".config/gcloud", kind: "folder" },
  { rel: ".docker/config.json", kind: "file" },
  { rel: ".netrc", kind: "file" },
  { rel: ".git-credentials", kind: "file" },
  { rel: ".npmrc", kind: "file" },
  { rel: ".claude.json", kind: "prefix" },
  { rel: ".oss/config.json", kind: "prefix" },
  { rel: ".oss/credentials", kind: "prefix" },
  { rel: ".claude/.credentials", kind: "prefix" },
  // inside toolchain folders the sandbox lets a review agent read
  { rel: ".cargo/credentials", kind: "prefix" },
  { rel: ".config/git/credentials", kind: "file" },
  // round 11, CR LOW-B: the new toolchain folders' tokens (pub, Composer, Hackage upload password)
  { rel: ".pub-cache/credentials.json", kind: "prefix" },
  { rel: ".composer/auth.json", kind: "prefix" },
  { rel: ".cabal/config", kind: "prefix" }
];
function credentialPaths(homes) {
  return homes.flatMap((home) => CREDENTIAL_PLACES.map((place) => ({ path: import_node_path18.default.join(home, place.rel), kind: place.kind })));
}

// src/tool-gate/rules/review-read.ts
var READ_TOOLS = /* @__PURE__ */ new Set(["Read", "Grep", "Glob"]);
var WILDCARD2 = /[*?[{]/;
var MAX_CHARS = 4096;
var MAX_SEGMENTS = 512;
var SAVED_OUTPUT = "page the output with `| sed -n 'START,ENDp'` or write it to $TMPDIR and Read it there";
function escapeRegex2(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function refused2(what) {
  return {
    rule: "gate-agent-write",
    reason: `Refused by gate-agent-write: ${what}. A review agent may read the repo it reviews, the toolchain folders and system or temp paths, never other files under the home folder, the user's credential stores or Claude Code's session transcripts; report what you need to the main agent.`
  };
}
function expand2(p, home, cwd) {
  if (p === "~" || p.startsWith("~/")) return import_node_path19.default.join(home, p.slice(1));
  return import_node_path19.default.resolve(cwd, p);
}
function forms(p, caseInsensitive) {
  let at = p;
  const rest = [];
  let real = null;
  for (; ; ) {
    tick();
    try {
      real = import_node_path19.default.join(import_node_fs12.default.realpathSync(at), ...rest.reverse());
      break;
    } catch {
      if (import_node_path19.default.dirname(at) === at) break;
      rest.push(import_node_path19.default.basename(at));
      at = import_node_path19.default.dirname(at);
    }
  }
  return [...new Set([p, ...real === null ? [] : [real]].map((form) => withoutFirmlink(form, caseInsensitive)))];
}
function fixedPart2(glob) {
  const segments = glob.split("/");
  const first = segments.findIndex((segment) => WILDCARD2.test(segment));
  return first === -1 ? glob : segments.slice(0, first).join("/") || "/";
}
function tooLong(p) {
  return p.length > MAX_CHARS || p.split("/").length > MAX_SEGMENTS;
}
function checkReviewRead(toolName, toolInput, cwd, scope, caseInsensitive) {
  if (!READ_TOOLS.has(toolName) || typeof toolInput !== "object" || toolInput === null) return null;
  const input = toolInput;
  const text = (key2) => typeof input[key2] === "string" && input[key2] !== "" ? input[key2] : void 0;
  const raw = toolName === "Read" ? [text("file_path")] : [text("path"), text("pattern")];
  for (const word of raw) {
    if (word === void 0) continue;
    if (tooLong(word)) return refused2(`a path or pattern over ${MAX_CHARS} characters or ${MAX_SEGMENTS} segments can't be checked`);
    if (/^~[^/]/.test(word)) return refused2(`\`~user\` paths are not allowed`);
  }
  if (scope.problem !== void 0 && scope.problem !== null) return refused2(scope.problem);
  const homes = withReal(scope.homes).map((h) => withoutFirmlink(h, caseInsensitive));
  const home = scope.homes[0] ?? "/";
  const readable = readableUnderHome({ ...scope, privateDir: scope.privateDir }).flatMap((place) => forms(place.at, caseInsensitive).map((at) => ({ at, kind: place.kind })));
  const credentials = credentialPaths(homes);
  const transcripts = transcriptRoots([scope.tmpdir]);
  const fold = (p) => caseInsensitive ? p.toLowerCase() : p;
  const vol = (p) => within("/.vol", p, caseInsensitive);
  const inCredential = (p) => credentials.some((place) => place.kind === "folder" ? within(place.path, p, caseInsensitive) : place.kind === "file" ? fold(p) === fold(place.path) : fold(p).startsWith(fold(place.path)));
  const own0 = scope.privateDir ?? null;
  const agents = own0 === null ? null : reviewFoldersRoot(own0);
  const othersFolder = (p) => agents !== null && own0 !== null && within(agents, p, caseInsensitive) && !within(own0, p, caseInsensitive);
  const hidden = (scope.hidden ?? []).flatMap((h) => forms(h, caseInsensitive));
  const inHidden = (p) => hidden.some((h) => within(h, p, caseInsensitive));
  const denied = (p) => vol(p) || inTranscripts(p, transcripts, caseInsensitive) || inCredential(p) || othersFolder(p) || inHidden(p);
  const allowedOnDisk = (p) => !homes.some((h) => within(h, p, caseInsensitive)) || readable.some((place) => place.kind === "file" ? fold(place.at) === fold(p) : within(place.at, p, caseInsensitive));
  const own = own0;
  const readableForms = (all) => !all.some(denied) && (own === null || !all.some((p) => linkInto(p, own, caseInsensitive))) && allowedOnDisk(all[all.length - 1] ?? "/");
  const repoForms = scope.repos.flatMap((r) => forms(r, caseInsensitive));
  const inReviewedRepo = (dir) => !inTranscripts(dir, transcripts, caseInsensitive) && repoForms.some((r) => within(r, dir, caseInsensitive));
  const searchable = (all) => !all.some((dir) => homes.some((h) => within(dir, h, caseInsensitive)) || reachesTranscripts(dir, transcripts, caseInsensitive) && !inReviewedRepo(dir) || agents !== null && within(dir, agents, caseInsensitive) || hidden.some((h) => within(dir, h, caseInsensitive))) && readableForms(all);
  if (toolName === "Read") {
    const file = text("file_path");
    if (file === void 0) return null;
    const all = forms(expand2(file, home, cwd), caseInsensitive);
    if (readableForms(all)) return null;
    const saved = all.some((p) => homes.some((h) => new RegExp(`^${escapeRegex2(import_node_path19.default.join(h, ".claude", "projects"))}/[^/]+/[^/]+/tool-results/`, caseInsensitive ? "i" : "").test(p)) || inTranscripts(p, transcripts, caseInsensitive));
    return refused2(`\`${file}\` is outside what a review agent may read${saved ? `; it is a saved tool output: ${SAVED_OUTPUT}` : ""}`);
  }
  const given = text("path") ?? cwd;
  const base = expand2(given, home, cwd);
  const firmlinkRoot = (p) => within(p, FIRMLINK_ROOT, caseInsensitive);
  const ownSearch = (root) => {
    const onDisk = forms(root, caseInsensitive).at(-1) ?? root;
    if (own === null || !within(own, onDisk, caseInsensitive)) return null;
    const found2 = linkUnder(onDisk);
    if (found2 === "none") return null;
    return refused2(found2 === "link" ? `a search of \`${given}\` would follow a link in your private folder` : `a search of \`${given}\` covers too many entries in your private folder to check`);
  };
  if (toolName === "Grep") {
    return !firmlinkRoot(base) && searchable(forms(base, caseInsensitive)) ? ownSearch(base) : refused2(`a search of \`${given}\` reaches beyond what a review agent may read`);
  }
  const pattern = text("pattern");
  if (pattern === void 0) return null;
  const glob = pattern.startsWith("~") ? expand2(pattern, home, cwd) : import_node_path19.default.isAbsolute(pattern) ? pattern : `${base}/${pattern}`;
  if (tooLong(glob)) return refused2(`a path or pattern over ${MAX_CHARS} characters or ${MAX_SEGMENTS} segments can't be checked`);
  const fixed = import_node_path19.default.normalize(fixedPart2(glob));
  const climbs = glob.slice(fixedPart2(glob).length).split("/").includes("..");
  return !climbs && !firmlinkRoot(fixed) && searchable(forms(fixed, caseInsensitive)) ? ownSearch(fixed) : refused2(`the pattern \`${pattern}\` reaches beyond what a review agent may read`);
}

// src/tool-gate/rules/focused-tests.ts
var import_node_path20 = __toESM(require("node:path"), 1);
var MARKER = /\.(skip|only|todo)(If)?(?:\.concurrent)?(?:\.each)?\s*[(`]/g;
var PREFIXED_CALL = /(?<![\w$.])(xit|fit|xdescribe|fdescribe|xtest)\s*\(/g;
function countMarkers(text) {
  const counts = /* @__PURE__ */ new Map();
  const add = (name) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  for (const match of text.matchAll(MARKER)) add(`.${match[1]}${match[2] ?? ""}`);
  for (const match of text.matchAll(PREFIXED_CALL)) add(match[1]);
  return counts;
}
function addedMarker(before, after) {
  const old = countMarkers(before);
  for (const [name, count] of countMarkers(after)) {
    if (count > (old.get(name) ?? 0)) return name;
  }
  return void 0;
}
function displayPath2(filePath, root) {
  const relative = import_node_path20.default.relative(root, filePath);
  return relative === ".." || relative.startsWith(`..${import_node_path20.default.sep}`) || import_node_path20.default.isAbsolute(relative) ? filePath : relative;
}
function checkFocusedTests(call, settings, root, home, caseInsensitive = false) {
  if (!matchAnyPath(settings.testFilePatterns, call.filePath, { home, root, caseInsensitive })) return null;
  for (const { before, after } of call.changes) {
    const marker = addedMarker(before, after);
    if (marker !== void 0) {
      return {
        rule: "focused-tests",
        reason: `Refused: adds \`${marker}(\` to the test file \`${displayPath2(call.filePath, root)}\`. IRON LAW #1: never skip or focus tests. Fix or delete the test instead.`
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
var SHORT_FORCE = /^-(?=[A-Za-z]*f)[A-Za-z]+$/;
function isForce(option) {
  return option === "--force" || option.startsWith("--force-") || SHORT_FORCE.test(option);
}
function checkForcePush(part, _settings) {
  if (part.git?.subcommand !== "push") return null;
  const { options, positional } = readPushWords(part.git.args);
  const found2 = options.find(isForce) ?? positional.find((word) => word.startsWith("+"));
  if (found2 === void 0) return null;
  return {
    rule: "force-push",
    reason: `Refused: \`git push ${found2}\` rewrites history. Push without force; if the branch diverged, ask the user.`
  };
}

// src/tool-gate/rules/git-clean.ts
var import_node_fs13 = __toESM(require("node:fs"), 1);
var import_node_path21 = __toESM(require("node:path"), 1);
var CHOOSING_LETTERS = /* @__PURE__ */ new Set(["d", "x", "X"]);
var OTHER_LETTERS = /* @__PURE__ */ new Set(["i", "q"]);
var FORCE_LONG = { full: "--force", shortest: 3 };
var NO_FORCE_LONG = { full: "--no-force", shortest: 6 };
var DRY_RUN_LONG = { full: "--dry-run", shortest: 3 };
var NO_DRY_RUN_LONG = { full: "--no-dry-run", shortest: 6 };
var EXCLUDE_LONG = { full: "--exclude", shortest: 3 };
var OTHER_LONG = [
  { full: "--interactive", shortest: 3 },
  { full: "--quiet", shortest: 3 },
  { full: "--no-interactive", shortest: 6 },
  { full: "--no-quiet", shortest: 6 }
];
function isLong(word, option) {
  return longOption(word, option.full, option.shortest);
}
function readCleanWords(args) {
  const options = [];
  const pathspecs = [];
  let dryRun2 = false;
  let force = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      pathspecs.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith("-") || a === "-") {
      pathspecs.push(a);
    } else if (a.startsWith("--")) {
      if (isLong(a, DRY_RUN_LONG) || isLong(a, NO_DRY_RUN_LONG)) dryRun2 = isLong(a, DRY_RUN_LONG);
      else if (isLong(a, FORCE_LONG)) force++;
      else if (isLong(a, NO_FORCE_LONG)) force = 0;
      else if (isLong(a, EXCLUDE_LONG) && a.includes("=")) options.push(a);
      else if (isLong(a, EXCLUDE_LONG)) {
        if (i + 1 >= args.length) return "unknown";
        options.push("-e", args[++i]);
      } else if (!OTHER_LONG.some((o) => isLong(a, o))) return "unknown";
    } else {
      for (let j = 1; j < a.length; j++) {
        const letter = a[j];
        if (letter === "n") {
          dryRun2 = true;
        } else if (letter === "f") {
          force++;
        } else if (letter === "e") {
          const value = j + 1 < a.length ? a.slice(j + 1) : args[++i];
          if (value === void 0) return "unknown";
          options.push("-e", value);
          break;
        } else if (CHOOSING_LETTERS.has(letter)) {
          options.push(`-${letter}`);
        } else if (!OTHER_LETTERS.has(letter)) {
          return "unknown";
        }
      }
    }
  }
  if (dryRun2) return "dry-run";
  return { options: force >= 2 ? ["-f", "-f", ...options] : options, pathspecs, nested: force >= 2 };
}
var LEAVES_INDEX = /* @__PURE__ */ new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "cat-file",
  "describe",
  "fetch",
  "grep",
  "shortlog",
  "rev-list",
  "for-each-ref",
  "show-ref",
  "version",
  "help"
]);
var IGNORE_FILES = /* @__PURE__ */ new Set([".gitignore", "exclude", "index"]);
function staleningPart(earlier, count) {
  for (let i = 0; i < count; i++) {
    const part = earlier[i];
    if (part.git !== null && !LEAVES_INDEX.has(part.git.subcommand)) return part;
    if (part.writeTargets.some((t) => IGNORE_FILES.has(import_node_path21.default.posix.basename(t)) || t.includes("/.git/"))) return part;
    if (part.writeGlobs.some((g) => g.includes("gitignore") || g.includes("/.git/"))) return part;
  }
  return null;
}
function onDiskFolder(p) {
  try {
    return import_node_fs13.default.lstatSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
function holdsRepo(dir) {
  try {
    return import_node_fs13.default.lstatSync(import_node_path21.default.join(dir, ".git"), { throwIfNoEntry: false }) !== void 0;
  } catch {
    return false;
  }
}
var PATHSPEC_WILDCARD = /[*?[\\]/;
function reachOf(pathspec, dir, root, home) {
  if (pathspec.includes(UNKNOWN) || pathspec.startsWith(":")) return root;
  const segments = pathspec.split("/");
  const wild = segments.findIndex((s) => PATHSPEC_WILDCARD.test(s));
  const fixed = wild === -1 ? pathspec : segments.slice(0, wild).join("/");
  return joinRaw(dir, expandTilde2(fixed, home));
}
function carriesSetup(part, git) {
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  const other = globals.filter((w, n) => w !== "-C" && globals[n - 1] !== "-C");
  return other.length > 0 || part.assignments.some((name) => name.startsWith("GIT_"));
}
var STASH_LETTERS = /* @__PURE__ */ new Set(["p", "S", "k", "q"]);
var STASH_ALL_LONG = { full: "--all", shortest: 3 };
var STASH_NO_ALL_LONG = { full: "--no-all", shortest: 6 };
var STASH_UNTRACKED_LONG = { full: "--include-untracked", shortest: 3 };
var STASH_NO_UNTRACKED_LONG = { full: "--no-include-untracked", shortest: 6 };
var STASH_MESSAGE_LONG = { full: "--message", shortest: 3 };
var STASH_FROM_FILE_LONG = { full: "--pathspec-from-file", shortest: 13 };
var STASH_OTHER_LONG = [
  { full: "--patch", shortest: 6 },
  { full: "--staged", shortest: 3 },
  { full: "--keep-index", shortest: 3 },
  { full: "--no-keep-index", shortest: 6 },
  { full: "--quiet", shortest: 3 },
  { full: "--pathspec-file-nul", shortest: 13 }
];
function readStashWords(args) {
  const sub = args[0];
  const save = sub === "save";
  if (sub !== void 0 && sub !== "push" && !save && !sub.startsWith("-")) return null;
  const rest = sub === "push" || save ? args.slice(1) : args;
  const pathspecs = [];
  let untracked = 0;
  let fromFile = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--") {
      pathspecs.push(...rest.slice(i + 1));
      break;
    }
    if (!a.startsWith("-") || a === "-") pathspecs.push(a);
    else if (a.startsWith("--")) {
      if (isLong(a, STASH_ALL_LONG)) untracked = 2;
      else if (isLong(a, STASH_UNTRACKED_LONG)) untracked = 1;
      else if (isLong(a, STASH_NO_ALL_LONG) || isLong(a, STASH_NO_UNTRACKED_LONG)) untracked = 0;
      else if (isLong(a, STASH_MESSAGE_LONG) || isLong(a, STASH_FROM_FILE_LONG)) {
        fromFile ||= isLong(a, STASH_FROM_FILE_LONG);
        if (!a.includes("=")) i++;
      } else if (!STASH_OTHER_LONG.some((o) => isLong(a, o))) return "unknown";
    } else {
      for (let j = 1; j < a.length; j++) {
        const letter = a[j];
        if (letter === "a") untracked = 2;
        else if (letter === "u") untracked = 1;
        else if (letter === "m") {
          if (j + 1 === a.length) i++;
          break;
        } else if (!STASH_LETTERS.has(letter)) return "unknown";
      }
    }
  }
  return { untracked, pathspecs: save ? [] : pathspecs, fromFile };
}
var STASH_UNTRACKED_AS_CLEAN = ["-d"];
function inRepoPathspecs(settings) {
  return settings.protectedPaths.filter((p) => !p.startsWith("~") && !p.startsWith("*") && !p.startsWith("/")).map((p) => `:/${p.replace(/\/\*\*$/, "")}`);
}
async function checkGitStash(part, settings, root, home, paths, gitReader, places, context = {}) {
  const git = part.git;
  if (git === null || git.subcommand !== "stash") return null;
  const words = readStashWords(git.args);
  if (words === null || words !== "unknown" && words.untracked === 0) return null;
  if (words !== "unknown" && words.untracked === 2) {
    return {
      rule: "protected-path",
      reason: "Refused: `git stash -a` / `--all` also takes ignored files out of the worktree, protected OSS files among them. Stash without it, or ask the user to run it with `!`."
    };
  }
  const cantTell = {
    rule: "protected-path",
    reason: "Refused: the gate can't check what this `git stash -u` would take out of the worktree, so it may sweep protected OSS files away. Run a plain `git stash -u` without extra settings, or ask the user to run it with `!`."
  };
  const stale = staleningPart(context.earlier ?? [], context.count ?? 0) !== null;
  if (words === "unknown" || words.fromFile || stale || part.lostDir !== null || words.pathspecs.some((w) => w.includes(UNKNOWN)) || carriesSetup(part, git)) {
    return cantTell;
  }
  const specs = words.pathspecs.length > 0 ? words.pathspecs : inRepoPathspecs(settings);
  const removed = await gitReader.wouldClean(git.dir, [...STASH_UNTRACKED_AS_CLEAN], specs);
  if (removed === null) return cantTell;
  const hit = removed.map((p) => joinRaw(git.dir, p)).find((p) => isProtected(p, settings, places, paths) || holdsProtected(p, settings, places, paths));
  if (hit === void 0) return null;
  return {
    rule: "protected-path",
    reason: `Refused: \`git stash -u\` would take \`${displayPath(hit, root, home)}\`, a protected path or a folder holding one, out of the worktree. Ask the user to run it with \`!\`.`
  };
}
function expandTilde2(p, home) {
  if (p === "~") return home;
  return p.startsWith("~/") ? home + p.slice(1) : p;
}
async function checkGitClean(part, settings, root, home, paths, gitReader, caseInsensitive = false, places = placesOf(root, home, paths, caseInsensitive), context = {}) {
  const git = part.git;
  if (git === null || git.subcommand !== "clean") return null;
  const words = readCleanWords(git.args);
  if (words === "dry-run") return null;
  if (part.lostDir !== null) {
    return {
      rule: "protected-path",
      reason: `Refused: \`git clean\` runs after \`${part.lostDir.why}\`, in a folder the gate can't follow, so it can't tell what it would remove. Run it after a \`cd\` to a plain path.`
    };
  }
  const isRepo = context.isRepo ?? holdsRepo;
  const isFolder = context.isFolder ?? onDiskFolder;
  const reaches = (p) => isProtected(p, settings, places, paths) || holdsProtected(p, settings, places, paths);
  const wanted = floatingNames(settings.protectedPaths, caseInsensitive) ?? ((name) => name === ".git");
  const tree = context.tree ?? createTreeFinder();
  const nestedBelow = (p) => tree.namedBelow(paths.realpath(p.replace(/\/+$/, "")), wanted).length > 0;
  const stale = staleningPart(context.earlier ?? [], context.count ?? 0) !== null;
  const askable = words !== "unknown" && !stale && ![...words.options, ...words.pathspecs].some((w) => w.includes(UNKNOWN)) && !carriesSetup(part, git);
  const removed = askable ? await gitReader.wouldClean(git.dir, words.options, words.pathspecs) : null;
  if (removed !== null) {
    const nested = words !== "unknown" && words.nested;
    const hit = removed.map((p) => ({ p: joinRaw(git.dir, p), listedFolder: p.endsWith("/") })).find(({ p, listedFolder }) => reaches(p) || (listedFolder || isFolder(p)) && (isRepo(p) || nested && nestedBelow(p)))?.p;
    if (hit === void 0) return null;
    return {
      rule: "protected-path",
      reason: `Refused: \`git clean\` would remove \`${displayPath(hit, root, home)}\`, a protected path or a folder holding one. Ask the user to run it with \`!\`.`
    };
  }
  const pathspecs = words === "unknown" ? git.args.filter((a) => !a.startsWith("-")) : words.pathspecs;
  const fromFile = git.args.some((a) => a.startsWith("--pathspec-from-file"));
  const targets = [
    ...pathspecs.length === 0 ? [git.dir] : pathspecs.map((p) => reachOf(p, git.dir, root, home)),
    ...fromFile ? [root] : []
  ];
  const mayNest = words === "unknown" || words.nested;
  const reached = targets.find((t) => holdsProtected(t, settings, places, paths) || mayNest && nestedBelow(t));
  if (reached === void 0) return null;
  return {
    rule: "protected-path",
    reason: `Refused: \`git clean\` can reach \`${displayPath(reached, root, home)}\`, which holds protected paths, and the gate can't tell what it would remove. Clean a narrower folder (\`git clean -fd build/\`), or ask the user to run it with \`!\`.`
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

// src/tool-gate/rules/oss-hook-env.ts
var import_node_fs14 = __toESM(require("node:fs"), 1);
var import_node_path24 = __toESM(require("node:path"), 1);

// src/tool-gate/rules/protected-path-mention.ts
var import_node_path22 = __toESM(require("node:path"), 1);
var SCRIPT_LAUNCHERS = /* @__PURE__ */ new Set(["trap", "emulate", "sched"]);
function launchedScript(name, words) {
  const args = words.slice(1);
  if (name === "trap") return args[args[0] === "--" ? 1 : 0] ?? "";
  if (name === "emulate") return args[args.indexOf("-c") + 1] ?? "";
  return args.slice(args.findIndex((a) => !a.startsWith("-")) + 1).join(" ");
}
function shortened(text) {
  return text.length > 60 ? `${text.slice(0, 59)}\u2026` : text;
}
var READ_ONLY = /* @__PURE__ */ new Set([
  "cat",
  "less",
  "head",
  "tail",
  "grep",
  "rg",
  "ls",
  "stat",
  "file",
  "wc",
  "diff",
  "cmp",
  "md5",
  "shasum",
  "test",
  "[",
  "[[",
  "find",
  "cd",
  "pushd",
  "popd",
  "jq",
  "echo",
  "printf"
]);
var SAFE_IN_PROTECTED_FOLDER = /* @__PURE__ */ new Set(["mkdir"]);
var FOLDER_MAKERS = /* @__PURE__ */ new Set(["mkdir"]);
var GIT_READ_ONLY = /* @__PURE__ */ new Set(["diff", "log", "show", "status", "blame", "ls-files"]);
var GIT_INDEX_ONLY = /* @__PURE__ */ new Set(["add"]);
var WRITING_OPTIONS = /* @__PURE__ */ new Map([
  ["find", ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]],
  ["rg", ["--pre"]],
  ["file", ["-C", "--compile"]],
  ["git", ["--output"]]
]);
var SED_NAMES2 = /* @__PURE__ */ new Set(["sed", "gsed"]);
var SED_VALUE_LETTERS2 = /* @__PURE__ */ new Set(["e", "f", "l"]);
var SED_VALUE_LONG = /* @__PURE__ */ new Set(["--expression", "--file", "--line-length"]);
var AWK_NAMES2 = /* @__PURE__ */ new Set(["awk", "gawk", "mawk", "nawk"]);
function sedEditsInPlace(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return false;
    if (a.startsWith("--")) {
      if (longOption(a, "--in-place", 3)) return true;
      if (SED_VALUE_LONG.has(a)) i++;
    } else if (a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (a[j] === "i" || a[j] === "I") return true;
        if (SED_VALUE_LETTERS2.has(a[j])) {
          if (j === a.length - 1) i++;
          break;
        }
      }
    }
  }
  return false;
}
var CWD_WRITERS = /* @__PURE__ */ new Set(["tar", "bsdtar", "gtar", "unzip", "cpio", "pax", "7z", "7za", "ar", "wget"]);
var CURL_SAVES_HERE = /^(?:--remote-name(?:-all)?|--remote-header-name|--output-dir(?:=.*)?|-(?=[A-Za-z]*[OJ])[A-Za-z]+)$/;
function writesIntoCwd(part, name) {
  if (CWD_WRITERS.has(name)) return true;
  return name === "curl" && part.words.slice(1).some((w) => CURL_SAVES_HERE.test(w));
}
var INTERPRETERS2 = /* @__PURE__ */ new Set(["python", "python3", "node", "perl", "ruby", "sh", "bash", "zsh", "osascript", "deno", "bun"]);
var PYTHON3 = /^python[0-9.]*$/;
function isInterpreter2(name) {
  return INTERPRETERS2.has(name) || PYTHON3.test(name);
}
var SCRIPT_RUNNERS = /* @__PURE__ */ new Set(["source", "."]);
var SCRIPT_FLAG = /^(?:-[A-Za-z]*[ceE]|--eval|-p|--print)$/;
var QUOTES = /* @__PURE__ */ new Set(["'", '"', "`"]);
function foundPath(part, ctx, dir) {
  if (plainWriterName(part.name ?? "") !== "find") return null;
  const writing = WRITING_OPTIONS.get("find") ?? [];
  if (!part.words.slice(1).some((w) => writing.includes(w))) return null;
  const starts = findStarts(part.words.slice(1)).map((start) => joinRaw(dir, expandTilde3(start, ctx.home)));
  return starts.find((p) => isProtected(p, ctx.settings, ctx.places, ctx.paths) || holdsProtected(p, ctx.settings, ctx.places, ctx.paths)) ?? null;
}
var GIT_COMMAND_SETTINGS = ["-c", "--config-env"];
var GIT_VARIABLE2 = /^GIT_/;
function carriesGitSettings(part) {
  const git = part.git;
  if (git === null) return false;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  return globals.some((w) => GIT_COMMAND_SETTINGS.some((o) => w === o || w.startsWith(`${o}=`))) || part.assignments.some((n) => GIT_VARIABLE2.test(n));
}
function isReadOnly(part, name) {
  const writing = WRITING_OPTIONS.get(name) ?? [];
  const args = part.words.slice(1);
  if (args.some((w) => writing.some((o) => w === o || w.startsWith(`${o}=`)))) return false;
  if (name === "git") return part.git !== null && GIT_READ_ONLY.has(part.git.subcommand) && !carriesGitSettings(part);
  if (SED_NAMES2.has(name)) return !sedEditsInPlace(args) && !runsScriptFile(name, args);
  if (AWK_NAMES2.has(name)) return !awkFacts(args).loads && !runsScriptFile(name, args);
  return READ_ONLY.has(name);
}
function safeInProtectedFolder(part, name) {
  return SAFE_IN_PROTECTED_FOLDER.has(name) || name === "git" && part.git !== null && GIT_INDEX_ONLY.has(part.git.subcommand) && !carriesGitSettings(part);
}
function expandTilde3(p, home) {
  if (p === "~") return home;
  return p.startsWith("~/") ? home + p.slice(1) : p;
}
function isRootOrAbove(given, places) {
  const absPath = unfirm(given);
  return places.some((at) => {
    const ci = at.caseInsensitive === true;
    return isSameOrAncestor(absPath, at.root, ci) || isSameOrAncestor(absPath, at.home, ci);
  });
}
function namedPattern(part, word, dir, ctx) {
  const glob = part.globs.get(word);
  if (glob === void 0) return null;
  for (const value of valuesOf(glob)) {
    const pattern = globPathOf(value, escapeGlob(dir), ctx.home);
    if (patternReachesProtected(pattern, ctx.settings, ctx.places, ctx.paths, true, part.dotGlob)) return pattern;
  }
  return null;
}
function namedPath(word, dir, ctx, folders = true) {
  const unknownAt = word.indexOf(UNKNOWN);
  if (unknownAt !== -1) {
    const known = word.slice(0, unknownAt);
    if (known === "") return null;
    const absPath2 = joinRaw(dir, expandTilde3(known + UNKNOWN, ctx.home));
    return isProtected(absPath2, ctx.settings, ctx.places, ctx.paths) ? absPath2 : null;
  }
  const absPath = joinRaw(dir, expandTilde3(word, ctx.home));
  if (isProtected(absPath, ctx.settings, ctx.places, ctx.paths)) return absPath;
  if (!folders) return null;
  const holds = holdsProtected(absPath, ctx.settings, ctx.places, ctx.paths);
  return holds && !isRootOrAbove(import_node_path22.default.normalize(absPath), ctx.places) ? absPath : null;
}
function protectedPathNamed(word, dir, settings, places, paths, home) {
  const ctx = { settings, places, paths, home };
  for (const value of valuesOf(word)) {
    if (isTooLong(value)) continue;
    const named2 = namedPath(value, dir, ctx);
    if (named2 !== null) return named2;
  }
  return null;
}
function valuesOf(word) {
  const eq = word.indexOf("=");
  return eq === -1 ? [word] : [word, word.slice(eq + 1)];
}
function wordsOf(part, name) {
  const args = part.words.slice(1);
  if (name === "cp") {
    const { sources, dest } = cpOperands(args);
    const files = /* @__PURE__ */ new Set([...sources, ...dest === null ? [] : [dest]]);
    return { words: args.filter((a) => !files.has(a)), scripts: [] };
  }
  const interpreter = isInterpreter2(name);
  if (!interpreter && !SCRIPT_RUNNERS.has(import_node_path22.default.posix.basename(part.program ?? ""))) return { words: args, scripts: [] };
  const words = [];
  const scripts = [];
  let scriptSeen = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (interpreter && SCRIPT_FLAG.test(a) && i + 1 < args.length) {
      scripts.push(args[++i]);
      scriptSeen = true;
    } else if (!scriptSeen && !a.startsWith("-")) {
      scriptSeen = true;
    } else {
      words.push(a);
    }
  }
  return { words, scripts };
}
function stringLiterals(script) {
  const literals = [];
  const unclosed = /* @__PURE__ */ new Set();
  let i = 0;
  while (i < script.length) {
    tick();
    const quote = script[i];
    if (!QUOTES.has(quote) || unclosed.has(quote)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < script.length && script[j] !== quote) {
      tick();
      j += quote === '"' && script[j] === "\\" ? 2 : 1;
    }
    if (j >= script.length) {
      unclosed.add(quote);
      i++;
      continue;
    }
    literals.push(script.slice(i + 1, j));
    i = j + 1;
  }
  return literals;
}
var LITERALS = /* @__PURE__ */ new WeakMap();
function partLiterals(part) {
  const known = LITERALS.get(part);
  if (known !== void 0) return known;
  const literals = part.name === null || !isInterpreter2(part.name) ? [] : scriptsOf(part, part.name).flatMap(stringLiterals);
  LITERALS.set(part, literals);
  return literals;
}
function scriptsOf(part, name) {
  return [...wordsOf(part, name).scripts, ...part.stdinScripts];
}
function literalsOf(part) {
  return [...new Set(partLiterals(part).filter((literal2) => literal2 !== ""))];
}
function matchesOutsideRoot(glob) {
  return glob.startsWith("~/") || glob.startsWith("**/") || import_node_path22.default.isAbsolute(glob);
}
function namedInScript(literals, dir, ctx) {
  const tails = ctx.settings.protectedPaths.filter(matchesOutsideRoot).map((glob) => `**/${glob.startsWith("~/") ? glob.slice(2) : glob}`);
  for (const literal2 of literals) {
    const named2 = namedPath(literal2, dir, ctx);
    if (named2 !== null) return named2;
    const tail = import_node_path22.default.posix.normalize(`/${literal2}`);
    if (ctx.places.some((at) => matchAnyPath(tails, tail, at))) return literal2;
  }
  return null;
}
var MAX_CALL_WORDS2 = 2048;
function stdinScriptChars(part) {
  return part.name === null || !isInterpreter2(part.name) ? 0 : part.stdinScripts.reduce((n, script) => n + script.length, 0);
}
function checkCallSize(parts) {
  const chars = parts.reduce((n, part) => n + stdinScriptChars(part), 0);
  if (chars > MAX_CALL_CHARS) {
    return {
      rule: "protected-path-mention",
      reason: `Refused: this command is too complex for the gate to check (scripts fed on stdin longer than ${MAX_CALL_CHARS / 1024} KB in all); split it into simpler commands.`
    };
  }
  const words = parts.reduce((n, part) => n + Math.max(1, part.words.length + part.writeTargets.length + partLiterals(part).length), 0);
  if (words <= MAX_CALL_WORDS2) return null;
  return {
    rule: "protected-path-mention",
    reason: `Refused: this command has too many words for the gate to check (over ${MAX_CALL_WORDS2}). Split it into shorter commands.`
  };
}
var OUTPUT_NAMES = /* @__PURE__ */ new Set([
  "out",
  "output",
  "outfile",
  "outputfile",
  "outdir",
  "outputdir",
  "report",
  "reportpath",
  "junit",
  "junitxml",
  "coverprofile",
  "dest",
  "write",
  "logfile",
  "outputpath",
  "reportdir",
  "coveragedir",
  "declarationdir"
]);
var OUTPUT_OPTION = /^--?([A-Za-z][A-Za-z_-]*)(?:=([\s\S]*))?$/;
var PROGRAM_WRITE_OPTIONS = /* @__PURE__ */ new Map([["prettier", ["-w"]]]);
var OUTPUT_SHORT = /^-[A-Za-z]*o$/;
var OUTPUT_ATTACHED = /^-o(.+)$/;
function outputName(word) {
  const match = OUTPUT_OPTION.exec(word);
  if (match === null) return null;
  const name = match[1].toLowerCase().replace(/[-_]/g, "");
  return OUTPUT_NAMES.has(name) ? { name, value: match[2] } : null;
}
function outputValues2(words, settings) {
  const values = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const named2 = outputName(w);
    if (named2 !== null) {
      const value = named2.value ?? (i + 1 < words.length ? words[++i] : void 0);
      if (value !== void 0) values.push({ value, folder: named2.name.endsWith("dir") });
    } else if (OUTPUT_SHORT.test(w) && i + 1 < words.length) values.push({ value: words[++i], folder: false });
    else if (OUTPUT_ATTACHED.test(w)) values.push({ value: w.slice(2), folder: false });
  }
  const writeOptions = (settings.reviewWriteOptions ?? []).filter((o) => o.startsWith("-") && !o.includes(" "));
  const programOptions = words.flatMap((w) => PROGRAM_WRITE_OPTIONS.get(import_node_path22.default.basename(w)) ?? []);
  if (words.some((w) => writeOptions.includes(w) || programOptions.includes(w))) {
    values.push(...words.slice(1).filter((w) => !w.startsWith("-")).map((value) => ({ value, folder: false })));
  }
  return values;
}
function lostTailNamed(part, written, ctx) {
  if (part.lostDir === null || part.name === null || safeInProtectedFolder(part, part.name)) return null;
  const relative = written.filter(
    ({ value: w, folder }) => (folder || /[./]/.test(w)) && !w.startsWith("-") && !w.startsWith("~") && !import_node_path22.default.isAbsolute(w) && !w.includes(UNKNOWN)
  );
  const globOf2 = ({ value, folder }) => {
    const glob = part.globs.get(value) ?? escapeGlob(value);
    return folder ? `${glob.replace(/\/+$/, "")}/*` : glob;
  };
  const contents = (w) => part.lostDir?.pattern === null && part.git === null && !w.includes("://");
  return relative.find((w) => ctx.places.some((at) => tailMayBeProtected(globOf2(w), ctx.settings.protectedPaths, at, part.dotGlob, contents(w.value))))?.value ?? null;
}
function checkProtectedPathMention(part, settings, root, home, paths, caseInsensitive = false, places) {
  if (part.program === null || part.name === null) return null;
  const { name } = part;
  const readOnly = isReadOnly(part, name);
  if (readOnly && !SED_NAMES2.has(name) && !AWK_NAMES2.has(name) || part.git?.subcommand === "clean") return null;
  const ctx = { settings, places: places ?? placesOf(root, home, paths, caseInsensitive), paths, home };
  const dir = part.git?.dir ?? part.cwd;
  const here = safeInProtectedFolder(part, name) ? null : namedPath(dir, "/", ctx);
  if (here !== null) {
    return {
      rule: "protected-path-mention",
      reason: `Refused: \`${name}\` runs in \`${displayPath(here, root, home)}\`, which holds protected paths, and only read-only programs may run there. Ask the user to run it with \`!\`.`
    };
  }
  const lost = part.lostDir?.pattern ?? null;
  if (lost !== null && patternReachesProtected(lost, settings, ctx.places, paths, true, part.dotGlob)) {
    return {
      rule: "protected-path-mention",
      reason: `Refused: \`${name}\` runs after \`${part.lostDir?.why}\`, which could be a protected folder, and only read-only programs may run there. Ask the user to run it with \`!\`.`
    };
  }
  if (readOnly) return null;
  const given = wordsOf(part, name);
  const words = [...given.words, ...part.assignmentValues];
  const literals = literalsOf(part);
  if (words.flatMap(valuesOf).some(isTooLong) || literals.some(isTooLong)) return TOO_LONG;
  if (part.lostDir !== null && part.lostDir.pattern === null && writesIntoCwd(part, name)) {
    return {
      rule: "protected-path-mention",
      reason: `Refused: \`${name}\` writes into its folder after \`${part.lostDir.why}\`, a folder the gate can't follow. Run it after a \`cd\` to a plain path.`
    };
  }
  const found2 = foundPath(part, ctx, dir);
  if (found2 !== null) {
    return {
      rule: "protected-path-mention",
      reason: `Refused: this \`find\` deletes, writes or runs a command from \`${displayPath(found2, root, home)}\`, which holds protected paths. Start it from a folder that holds none, or ask the user to run it with \`!\`.`
    };
  }
  const named2 = words.flatMap(valuesOf).map((w) => namedPath(w, dir, ctx, !FOLDER_MAKERS.has(name))).find((p) => p !== null) ?? words.map((w) => namedPattern(part, w, dir, ctx)).find((p) => p !== null) ?? namedInScript(literals, dir, ctx);
  const lostNamed = named2 === null ? lostTailNamed(part, [...outputValues2(words, settings), ...literals.map((value) => ({ value, folder: false }))], ctx) : null;
  if (lostNamed !== null) {
    return {
      rule: "protected-path-mention",
      reason: `Refused: \`${name}\` names \`${lostNamed}\` after \`${part.lostDir?.why}\`, in a folder the gate can't follow, where it could be a protected path. Instead, ${LOST_CD_HINT}, or ask the user to run it with \`!\`.`
    };
  }
  if (named2 === null) return null;
  const shown2 = import_node_path22.default.isAbsolute(named2) ? displayPath(named2, root, home) : named2;
  if (SCRIPT_LAUNCHERS.has(name)) {
    return {
      rule: "protected-path-mention",
      reason: `Refused: \`${name}\` runs a script that names a protected path: \`${shortened(launchedScript(name, part.words))}\`. Ask the user to run it with \`!\`.`
    };
  }
  return {
    rule: "protected-path-mention",
    reason: `Refused: \`${name}\` names \`${shown2}\`, a protected path, and only read-only programs may. To read it, use the Read tool or \`cat ${shown2} | ${name}\`. Ask the user to run it with \`!\`.`
  };
}

// src/tool-gate/rules/verdict-capture-call.ts
var import_node_path23 = __toESM(require("node:path"), 1);
var NAMES = ["oss-verdict-capture.sh", "verdict-capture.cjs", "verdict-capture.js"];
var SEPARATORS = /[\s'"`;|&()<>=${}\\,]+/;
var GLOB = /[*?[]/;
var SET = /\[[!^]?\]?[^\]]*\]?/;
var FORM_END = /[\s;|&()<>'"`${}]/;
function specialSetsAsAny(text) {
  const closing = /* @__PURE__ */ new Map();
  const closeOf = (delim, from) => {
    const cached = closing.get(delim);
    if (cached !== void 0 && (cached === -1 || cached >= from)) return cached;
    const at = text.indexOf(`${delim}]`, from);
    closing.set(delim, at);
    return at;
  };
  let wordEnd = -1;
  const wordEndOf = (from) => {
    if (wordEnd >= from) return wordEnd;
    wordEnd = from;
    while (wordEnd < text.length && !FORM_END.test(text[wordEnd])) wordEnd += 1;
    return wordEnd;
  };
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "[") {
      out += text[i];
      i += 1;
      continue;
    }
    let j = i + 1;
    if (text[j] === "!" || text[j] === "^") j += 1;
    if (text[j] === "]") j += 1;
    let special = false;
    for (; j < text.length && text[j] !== "]" && !FORM_END.test(text[j]); j += 1) {
      if (text[j] === "\\") {
        special = true;
        if (j + 1 < text.length && !FORM_END.test(text[j + 1])) j += 1;
      } else if (text[j] === "[" && ":=.".includes(text[j + 1] ?? "x")) {
        const at = closeOf(text[j + 1], j + 2);
        if (at >= 0 && at < wordEndOf(j + 2)) {
          special = true;
          j = at + 1;
        }
      }
    }
    if (text[j] !== "]") {
      out += text.slice(i, j);
      i = j;
    } else {
      out += special ? "?" : text.slice(i, j + 1);
      i = j + 1;
    }
  }
  return out;
}
function globTokens(piece, caseless = false) {
  const tokens = [];
  for (const m of piece.matchAll(new RegExp(`${SET.source}|[*?]|[^*?[]`, "g"))) {
    const c = m[0];
    if (c === "*") tokens.push("*");
    else if (c === "?" || c.startsWith("[") && (c.length < 2 || !c.endsWith("]") || /^\[[!^]?\]$/.test(c))) {
      tokens.push(() => true);
    } else if (c.startsWith("[")) tokens.push(bracketTest(c.slice(1, -1), caseless));
    else tokens.push(caseless ? (x) => x.toLowerCase() === c.toLowerCase() : (x) => x === c);
  }
  return tokens;
}
function bracketTest(body, caseless) {
  const negate = body.startsWith("!") || body.startsWith("^");
  const set = negate ? body.slice(1) : body;
  const holds = (c) => {
    let hit = false;
    for (let i = 0; i < set.length; i += 1) {
      if (set[i + 1] === "-" && i + 2 < set.length) {
        if (c >= set[i] && c <= set[i + 2]) hit = true;
        i += 2;
      } else if (set[i] === c) hit = true;
    }
    return hit;
  };
  return (c) => (caseless ? holds(c.toLowerCase()) || holds(c.toUpperCase()) : holds(c)) !== negate;
}
function globMatch(tokens, name) {
  let t = 0;
  let s = 0;
  let star = -1;
  let starS = 0;
  while (s < name.length) {
    const token = tokens[t];
    if (token === "*") {
      star = t;
      starS = s;
      t += 1;
    } else if (token !== void 0 && token(name[s])) {
      t += 1;
      s += 1;
    } else if (star >= 0) {
      t = star + 1;
      starS += 1;
      s = starS;
    } else return false;
  }
  while (tokens[t] === "*") t += 1;
  return t === tokens.length;
}
function globNames(piece, folder) {
  const tokens = globTokens(piece, true);
  if (!NAMES.some((name) => globMatch(tokens, name))) return false;
  const literals = piece.toLowerCase().split(new RegExp(`${SET.source}|[*?]`));
  return literals.some(writesStem) || folder !== void 0 && /^(?:hooks|cli)$/i.test(folder);
}
function writesStem(literal2) {
  if (literal2.length < 3) return false;
  return NAMES.some((name) => {
    const stemEnd = name.lastIndexOf(".");
    for (let at = name.indexOf(literal2); at >= 0; at = name.indexOf(literal2, at + 1)) {
      if (Math.min(at + literal2.length, stemEnd) - at >= 3) return true;
    }
    return false;
  });
}
function hasLiteralName(text) {
  return text.split(SEPARATORS).some((word) => word.split("/").some((segment) => NAMES.includes(segment)));
}
function namesVerdictCapture(text) {
  const lower = text.toLowerCase();
  if (hasLiteralName(lower)) return true;
  for (const word of specialSetsAsAny(text).split(SEPARATORS)) {
    const segments = word.split("/");
    for (const [i, segment] of segments.entries()) {
      if (GLOB.test(segment) && globNames(segment, segments[i - 1])) return true;
    }
  }
  return false;
}
var FIND_RUNNERS = /* @__PURE__ */ new Set(["-exec", "-execdir", "-ok", "-okdir"]);
var FIND_GLOBS = /* @__PURE__ */ new Set(["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename"]);
var INTERPRETERS3 = /^(?:node|sh|bash|zsh|dash|python3?|perl|ruby|deno|bun|tsx|ts-node)$/;
var ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
function couldMatch(tokens, pieces, anchored) {
  const closure = (at2) => {
    for (const t of at2) if (tokens[t] === "*") at2.add(t + 1);
    return at2;
  };
  const gap = (at2) => {
    let from = Infinity;
    for (const t of at2) if (t < from) from = t;
    const all = /* @__PURE__ */ new Set();
    for (let t = from; t <= tokens.length; t += 1) all.add(t);
    return all;
  };
  let at = closure(/* @__PURE__ */ new Set([0]));
  if (!anchored) at = gap(at);
  for (const [k, piece] of pieces.entries()) {
    if (k > 0) at = gap(at);
    for (const c of piece) {
      const next = /* @__PURE__ */ new Set();
      for (const t of at) {
        const token = tokens[t];
        if (token === "*") next.add(t);
        else if (token !== void 0 && token(c)) next.add(t + 1);
      }
      at = closure(next);
      if (at.size === 0) return false;
    }
  }
  return at.has(tokens.length);
}
function globCouldPickProtected(test, glob) {
  const tokens = globTokens(glob, true);
  const whole = test === "-name" || test === "-iname";
  return [...NAMES.map((name) => [name]), ["oss-", ".sh"]].some(
    (pieces) => couldMatch(tokens, whole ? pieces : [`/${pieces[0]}`, ...pieces.slice(1)], whole)
  );
}
function runsFound(words) {
  let i = 0;
  if (words[0] === "env") {
    i = 1;
    while (i < words.length && (words[i].startsWith("-") || ENV_ASSIGNMENT.test(words[i]))) i += 1;
  }
  const program = words[i];
  if (program === void 0) return false;
  if (program.includes("{}")) return true;
  if (!INTERPRETERS3.test(program.split("/").pop() ?? "")) return false;
  const script = words.slice(i + 1).find((w) => !w.startsWith("-") && w !== "run");
  return script?.includes("{}") ?? false;
}
var FOLLOWS_LINKS = /^(?:-[HLPEXdsx]*[HL][HLPEXdsx]*|-follow)$/;
function findReachesProtected(part, at) {
  const args = part.words.slice(1);
  if (args.some((w) => FOLLOWS_LINKS.test(w))) return true;
  const folders = [at.pluginRoot, import_node_path23.default.join(at.home, ".oss")].filter((f) => import_node_path23.default.isAbsolute(f)).flatMap((f) => formsOf(f, at.paths));
  return findStarts(args).some((start) => {
    if (start.includes(UNKNOWN) || part.cwd.includes(UNKNOWN) || part.lostDir !== null && !start.startsWith("/")) return true;
    return formsOf(joinRaw(part.cwd, expandTilde3(start, at.home)), at.paths).some(
      (form) => folders.some((f) => isSameOrAncestor(form, f, at.caseInsensitive) || isSameOrAncestor(f, form, at.caseInsensitive))
    );
  });
}
function findRunsProtected(part, at) {
  if (part.name !== "find") return false;
  const words = part.words;
  if (!findReachesProtected(part, at)) return false;
  if (!words.some((word, i) => FIND_GLOBS.has(words[i - 1] ?? "") && globCouldPickProtected(words[i - 1], word))) return false;
  for (let i = 1; i < words.length; i += 1) {
    if (!FIND_RUNNERS.has(words[i])) continue;
    const end = words.findIndex((w, k) => k > i && (w === ";" || w === "+"));
    if (runsFound(words.slice(i + 1, end === -1 ? words.length : end))) return true;
    if (end === -1) break;
    i = end;
  }
  return false;
}
function checkVerdictCaptureCall(part, command, at) {
  if (findRunsProtected(part, at)) {
    return {
      rule: "protected-path",
      reason: "Refused: this `find` runs the files it finds, and its name or path test could pick a protected OSS script (the verdict capture or an OSS hook). Run a file you name in full, or ask the user to run it with `!`."
    };
  }
  const texts = [command, ...part.words, ...part.assignmentValues, ...part.stdinScripts];
  if (!texts.some(namesVerdictCapture)) return null;
  return {
    rule: "protected-path",
    reason: "Refused: runs or names the OSS verdict capture (`oss-verdict-capture.sh`, `verdict-capture.cjs`, `verdict-capture.js`). Only Claude Code's own subagent hook runs it; a review verdict is captured when the review agent stops."
  };
}

// src/tool-gate/rules/oss-hook-env.ts
var HOOK_FILE = /\/\.oss\/hooks\/[^/]|\/\.claude\/plugins\/cache\/.*\/hooks\/[^/]|(?:^|\/)hooks\/oss-[^/]*\.sh$/i;
var HOOKS_PART = /(?:^|\/)hooks\/[^/]/i;
var PLUGIN_HOOK = /\$\{?CLAUDE_PLUGIN_ROOT\}?\/hooks\/[^/]/;
var HOOK_CALL_VARIABLES = /* @__PURE__ */ new Set([
  "CLAUDE_PROJECT_DIR",
  "CREDS",
  "F",
  "HAS_PLAYWRIGHT",
  "OSS_DIR",
  "OSS_ICON_PNG",
  "PLAYWRIGHT_RESULT",
  "PLIST_PATH",
  "PLUGIN_ROOT",
  "SCRIPT_DIR",
  "SETTINGS_FILE",
  "SOUND",
  "STATUSLINE_SCRIPT",
  "STYLE",
  "V",
  "VERBOSITY",
  "VERIFY",
  "VOICE",
  "WHY",
  "candidates",
  "d",
  "dest",
  "encoding",
  "found",
  "l",
  "none",
  "o",
  "rc",
  "src",
  "top",
  "verdict",
  "verdicts",
  "version",
  "w"
]);
var ASSIGNMENT3 = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=/;
var VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
var MAYBE_EXPORTED = /[A-Z]|_proxy$|^(?:manpath|fpath|cdpath|module_path|mailpath|psvar|fignore)$/;
var COMMAND_MAPS = /^(?:dis_)?(?:aliases|galiases|saliases|functions|commands|builtins|options)$/;
function optionName2(word) {
  return (word ?? "").toLowerCase().replace(/_/g, "");
}
var SERVED_OPTIONS = /* @__PURE__ */ new Set(["pipefail", "errexit", "unset", "xtrace", "clobber"]);
var RESERVED = /* @__PURE__ */ new Set(["if", "then", "else", "elif", "do", "while", "until", "{", "!", "time"]);
var SETTING_WORD = /^(?:HOME|PATH|path)(?:$|\[[^\]]*\])?(?:\+?=|$)/;
var SCRIPT_FLAG2 = /^-[A-Za-z]*c$/;
var NAME_SETTERS2 = /* @__PURE__ */ new Set(["declare", "typeset", "export", "local", "readonly", "read", "integer", "float", "private", "vared", "getln"]);
var NAMEREF_SETTERS = /* @__PURE__ */ new Set(["declare", "typeset", "local", "private"]);
var OPERAND_SETTERS = /* @__PURE__ */ new Set([...NAME_SETTERS2, "let", "env"]);
var PREFIXES = /* @__PURE__ */ new Set(["builtin", "command", "noglob", "nocorrect", "-"]);
function isEnvProgram(word) {
  if (word.includes(UNKNOWN)) return false;
  return hasGlobClass(word) || globMatches(word.slice(word.lastIndexOf("/") + 1), "env");
}
function hasGlobClass(word) {
  const base = word.slice(word.lastIndexOf("/") + 1);
  return base.lastIndexOf("]") > base.indexOf("[") + 1 && base.includes("[");
}
function isArchProgram(word) {
  if (word.includes(UNKNOWN)) return false;
  return hasGlobClass(word) || globMatches(word.slice(word.lastIndexOf("/") + 1), "arch");
}
function isEnvPiece(piece) {
  return isEnvProgram(piece) || isArchProgram(piece) || isLaunchctlProgram(piece);
}
var MAX_DEPTH = 5;
function setsRefusedVariable(text, depth, call) {
  if (depth > MAX_DEPTH || expansionSet(text, (name) => !HOOK_CALL_VARIABLES.has(name)) !== null || arithmeticReadsVariable(text)) return true;
  const result = tokenize(text, call.home, new ReadBudget());
  if ("unreadable" in result && result.limit) return true;
  return tokensSet(result.tokens, depth, call, text);
}
function sourcesOssHook(word, home) {
  if (word === void 0 || word.includes(UNKNOWN) || /[*?[]/.test(word) || word.split("/").some((p) => p === "." || p === "..")) return false;
  const name = word.startsWith("~/.oss/hooks/") ? word.slice("~/.oss/hooks/".length) : word.startsWith(`${home}/.oss/hooks/`) ? word.slice(`${home}/.oss/hooks/`.length) : "";
  return name !== "" && !name.includes("/");
}
function setsIndirectly(words) {
  let p = 0;
  while (PREFIXES.has(words[p])) p++;
  const [name, ...args] = words.slice(p);
  if (name === "let") return args.some((a) => a.includes(UNKNOWN));
  if (name === "getopts") return (args[1] ?? UNKNOWN).includes(UNKNOWN);
  if (name === "zparseopts") return args.some((a) => a.includes(UNKNOWN));
  if (name === "mapfile" || name === "readarray") return arrayOperands(args).some((a) => a.includes(UNKNOWN));
  if (name === "set") {
    const at = args.findIndex((a) => /^[-+][A-Za-z]*A/.test(a));
    return at !== -1 && (args[at + 1] ?? UNKNOWN).includes(UNKNOWN);
  }
  if (name === "printf" || name === "print") {
    return args.some((a, i) => a === "-v" && (args[i + 1] ?? UNKNOWN).includes(UNKNOWN) || /^-v./.test(a) && a.includes(UNKNOWN));
  }
  if (name === void 0 || !NAME_SETTERS2.has(name)) return false;
  if (NAMEREF_SETTERS.has(name) && args.some((a) => /^-[A-Za-z]*n/.test(a))) return true;
  return args.some((a) => !a.startsWith("-") && a.split("=")[0].includes(UNKNOWN));
}
function variableOf(word) {
  return word.split(/[=[+]/)[0];
}
function setsUnlisted(words) {
  let p = 0;
  while (RESERVED.has(words[p])) p++;
  const assigned = [];
  while (p < words.length && ASSIGNMENT3.test(words[p])) assigned.push(words[p++]);
  while (PREFIXES.has(words[p])) p++;
  const [written, ...args] = words.slice(p);
  const name = written !== void 0 && isEnvProgram(written) ? "env" : written;
  if (name === void 0 || name === "for" || name === "select") {
    const plain = name === void 0 ? assigned : [...assigned, args[0] ?? ""];
    return plain.some((w) => (MAYBE_EXPORTED.test(variableOf(w)) || COMMAND_MAPS.test(variableOf(w))) && unlisted(w));
  }
  const names = name === "read" ? assigned.filter((w) => variableOf(w) !== "IFS") : [...assigned];
  if (OPERAND_SETTERS.has(name)) names.push(...args.filter((a) => !a.startsWith("-")));
  else if (name === "printf" || name === "print") args.forEach((a, i) => a === "-v" ? names.push(args[i + 1] ?? "") : /^-v./.test(a) && names.push(a.slice(2)));
  else if (name === "mapfile" || name === "readarray") names.push(...arrayOperands(args));
  else if (name === "getopts") names.push(args[1] ?? "");
  else if (name === "zparseopts") {
    args.forEach((a, i) => {
      if (a === "-A" || a === "-a") names.push(args[i + 1] ?? "");
      else if (/^-[aA]./.test(a)) names.push(a.slice(2));
      if (a.includes("=")) names.push(a.slice(a.indexOf("=") + 1));
    });
  }
  return names.some(unlisted);
}
function unlisted(word) {
  const variable = variableOf(word);
  return VARIABLE_NAME.test(variable) && !HOOK_CALL_VARIABLES.has(variable);
}
var ARRAY_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-d", "-n", "-O", "-s", "-u", "-C", "-c"]);
function arrayOperands(args) {
  const operands2 = [];
  for (let i = 0; i < args.length; i++) {
    if (ARRAY_VALUE_OPTIONS.has(args[i])) i++;
    else if (!args[i].startsWith("-") || args[i].includes(UNKNOWN)) operands2.push(args[i]);
  }
  return operands2;
}
function unquotedText(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === "\\") {
      out += text.slice(i, i + 2);
      i++;
    } else if (c === "'" && quote === null) {
      quote = "'";
    } else {
      if (c === '"') quote = quote === '"' ? null : '"';
      out += c;
    }
  }
  return out;
}
function arithmeticReadsVariable(text) {
  const shell = unquotedText(text);
  const open = [];
  let arithmetic = 0;
  for (let i = 0; i < shell.length; i++) {
    const c = shell[i];
    if (c === "$" && arithmetic > 0) return true;
    if (c === "(" && shell[i + 1] === "(" || c === "$" && shell[i + 1] === "[") {
      open.push(...c === "(" ? [true, false] : [true]);
      arithmetic++;
      i++;
    } else if (c === "(" || c === "[") {
      open.push(false);
    } else if ((c === ")" || c === "]") && open.length > 0 && open.pop() === true) {
      arithmetic--;
    }
  }
  return false;
}
function setsFromElsewhere(words, depth, call, raws) {
  let p = 0;
  while (RESERVED.has(words[p])) p++;
  while (p < words.length && ASSIGNMENT3.test(words[p])) p++;
  while (PREFIXES.has(words[p])) p++;
  const [name, ...args] = words.slice(p);
  if (name === "source" || name === ".") {
    return !sourcesOssHook(args[0], call.home) && !(args[0] !== void 0 && trustedSourceWord(args[0], raws[p + 1], call.home, call.sources));
  }
  if (name === "function") return true;
  if (name === "set") {
    return args.some((a, i) => /^-[A-Za-z]*[kTa]/.test(a) || /^[-+][A-Za-z]*A/.test(a) || /^[-+][A-Za-z]*o/.test(a) && !SERVED_OPTIONS.has(optionName2(args[i + 1]).replace(/^no/, "")));
  }
  if (name === "alias" || name === "enable" || name === "disable") return true;
  if (name === "hash") return args.some((a) => a.includes("=") || /^-[A-Za-z]*p/.test(a));
  if (name === "setopt" || name === "unsetopt" || name === "emulate") return true;
  if (name === "shopt") return args.some((a) => optionName2(a) === "allexport");
  if (name === "trap") return args.some((a) => !a.startsWith("-") && setsRefusedVariable(a, depth + 1, call));
  return false;
}
function piecesSet(word) {
  if (!/\s/.test(word)) return false;
  const assigned = ASSIGNMENT3.exec(word);
  const pieces = (assigned === null ? word : word.slice(assigned[0].length)).split(/\s+/).filter(Boolean);
  let laterSetsForEnv = false;
  let laterSetsForSetter = false;
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const p = pieces[i];
    if (isEnvPiece(p) ? laterSetsForEnv : OPERAND_SETTERS.has(p) && laterSetsForSetter) return true;
    const assigns = ASSIGNMENT3.test(p) && unlisted(p);
    laterSetsForEnv ||= assigns || p.startsWith("-");
    laterSetsForSetter ||= assigns || SETTING_WORD.test(p);
  }
  return false;
}
function tokensSet(tokens, depth, call, text) {
  let previous = null;
  let words = [];
  let raws = [];
  let afterNameParen = false;
  for (const token of tokens) {
    if (afterNameParen && token.kind === "op" && token.value === ")") return true;
    afterNameParen = token.kind === "op" && token.value === "(" && words.length > 0;
    if (token.kind === "op") {
      if (setsIndirectly(words) || setsUnlisted(words) || setsFromElsewhere(words, depth, call, raws)) return true;
      words = [];
      raws = [];
    } else if (token.kind === "word") {
      words.push(token.value);
      const at = sourceOf(token);
      raws.push(text === void 0 || at === void 0 ? void 0 : text.slice(at.start, at.end));
    }
    if (token.kind !== "op" && token.scripts?.some((script) => tokensSet(script, depth, call))) return true;
    if (token.kind === "redirect") {
      const body = heredocBodyOf(token);
      if (body !== void 0 && setsRefusedVariable(body, depth + 1, call)) return true;
    } else if (token.kind === "word") {
      if (SETTING_WORD.test(token.value) || piecesSet(token.value)) return true;
      if (previous !== null && (previous === "eval" || SCRIPT_FLAG2.test(previous)) && setsRefusedVariable(token.value, depth + 1, call)) return true;
      previous = token.value;
    } else {
      previous = null;
    }
  }
  return setsIndirectly(words) || setsUnlisted(words) || setsFromElsewhere(words, depth, call, raws);
}
var HOOK_PATH_NAMES = [".oss", "hooks", ".claude", "plugins", "cache", "oss-x.sh"];
var GLOB2 = /[*?[]/;
var MAX_GLOB_READINGS = 256;
function globMatches(part, name) {
  if (name.startsWith(".") && !part.startsWith(".")) return false;
  return globMatch(globTokens(specialSetsAsAny(part), true), name.toLowerCase());
}
function globReadings(word) {
  let readings = [];
  for (const [i, part] of word.split("/").entries()) {
    const options = GLOB2.test(part) ? [part, ...HOOK_PATH_NAMES.filter((n) => globMatches(part, n)), ...part === "**" ? ["plugins/cache"] : []] : [part];
    readings = i === 0 ? options : readings.flatMap((r) => options.map((o) => `${r}/${o}`));
    if (readings.length > MAX_GLOB_READINGS) return null;
  }
  return readings;
}
function namesHook(word, cwd, home) {
  const readings = GLOB2.test(word) ? globReadings(word) : [word];
  return readings === null || readings.some((w) => HOOK_FILE.test(w) || inPluginCheckout(w, cwd)) || unknownCouldBeHook(word, home);
}
var HOOK_UNDER = /\/\.oss\/hooks\/[^/]|\/\.claude\/plugins\/cache\/.*\/hooks\/[^/]/i;
var HOOK_HOME_STARTS = ["~/.oss/hooks/", "~/.claude/plugins/cache/"];
function unknownCouldBeHook(word, home) {
  if (!word.includes(UNKNOWN)) return false;
  const fromHome = word.startsWith(`${home}/`) ? `~${word.slice(home.length)}` : word;
  const known = fromHome.slice(0, fromHome.indexOf(UNKNOWN)).toLowerCase();
  const atHome = fromHome.startsWith("~/") && HOOK_HOME_STARTS.some((start) => start.startsWith(known) || known.startsWith(start));
  if (atHome) return true;
  if (!/\.oss|\.claude/i.test(word.split(UNKNOWN).join(""))) return false;
  const glob = word.split(UNKNOWN).join("*");
  const tails = word.split("/").pop()?.includes(UNKNOWN) ? ["", "/*/x"] : [""];
  return tails.some((tail) => {
    const readings = globReadings(glob + tail);
    return readings === null || readings.some((w) => HOOK_UNDER.test(w));
  });
}
function inPluginCheckout(word, cwd) {
  const hooks = HOOKS_PART.exec(word);
  if (hooks === null) return false;
  let dir = import_node_path24.default.dirname(import_node_path24.default.resolve(cwd, word.slice(0, hooks.index + hooks[0].length - 1)));
  for (; ; ) {
    if (import_node_fs14.default.existsSync(import_node_path24.default.join(dir, ".claude-plugin", "plugin.json"))) return true;
    const up = import_node_path24.default.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}
function partNamesHook(part, home) {
  const lost = part.lostDir !== null && part.lostDir.plainKnown !== true;
  if (lost && lostWordsCouldBeHook(part.words)) return true;
  return [...part.words, ...part.assignmentValues].some((w) => wordNamesHook(w, part.cwd, !lost, home));
}
function wordNamesHook(word, cwd, relative, home) {
  return namesHook(word, cwd, home) || relative && !/^[/~-]/.test(word) && namesHook(import_node_path24.default.resolve(cwd, word), cwd, home);
}
var SCRIPT_RUNNERS2 = /* @__PURE__ */ new Set(["bash", "sh", "zsh", "dash", ".", "source"]);
function lostWordsCouldBeHook(words) {
  const script = SCRIPT_RUNNERS2.has(words[0]) ? words.findIndex((w, i) => i > 0 && !w.startsWith("-")) : -1;
  return words.some((w, i) => couldBeOssHook(w, i === 0 || i === script));
}
function couldBeOssHook(word, runs) {
  const parts = word.split("/");
  const last = parts[parts.length - 1].toLowerCase();
  const bare = parts.length === 1 || parts.length === 2 && parts[0] === ".";
  const literal2 = last.split(GLOB2)[0];
  const ossName = GLOB2.test(last) ? literal2.startsWith("oss-") || "oss-".startsWith(literal2) : last.startsWith("oss-");
  if (bare && ossName) return true;
  if (!runs) return false;
  const hookFolder = parts.some((p) => ["hooks", ".oss"].some((name) => GLOB2.test(p) ? globMatches(p, name) : p.toLowerCase() === name));
  return hookFolder || parts[parts.length - 1].includes(UNKNOWN);
}
var SPLIT_REF = /^"?(?:\$=?([A-Za-z_][A-Za-z0-9_]*|[@*])(?:\[[^\]]*\])?|\$\{=?([A-Za-z_][A-Za-z0-9_]*|[@*])(?:\[[^\]]*\])?\})"?$/;
var OTHER_OPERATOR = /^"?\$\{(?![A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\})/;
var DEFAULT_REF = /^"?\$\{([A-Za-z_][A-Za-z0-9_]*):?[-=]([\s\S]*)\}"?$/;
var SERVED_ROOT = /^"?\$\{(CLAUDE_PLUGIN_ROOT)(?::-((?:\$HOME(?![A-Za-z0-9_])|\$\{HOME\})?[A-Za-z0-9._/@:,=+-]*)|(%\/))\}(\/hooks\/[A-Za-z0-9._-]+)"?$/;
var LEADING_REF = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})(?![A-Za-z0-9_[])/;
var UNREAD_SETTERS = /* @__PURE__ */ new Set(["for", "select", "printf", "print", "getopts", "let"]);
var ARRAY_START = /^([A-Za-z_][A-Za-z0-9_]*)(\+?)=$/;
var FROM_FILE = /* @__PURE__ */ Symbol("from a file");
var UNREAD = /* @__PURE__ */ Symbol("not read");
var HOOK_HINT = /\.oss|hooks/i;
function readsFile(script) {
  const end = script.findIndex((t) => t.kind === "op");
  const command = end === -1 ? script : script.slice(0, end);
  const words = command.flatMap((t) => t.kind === "word" ? [t.value] : []);
  if (words.length === 0) return command.some((t) => t.kind === "redirect" && t.op === "<");
  return words[0] === "cat" && words.slice(1).some((w) => !w.startsWith("-"));
}
function wordReadsFile(token) {
  return token.kind !== "op" && token.scripts !== void 0 && token.scripts.some(readsFile);
}
function filled(token, text, values, home) {
  if (token.kind !== "word") return "";
  if (!token.value.includes(UNKNOWN)) return token.value;
  const at = sourceOf(token);
  const refs = text === null || at === void 0 ? null : variableReferences(text.slice(at.start, at.end), home);
  const texts = token.value.split(UNKNOWN);
  if (refs === null || refs.length !== texts.length - 1) return token.value;
  return texts.reduce((out, t, n) => {
    const value = n === 0 ? void 0 : values.get(refs[n - 1].name);
    return out + (n === 0 ? "" : typeof value === "string" ? value : UNKNOWN) + t;
  }, "");
}
function record(values, token, text, home) {
  if (token.kind !== "word") return;
  const assigned = ASSIGNMENT3.exec(token.value);
  if (assigned === null) return;
  const value = filled(token, text, values, home);
  values.set(assigned[1], wordReadsFile(token) ? FROM_FILE : /[[+]/.test(assigned[0]) ? UNREAD : value.slice(value.indexOf("=") + 1));
}
function programIndex(words, from) {
  let i = from;
  for (let n = 0; n < 64 && i < words.length; n++) {
    const spec = WRAPPER_WORDS.get(words[i]);
    if (spec === void 0) return i;
    i++;
    let operands2 = spec.operands ?? 0;
    while (i < words.length) {
      const w = words[i];
      if (w === "--") {
        i++;
        break;
      }
      if (w.length > 1 && w.startsWith("-") && !w.includes(UNKNOWN)) i += spec.values.includes(w) ? 2 : 1;
      else if (spec.assignments === true && ASSIGNMENT3.test(w)) i++;
      else if (operands2-- > 0) i++;
      else break;
    }
  }
  return i;
}
function valueVerdict(value, cwd, command, call) {
  const pieces = value.split(/\s+/).filter(Boolean);
  const unknown = value.includes(UNKNOWN);
  const hook = pieces.some((p) => wordNamesHook(p, cwd, true, call.home) || p.includes(UNKNOWN) && HOOK_HINT.test(p));
  if (unknown && piecesSet(value)) return "hook";
  if (!hook) return "ok";
  const sets = pieces.some(isEnvPiece) || !unknown && setsRefusedVariable(value, 0, call) || setsRefusedVariable(command, 0, call);
  return sets ? "hook" : "ok";
}
function programVerdict(token, after, text, values, cwd, command, call) {
  if (token.kind !== "word" || !token.value.includes(UNKNOWN) && !token.value.startsWith("$=")) return "ok";
  if (wordReadsFile(token)) return "unreadable";
  const at = sourceOf(token);
  if (text === null || at === void 0) return "ok";
  const raw = text.slice(at.start, at.end);
  if (/^"?(?:\$\(|`)/.test(raw)) return lineNamesHook(command, cwd, call.home) ? "unreadable" : "ok";
  if (raw.includes("${!")) return "unreadable";
  const split2 = SPLIT_REF.exec(raw);
  const leading = split2 === null ? LEADING_REF.exec(raw) : null;
  const withDefault = split2 === null && leading === null ? DEFAULT_REF.exec(raw) : null;
  const withRest = split2 === null && leading === null && withDefault === null ? SERVED_ROOT.exec(raw) : null;
  const name = split2?.[1] ?? split2?.[2] ?? leading?.[1] ?? leading?.[2] ?? withDefault?.[1] ?? withRest?.[1];
  if (withDefault !== null && /[$`"'\\(<]/.test(withDefault[2])) return lineNamesHook(command, cwd, call.home) ? "unreadable" : "ok";
  if (name === void 0) return OTHER_OPERATOR.test(raw) && lineNamesHook(command, cwd, call.home) ? "unreadable" : "ok";
  const value = values.get(name);
  const quoted = raw.startsWith('"');
  if (value === FROM_FILE && !quoted) return "unreadable";
  if (value === UNREAD || value === FROM_FILE && after.length > 0) return lineNamesHook(command, cwd, call.home) ? "unreadable" : "ok";
  if (value === FROM_FILE) return "ok";
  const words = " " + after.map((w) => filled(w, text, values, call.home)).join(" ");
  const trimmed = typeof value === "string" && withRest?.[3] !== void 0 ? value.replace(/\/$/, "") : value;
  const fallback = withDefault?.[2] ?? withRest?.[2];
  const readings = [...typeof trimmed === "string" ? [trimmed] : [], ...fallback !== void 0 ? [fallback] : []];
  const rest = leading !== null && token.value.startsWith(UNKNOWN) ? token.value.slice(UNKNOWN.length) : withRest?.[4] ?? "";
  return readings.some((r) => valueVerdict(r + rest + words, cwd, command, call) === "hook") ? "hook" : "ok";
}
function lineNamesHook(command, cwd, home) {
  return PLUGIN_HOOK.test(command) || command.replace(/['"]/g, "").split(/[\s;&|()<>]+/).some((p) => p !== "" && wordNamesHook(p, cwd, true, home));
}
function scanPrograms(tokens, text, values, cwd, command, call) {
  let worst = "ok";
  let words = [];
  let redirects = [];
  let array = null;
  const worse2 = (verdict) => {
    if (verdict === "hook" || verdict === "unreadable" && worst === "ok") worst = verdict;
  };
  const flush = () => {
    const plain = words.map((w) => w.kind === "word" ? w.value : "");
    let i = 0;
    while (RESERVED.has(plain[i])) i++;
    const start = i;
    while (i < plain.length && ASSIGNMENT3.test(plain[i])) i++;
    if (i === plain.length) words.slice(start).forEach((w) => record(values, w, text, call.home));
    else {
      const name = plain[i];
      const operands2 = words.slice(i + 1).filter((w) => w.kind === "word" && !w.value.startsWith("-"));
      if (name === "read") {
        const here = redirects.find((r) => r.kind === "redirect" && r.op === "<<<");
        const file = redirects.some((r) => r.kind === "redirect" && r.op === "<");
        const heredoc = redirects.some((r) => r.kind === "redirect" && (r.op === "<<" || r.op === "<<-"));
        const value = file ? FROM_FILE : heredoc ? UNREAD : operands2.length === 1 && here?.kind === "redirect" && !here.target.includes(UNKNOWN) ? here.target : null;
        operands2.forEach((w) => w.kind === "word" && values.set(w.value, value));
      } else if (NAME_SETTERS2.has(name)) {
        operands2.forEach((w) => w.kind === "word" && ASSIGNMENT3.test(w.value) ? record(values, w, text, call.home) : w.kind === "word" && VARIABLE_NAME.test(w.value) && values.set(w.value, null));
      } else if (name === "mapfile" || name === "readarray") operands2.forEach((w) => w.kind === "word" && VARIABLE_NAME.test(w.value) && values.set(w.value, UNREAD));
      else if (UNREAD_SETTERS.has(name)) operands2.forEach((w) => w.kind === "word" && VARIABLE_NAME.test(w.value) && values.set(w.value, null));
      else if (name === "set" && plain.includes("--", i)) {
        const positional = words.slice(plain.indexOf("--", i) + 1).map((w) => filled(w, text, values, call.home)).join(" ");
        values.set("@", positional);
        values.set("*", positional);
      }
      const program = programIndex(plain, i);
      if (program < words.length) worse2(programVerdict(words[program], words.slice(program + 1), text, values, cwd, command, call));
    }
    words = [];
    redirects = [];
  };
  for (const token of tokens) {
    if (token.kind !== "op" && token.scripts !== void 0) for (const script of token.scripts) worse2(scanPrograms(script, text, values, cwd, command, call));
    if (array !== null) {
      if (token.kind === "word") array.words.push(token);
      else if (token.kind === "op" && token.value === ")") {
        const elements = array.words;
        values.set(array.name, elements.some(wordReadsFile) ? FROM_FILE : array.append ? null : elements.map((w) => filled(w, text, values, call.home)).join(" "));
        array = null;
      }
      continue;
    }
    const last = words[words.length - 1];
    const start = token.kind === "op" && token.value === "(" && last?.kind === "word" ? ARRAY_START.exec(last.value) : null;
    if (start !== null) {
      words.pop();
      array = { name: start[1], append: start[2] === "+", words: [] };
    } else if (token.kind === "op") flush();
    else if (token.kind === "redirect") redirects.push(token);
    else words.push(token);
  }
  flush();
  return worst;
}
function programHidden(part) {
  return part.program !== null && (part.program.includes(UNKNOWN) || part.program.startsWith("$="));
}
var lastScan = null;
function commandScan(command, cwd, home, sources) {
  if (lastScan !== null && lastScan.command === command && lastScan.cwd === cwd && lastScan.home === home && lastScan.sources === sources) return lastScan.verdict;
  const call = { home, sources: sourcesFor(command, sources) };
  const result = tokenize(command, home, new ReadBudget());
  const verdict = scanPrograms(result.tokens, command, /* @__PURE__ */ new Map(), cwd, command, call);
  lastScan = { command, cwd, home, sources, verdict };
  return verdict;
}
function isLaunchctlProgram(word) {
  if (word.includes(UNKNOWN)) return false;
  return hasGlobClass(word) || globMatches(word.slice(word.lastIndexOf("/") + 1), "launchctl");
}
function archOrLaunchctlRuns(part, home) {
  if (part.program === null || !(isArchProgram(part.program) || isLaunchctlProgram(part.program))) return false;
  const words = part.words.slice(1);
  const git = (w) => !w.includes(UNKNOWN) && globMatches(w.slice(w.lastIndexOf("/") + 1), "git");
  const first = words.findIndex((w) => !w.startsWith("-"));
  const starts = words.filter((w, i) => i === first || words[i - 1] === "--");
  return lineNamesHook(words.join(" "), part.cwd, home) || words.some(isEnvProgram) || starts.some(git) || optionsRefused(part.program, words, git);
}
function submitSetsProgram(words) {
  const sub = words[0];
  if (sub === void 0 || !(sub.includes(UNKNOWN) || hasGlobClass(sub) || globMatches(sub, "submit"))) return false;
  const last = words.lastIndexOf("--");
  return words.slice(1, last === -1 ? words.length : last).some((w) => /^-[A-Za-z]*p/.test(w));
}
var ARCH_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-arch", "-e", "-d"]);
function optionsRefused(program, words, git) {
  const arch = isArchProgram(program);
  if (isLaunchctlProgram(program) && submitSetsProgram(words)) return true;
  const values = [];
  let i = !arch && words[0] !== void 0 && !words[0].startsWith("-") ? 1 : 0;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === "--" || !w.startsWith("-") || w === "-") break;
    const attached = w.length > 2 && !w.startsWith("--") && (!arch || /^-[ed]/.test(w)) ? w.slice(2) : null;
    const takes = arch ? ARCH_VALUE_OPTIONS.has(w) : words[i + 1] !== void 0 && !words[i + 1].startsWith("-");
    const value = attached ?? (takes ? words[i + 1] : void 0);
    if (value !== void 0) {
      if (arch && /^-[ed]/.test(w) && value.includes(UNKNOWN)) return true;
      values.push(value);
    }
    if (attached === null && takes) i++;
  }
  return values.some(git);
}
var ARCH_LAUNCHCTL_REFUSAL = {
  rule: "protected-path",
  reason: "Refused: `arch` or `launchctl` runs another program here (an OSS hook script, env, git or a protected path) that the gate does not check through it. Run that program directly."
};
function checkArchLaunchctlMention(part, ...rest) {
  if (part.program === null || !(isArchProgram(part.program) || isLaunchctlProgram(part.program))) return null;
  const pieces = part.words.slice(1).flatMap((w) => [w, ...w.split(/[\s'"`;|&()<>]+/)]).filter((w) => w !== "");
  if (!pieces.some((w) => protectedPathNamed(w, part.cwd, ...rest) !== null)) return null;
  return ARCH_LAUNCHCTL_REFUSAL;
}
function checkOssHookEnv(part, command, home, sources) {
  if (programHidden(part)) {
    if (commandScan(command, part.cwd, home, sources) !== "ok") {
      return {
        rule: "protected-path",
        reason: "Refused: the program this command runs is read from a file or through indirection, which the gate can't see, or is a value the shell splits into words that run an OSS hook script (`~/.oss/hooks/\u2026`) with a variable set or cleared. Write the program name out."
      };
    }
  }
  if (archOrLaunchctlRuns(part, home)) return ARCH_LAUNCHCTL_REFUSAL;
  if (part.runBy !== void 0 && programHidden(part) && lineNamesHook(command, part.cwd, home)) return ARCH_LAUNCHCTL_REFUSAL;
  if (!partNamesHook(part, home) && !PLUGIN_HOOK.test(command)) return null;
  const clears = part.program !== null && isEnvProgram(part.program) || part.wrappers.some((w, i) => w === "env" || w === "exec" && part.wrapperOptions[i].some((o) => /^-[A-Za-z]*c/.test(o)));
  if (!clears && !setsRefusedVariable(command, 0, { home, sources: sourcesFor(command, sources) })) return null;
  return {
    rule: "protected-path",
    reason: "Refused: runs an OSS hook script (`~/.oss/hooks/\u2026`) with a HOME or PATH, or another variable, this command sets or changes (`X=`, `export`, `env`) that is not on the list of variables OSS's own commands set on a hook call. Run the hook script as it is, in a command that sets no other variable."
  };
}

// src/tool-gate/rules/protected-branch.ts
var import_node_fs15 = __toESM(require("node:fs"), 1);
var import_node_path25 = __toESM(require("node:path"), 1);
var BRANCH_REF_PREFIXES = ["refs/heads/", "heads/"];
function rawDestination(refspec) {
  const spec = refspec.startsWith("+") ? refspec.slice(1) : refspec;
  const colon = spec.indexOf(":");
  return colon === -1 ? spec : spec.slice(colon + 1);
}
function destination2(refspec) {
  const dst = rawDestination(refspec);
  const prefix = BRANCH_REF_PREFIXES.find((p) => dst.startsWith(p));
  return prefix === void 0 ? dst : dst.slice(prefix.length);
}
var REFSPEC_WILDCARD = "*";
function branchesOf(settings, caseInsensitive) {
  return { list: settings.protectedBranches, caseInsensitive };
}
function folded(name, branches) {
  return branches.caseInsensitive ? name.toLowerCase() : name;
}
function isProtected2(name, branches) {
  const wanted = folded(name, branches);
  return branches.list.some((b) => folded(b, branches) === wanted);
}
function wildcardNames(dst, branch, branches) {
  return [...BRANCH_REF_PREFIXES.map((p) => p + branch), branch].some((ref) => matchCommand(folded(dst, branches), [folded(ref, branches)]));
}
function protectedTarget(refspec, branches) {
  const raw = rawDestination(refspec);
  if (raw.includes(REFSPEC_WILDCARD)) return branches.list.some((b) => wildcardNames(raw, b, branches)) ? raw : void 0;
  const dst = destination2(refspec);
  return isProtected2(dst, branches) ? dst : void 0;
}
async function checkProtectedBranch(part, settings, git, branch = null, caseInsensitive = false) {
  const facts = part.git;
  if (!facts || facts.subcommand !== "commit" && facts.subcommand !== "push") return null;
  const command = `git ${facts.subcommand}`;
  const protectedList = settings.protectedBranches;
  const branches = branchesOf(settings, caseInsensitive);
  const current2 = branch ?? await git.currentBranch(facts.dir);
  if (current2 !== null && isProtected2(current2, branches)) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`${command}\` while on \`${current2}\`, a protected branch. Use a feature branch.`
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
  const target = positional.slice(1).map((spec) => protectedTarget(spec, branches)).find((dst) => dst !== void 0);
  if (target === void 0) return null;
  if (target.includes(REFSPEC_WILDCARD)) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`${command}\` to \`${target}\`, a wildcard that can name a protected branch (${protectedList.map((b) => `\`${b}\``).join(", ")}). Push one feature branch instead.`
    };
  }
  return {
    rule: "protected-branch",
    reason: `Refused: \`${command}\` to \`${target}\`, a protected branch. Push a feature branch and open a PR.`
  };
}
function namesProtected(word, branches) {
  if (word.includes(UNKNOWN)) return true;
  const prefix = BRANCH_REF_PREFIXES.find((p) => word.startsWith(p));
  return isProtected2(prefix === void 0 ? word : word.slice(prefix.length), branches);
}
var PREVIOUS_BRANCH = /^(?:-|@\{-[0-9]+\})$/;
var NEW_BRANCH_OPTIONS = /* @__PURE__ */ new Set(["-b", "-B", "-c", "-C", "--create", "--force-create", "--orphan"]);
var TRACK_OPTIONS = /^(?:-t|--track(?:=.*)?)$/;
var REMOTE_PREFIX = /^(?:refs\/remotes\/|remotes\/)?[^/]+\//;
function switchedTo(git, branches) {
  const args = git.args;
  const words = [];
  let track = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      if (i + 1 < args.length) return null;
      break;
    }
    if (NEW_BRANCH_OPTIONS.has(a)) {
      const name = args[++i];
      if (name !== void 0 && namesProtected(name, branches)) return name;
    } else if (TRACK_OPTIONS.test(a)) {
      track = true;
    } else if (!a.startsWith("-") || PREVIOUS_BRANCH.test(a)) {
      words.push(a);
    }
  }
  if (git.subcommand === "checkout" && words.length > 1) return null;
  const target = words[0];
  if (target === void 0) return null;
  if (PREVIOUS_BRANCH.test(target) || target.startsWith("@{-") || namesProtected(target, branches)) return target;
  return track && namesProtected(target.replace(REMOTE_PREFIX, ""), branches) ? target : null;
}
function checkBranchSwitch(part, parts, index, settings, exists = existsOnDisk, caseInsensitive = false) {
  const sub = part.git?.subcommand;
  if (sub !== "commit" && sub !== "push" && (part.git === null || historyMove(part.git, exists) === null)) return null;
  const branches = branchesOf(settings, caseInsensitive);
  for (let i = 0; i < index; i++) {
    const git = parts[i].git;
    if (git === null) continue;
    let target = null;
    if (git.subcommand === "checkout" || git.subcommand === "switch") target = switchedTo(git, branches);
    else if (git.subcommand === "symbolic-ref") target = symbolicTarget(git.args, branches);
    if (target === null) continue;
    if (sub === "pull" && part.git !== null && ownUpstream(part.git, target, branches, exists)) continue;
    return {
      rule: "protected-branch",
      reason: `Refused: \`git ${sub}\` runs after \`git ${git.subcommand} ${target}\` in the same call, which can put it on a protected branch. Run it in a separate call.`
    };
  }
  return null;
}
var SYMBOLIC_REF_VALUES = /* @__PURE__ */ new Set(["-m"]);
function positionalsOf(args, values) {
  const words = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return [...words, ...args.slice(i + 1)];
    if (values.has(a)) i++;
    else if (!a.startsWith("-")) words.push(a);
  }
  return words;
}
function symbolicTarget(args, branches) {
  const [name, target] = positionalsOf(args, SYMBOLIC_REF_VALUES);
  if (target !== void 0) return namesProtected(target, branches) ? target : null;
  const deletes = args.some((a) => a === "-d" || a === "--delete");
  return deletes && name !== void 0 && namesProtected(name, branches) ? name : null;
}
var BRANCH_MODE_LETTERS = /^-[A-Za-z]*[dDmMcCf]/;
var BRANCH_MODE_LONG = /* @__PURE__ */ new Set(["--delete", "--move", "--copy", "--force"]);
var BRANCH_VALUES2 = /* @__PURE__ */ new Set(["--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format", "-u", "--set-upstream-to"]);
function refChange(command, branch) {
  return {
    rule: "protected-branch",
    reason: `Refused: \`${command}\` changes \`${branch}\`, a protected branch. Ask the user to run it with \`!\`.`
  };
}
async function checkBranchRefs(part, settings, git, caseInsensitive = false) {
  const facts = part.git;
  if (facts === null) return null;
  const branches = branchesOf(settings, caseInsensitive);
  const { subcommand, args } = facts;
  if (subcommand === "update-ref") {
    return { rule: "protected-branch", reason: "Refused: `git update-ref` writes a ref directly, without the history git keeps for it. Ask the user to run it with `!`." };
  }
  if (subcommand === "replace" && !replaceLists(args)) {
    return { rule: "protected-branch", reason: "Refused: `git replace` changes which commits git shows, without a ref change. Ask the user to run it with `!`." };
  }
  if (subcommand === "reflog" && REFLOG_CHANGES.has(args[0])) {
    return { rule: "protected-branch", reason: `Refused: \`git reflog ${args[0]}\` changes or erases the ref history a lost commit is found by. Ask the user to run it with \`!\`.` };
  }
  if (subcommand === "symbolic-ref") {
    const [name, pointed] = positionalsOf(args, SYMBOLIC_REF_VALUES);
    const writes = pointed !== void 0 || args.some((a) => a === "-d" || a === "--delete");
    if (writes && name !== void 0 && remoteTracking(name, false)) return REMOTE_TRACKING_REFUSAL;
    const target = symbolicTarget(args, branches);
    return target === null ? null : refChange(`git symbolic-ref \u2026 ${target}`, target);
  }
  if (subcommand === "checkout" || subcommand === "switch") {
    const reset = forceCreated(args).find((name) => namesProtected(name, branches));
    return reset === void 0 ? null : refChange(`git ${subcommand} ${args.join(" ")}`, reset);
  }
  if (subcommand === "rebase") {
    const rebased = rebasedBranch(args, branches);
    return rebased === void 0 ? null : refChange(`git rebase ${args.join(" ")}`, rebased);
  }
  if (subcommand === "worktree") {
    const created = worktreeBranch(args, branches);
    return created === void 0 ? null : refChange(`git worktree ${args.join(" ")}`, created);
  }
  if (subcommand === "remote") {
    const at = args.findIndex((a) => !a.startsWith("-"));
    if (args[at] === "set-head" && !args.slice(at + 1).some((a) => SET_HEAD_GIT_DECIDES.has(a))) return REMOTE_TRACKING_REFUSAL;
  }
  const forged = remoteRefForge(facts);
  if (forged !== null) return forged;
  if (subcommand === "fetch") {
    const target = positionalsOf(args, FETCH_VALUES).slice(1).filter((spec) => spec.includes(":")).map((spec) => protectedTarget(spec, branches)).find((dst) => dst !== void 0);
    return target === void 0 ? null : refChange(`git fetch ${args.join(" ")}`, target);
  }
  if (subcommand !== "branch") return null;
  const mode = args.find((a) => !a.startsWith("--") && BRANCH_MODE_LETTERS.test(a) || BRANCH_MODE_LONG.has(a));
  if (mode === void 0) return null;
  const named2 = positionalsOf(args, BRANCH_VALUES2).find((w) => namesProtected(w, branches));
  return named2 === void 0 ? null : refChange(`git branch ${mode} \u2026 ${named2}`, named2);
}
function replaceLists(args) {
  const listing = args.includes("-l") || args.includes("--list");
  const options = args.filter((a) => a.startsWith("-"));
  const patterns = args.length - options.length;
  return options.every((a) => a === "-l" || a === "--list" || a.startsWith("--format=")) && (patterns === 0 || listing && patterns === 1);
}
function readOptions(args, spec) {
  const values = [];
  const operands2 = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") {
      operands2.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const long = spec.valueLongs.find((o) => longOption(a, o.full, o.shortest));
      const value = long === void 0 ? void 0 : a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      if (long !== void 0 && value !== void 0) values.push([long.full, value]);
    } else if (a.startsWith("-") && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        if (spec.restLetters?.has(a[j]) === true) break;
        if (!spec.valueLetters.has(a[j])) continue;
        const value = j + 1 < a.length ? a.slice(j + 1) : args[++i];
        if (value !== void 0) values.push([`-${a[j]}`, value]);
        break;
      }
    } else {
      operands2.push(a);
    }
  }
  return { values, operands: operands2 };
}
var SWITCH_OPTIONS = {
  valueLetters: /* @__PURE__ */ new Set(["b", "B", "c", "C", "U"]),
  valueLongs: [
    { full: "--force-create", shortest: 8 },
    { full: "--create", shortest: 4 },
    { full: "--orphan", shortest: 4 },
    { full: "--conflict", shortest: 5 },
    { full: "--pathspec-from-file", shortest: 4 }
  ]
};
var FORCE_CREATE = /* @__PURE__ */ new Set(["-B", "-C", "--force-create"]);
function forceCreated(args) {
  return readOptions(args, SWITCH_OPTIONS).values.filter(([option]) => FORCE_CREATE.has(option)).map(([, name]) => name);
}
var REBASE_OPTIONS = {
  valueLetters: /* @__PURE__ */ new Set(["C", "x", "s", "X"]),
  restLetters: /* @__PURE__ */ new Set(["S", "r"]),
  valueLongs: [
    { full: "--onto", shortest: 3 },
    { full: "--exec", shortest: 4 },
    { full: "--strategy-option", shortest: 5 },
    { full: "--trailer", shortest: 3 },
    { full: "--whitespace", shortest: 3 },
    { full: "--empty", shortest: 4 }
  ]
};
var REBASE_ROOT = { full: "--root", shortest: 4 };
function rebasedBranch(args, branches) {
  const root = args.some((a) => a.startsWith("--") && longOption(a, REBASE_ROOT.full, REBASE_ROOT.shortest));
  return readOptions(args, REBASE_OPTIONS).operands.slice(root ? 0 : 1).find((w) => namesProtected(w, branches));
}
var WORKTREE_ADD_OPTIONS = { valueLetters: /* @__PURE__ */ new Set(["b", "B"]), valueLongs: [{ full: "--reason", shortest: 5 }] };
function worktreeBranch(args, branches) {
  if (args[0] !== "add") return void 0;
  return readOptions(args.slice(1), WORKTREE_ADD_OPTIONS).values.filter(([option]) => WORKTREE_ADD_OPTIONS.valueLetters.has(option.slice(1))).map(([, name]) => name).find((name) => namesProtected(name, branches));
}
var FETCH_VALUES = /* @__PURE__ */ new Set([
  "--depth",
  "--deepen",
  "--shallow-since",
  "--shallow-exclude",
  "-j",
  "--jobs",
  "--upload-pack",
  "-o",
  "--server-option",
  "--negotiation-tip",
  "--refmap",
  "--filter"
]);
var FETCH_REFMAP = { valueLetters: /* @__PURE__ */ new Set(), valueLongs: [{ full: "--refmap", shortest: 6 }] };
var REMOTE_TRACKING = /^(?:refs\/)?remotes\//;
var SAMPLE_REPLACE_REF = "refs/replace/0123456789012345678901234567890123456789";
function replaceRef(ref) {
  const lower = ref.split(UNKNOWN)[0].toLowerCase();
  return lower.startsWith("refs/replace/") || lower.includes(REFSPEC_WILDCARD) && matchCommand(lower, [SAMPLE_REPLACE_REF]);
}
var SAMPLE_REMOTE_TRACKING_REF = "refs/remotes/r/b";
function remoteTracking(ref, wildcards) {
  const lower = ref.split(UNKNOWN)[0].toLowerCase();
  return REMOTE_TRACKING.test(lower) || wildcards && lower.includes(REFSPEC_WILDCARD) && matchCommand(lower, [SAMPLE_REMOTE_TRACKING_REF]);
}
var FILE_URL = /^file:\/\//i;
var URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
function isLocalUrl(url) {
  if (FILE_URL.test(url)) return true;
  if (oddHost(url)) return true;
  if (loopbackHost(urlHost(url))) return true;
  if (URL_SCHEME.test(url)) return false;
  const colon = url.indexOf(":");
  const unknown = url.indexOf(UNKNOWN);
  if (unknown !== -1 && (colon === -1 || unknown < colon)) return true;
  return colon === -1 || url.slice(0, colon).includes("/");
}
function oddHost(url) {
  const scheme = /^(?:ssh|git\+ssh|ssh\+git|git):\/\//i.exec(url);
  let host;
  if (scheme !== null) {
    const rest = url.slice(scheme[0].length);
    host = rest.slice(0, rest.search(/\/|$/));
  } else {
    const colon = url.indexOf(":");
    if (URL_SCHEME.test(url) || colon === -1 || url.slice(0, colon).includes("/")) return false;
    host = url.slice(0, colon);
  }
  return /[[%]/.test(host) || host.split("@").length > 2;
}
function percentDecoded(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/%[0-9A-Fa-f]{2}/g, (e) => String.fromCharCode(parseInt(e.slice(1), 16)));
  }
}
function urlHost(url) {
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(url);
  const ssh = scheme !== null && /^(?:ssh|git\+ssh|ssh\+git):\/\/$/i.test(scheme[0]);
  const decodedFirst = ssh || scheme !== null && /^git:\/\/$/i.test(scheme[0]);
  const rest = scheme === null ? url : decodedFirst ? percentDecoded(url.slice(scheme[0].length)) : url.slice(scheme[0].length);
  const end = ssh ? /\/|$/ : /[/?#]|$/;
  const written = scheme === null ? /^(?:[^@/:[\]]*@)?\[[^\]]*\]|^[^:/]*/.exec(rest)?.[0] ?? "" : rest.slice(0, rest.search(end));
  const authority = decodedFirst ? written : percentDecoded(written);
  const bracketFirst = scheme === null || ssh;
  if (bracketFirst && authority.startsWith("[") && authority.includes("]")) return authority.slice(1, authority.indexOf("]")).replace(/^.*@/, "");
  const host = authority.replace(/^.*@/, "");
  return host.startsWith("[") ? host.slice(1, host.includes("]") ? host.indexOf("]") : void 0) : host.replace(/:.*$/, "");
}
function loopbackHost(raw) {
  let host = raw;
  try {
    host = decodeURIComponent(raw);
  } catch {
  }
  host = host.toLowerCase().replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.includes(":")) return loopbackIpv6(host);
  const v4 = ipv4Number(host);
  return v4 !== null && localIpv4(v4);
}
function localIpv4(value) {
  return value >>> 24 === 127 || value === 0;
}
function ipv4Number(host) {
  const parts = host.split(".");
  if (parts.length > 4) return null;
  const values = [];
  for (const part of parts) {
    const value = /^0x[0-9a-f]*$/.test(part) ? parseInt(part.slice(2) || "0", 16) : /^0[0-7]*$/.test(part) ? parseInt(part, 8) : /^[1-9][0-9]*$/.test(part) ? Number(part) : NaN;
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  const last = values.pop();
  if (values.some((v) => v > 255) || last >= 2 ** (8 * (4 - values.length))) return null;
  return values.reduce((sum, v, i) => sum + v * 2 ** (8 * (3 - i)), 0) + last;
}
function loopbackIpv6(host) {
  let text = host.replace(/%.*$/, "");
  const tail = /(?:^|:)([0-9.]+\.[0-9.]+)$/.exec(text);
  if (tail !== null) {
    const v42 = ipv4Number(tail[1]);
    if (v42 === null) return false;
    text = `${text.slice(0, text.length - tail[1].length)}${(v42 >>> 16).toString(16)}:${(v42 & 65535).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return false;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const rest = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return false;
  const groups = [...head, ...Array(8 - head.length - rest.length).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return false;
  const n = groups.map((g) => parseInt(g, 16));
  const v4 = n[6] * 65536 + n[7];
  if (n.slice(0, 7).every((g) => g === 0) && n[7] <= 1) return true;
  return n.slice(0, 5).every((g) => g === 0) && (n[5] === 65535 || n[5] === 0) && localIpv4(v4);
}
function realOrNull2(p) {
  try {
    return import_node_fs15.default.realpathSync(p);
  } catch {
    return null;
  }
}
function selfRemote(word, dir) {
  if (word.includes(UNKNOWN) || !isLocalUrl(word)) return false;
  const here = findRepo(dir);
  if (here.kind !== "repo") return false;
  const common = realOrNull2(here.commonDir);
  const own = new Set([here.top, here.gitDir, here.commonDir].map(realOrNull2));
  const spelled = word.replace(FILE_URL, "");
  for (const base of [dir, here.top]) {
    const target = import_node_path25.default.resolve(base, spelled);
    for (const candidate of [target, import_node_path25.default.join(target, ".git"), `${target}.git`]) {
      const real = realOrNull2(candidate);
      if (real === null) continue;
      if (own.has(real)) return true;
      const there = findRepo(candidate);
      if (there.kind === "repo" && there.top === real && realOrNull2(there.commonDir) === common) return true;
    }
  }
  return false;
}
var SET_HEAD_GIT_DECIDES = /* @__PURE__ */ new Set(["-a", "--auto", "-d", "--delete"]);
var SELF_REMOTE_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: this `git fetch` / `git push` names the repository itself (or one of its worktrees) as the remote, which can write any of its refs, remote-tracking ones included. Ask the user to run it with `!`."
};
var REPLACE_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: this git call writes a replace ref (under refs/replace/), which changes which commits git shows. Ask the user to run it with `!`."
};
var REMOTE_TRACKING_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: this git call writes a remote-tracking ref (under refs/remotes/), which the ship base is read from. Let a plain `git fetch` update those refs."
};
function remoteRefForge(facts) {
  const { subcommand, args, dir } = facts;
  if (subcommand !== "fetch" && subcommand !== "push" && subcommand !== "pull") return null;
  const words = subcommand === "push" ? readPushWords(args).positional : positionalsOf(args, subcommand === "fetch" ? FETCH_VALUES : PULL_VALUES);
  const [repo, ...specs] = words;
  if (subcommand !== "pull" && repo !== void 0 && selfRemote(repo, dir)) return SELF_REMOTE_REFUSAL;
  const maps = subcommand === "fetch" ? readOptions(args, FETCH_REFMAP).values.map(([, map]) => map) : [];
  if (subcommand !== "push" && [...specs, ...maps].some((spec) => spec.includes(":") && replaceRef(rawDestination(spec)))) return REPLACE_REFUSAL;
  const explicit = specs.filter((spec) => subcommand === "push" || spec.includes(":") && !defaultMapping(repo, spec, dir));
  const destinations = [...explicit, ...maps.filter((map) => map.includes(":"))];
  return destinations.some((spec) => remoteTracking(rawDestination(spec), subcommand !== "push")) ? REMOTE_TRACKING_REFUSAL : null;
}
function defaultMapping(remote, spec, dir) {
  if (remote === void 0 || !REMOTE_NAME.test(remote) || existsOnDisk(import_node_path25.default.resolve(dir, remote)) || !configuredRemote(remote, dir)) return false;
  const plain = spec.startsWith("+") ? spec.slice(1) : spec;
  if (plain.includes(REFSPEC_WILDCARD) || plain.includes(UNKNOWN)) return false;
  const colon = plain.indexOf(":");
  const branch = plain.slice(0, colon).replace(/^(?:refs\/heads\/|heads\/)/, "");
  return branch !== "" && plain.slice(colon + 1) === `refs/remotes/${remote}/${branch}`;
}
var MAX_CONFIG_BYTES = 1024 * 1024;
var REMOTE_SECTION = /^\s*\[\s*remote\s+"([^"\\]*)"\s*\]/i;
function configuredRemote(name, dir) {
  const here = findRepo(dir);
  if (here.kind !== "repo") return false;
  const read = readRegularFile(import_node_path25.default.join(here.commonDir, "config"), MAX_CONFIG_BYTES, true);
  if (typeof read === "string" || /^\s*\[\s*include/im.test(read.text)) return false;
  return read.text.split("\n").some((line) => REMOTE_SECTION.exec(line)?.[1] === name);
}
function trustForCall(trustOf) {
  const known = /* @__PURE__ */ new Map();
  return (dir) => {
    if (isTooLong(dir)) throw new OverBudget("git runs in a folder path over 4096 characters or 512 folders");
    const trust = known.get(dir) ?? trustOf(dir);
    known.set(dir, trust);
    return trust;
  };
}
function checkRepoTrust(part, trustOf) {
  const facts = part.git;
  if (facts === null || facts.subcommand !== "commit" && facts.subcommand !== "push") return null;
  const trust = trustOf(facts.dir);
  if (trust === "trusted" || trust === "none") return null;
  return {
    rule: "protected-branch",
    reason: `Refused: \`git ${facts.subcommand}\` runs in a repository the gate can't vouch for (${trust.untrusted}), so it can't tell which branch it is on or where it pushes. Ask the user to run it with \`!\`.`
  };
}
function existsOnDisk(absPath) {
  return import_node_fs15.default.lstatSync(absPath, { throwIfNoEntry: false }) !== void 0;
}
var HISTORY_MOVERS = /* @__PURE__ */ new Set(["merge", "rebase", "cherry-pick", "revert", "am"]);
var STOPS_WITHOUT_MOVING = /* @__PURE__ */ new Set(["--abort", "--quit", "--edit-todo", "--show-current-patch"]);
var NO_COMMIT = /^(?:-n|--no-commit|-(?=[A-Za-z]*n)[A-Za-z]+)$/;
var RESET_VALUES = /* @__PURE__ */ new Set(["--pathspec-from-file"]);
var RESET_PATHS_ONLY = /^(?:-p|--patch|--pathspec-from-file(?:=.*)?)$/;
var HEAD_NAMES = /* @__PURE__ */ new Set(["HEAD", "@"]);
var PATHSPEC_ONLY = /[*?[]|^:/;
function resetMoves(args, dir, exists) {
  if (args.some((a) => RESET_PATHS_ONLY.test(a))) return false;
  const dash = args.indexOf("--");
  const before = positionalsOf(dash === -1 ? args : args.slice(0, dash), RESET_VALUES);
  const after = dash === -1 ? [] : args.slice(dash + 1);
  if (before.length !== 1 || after.length > 0) return false;
  const [target] = before;
  if (HEAD_NAMES.has(target)) return false;
  if (dash !== -1) return true;
  return !PATHSPEC_ONLY.test(target) && !exists(import_node_path25.default.resolve(dir, target));
}
var BRANCH_RENAME = /^(?:-(?=[A-Za-z]*[mM])[A-Za-z]+|--move)$/;
function historyMove(git, exists) {
  const { subcommand: sub, args } = git;
  if (HISTORY_MOVERS.has(sub)) {
    if (args.some((a) => STOPS_WITHOUT_MOVING.has(a))) return null;
    if ((sub === "cherry-pick" || sub === "revert") && args.some((a) => NO_COMMIT.test(a))) return null;
    return `git ${sub}`;
  }
  if (sub === "reset") return resetMoves(args, git.dir, exists) ? `git reset ${args.join(" ")}` : null;
  if (REWRITERS.has(sub)) return `git ${sub}`;
  if (sub === "reflog" && REFLOG_DROPS.has(args[0]) || sub === "subtree" && SUBTREE_MOVES.has(args[0])) return `git ${sub} ${args[0]}`;
  if (sub === "pull" && positionalsOf(args, PULL_VALUES).length > 0) return `git pull ${args.join(" ")}`;
  if (sub === "branch" && args.some((a) => BRANCH_RENAME.test(a)) && positionalsOf(args, BRANCH_VALUES2).length === 1) {
    return `git branch ${args.join(" ")}`;
  }
  return null;
}
var REWRITERS = /* @__PURE__ */ new Set(["filter-branch", "filter-repo", "fast-import", "replace"]);
var REFLOG_DROPS = /* @__PURE__ */ new Set(["delete", "expire"]);
var REFLOG_CHANGES = /* @__PURE__ */ new Set([...REFLOG_DROPS, "drop", "write"]);
var SUBTREE_MOVES = /* @__PURE__ */ new Set(["merge", "pull"]);
var EVERY_BRANCH = /* @__PURE__ */ new Set(["--all", "--branches"]);
var REFLOG_ENTRY = /@\{[^}]*\}$/;
function namedRewrite(git, branches) {
  const { subcommand: sub, args } = git;
  if (!REWRITERS.has(sub) && sub !== "reflog") return null;
  if (sub === "filter-repo" && !args.some((a) => a === "--refs" || a.startsWith("--refs="))) return "every branch";
  const named2 = args.find((a) => EVERY_BRANCH.has(a) || namesProtected(a.replace(/^\+/, "").replace(REFLOG_ENTRY, "").replace(/^--refs=/, ""), branches));
  return named2 ?? null;
}
var PULL_VALUES = /* @__PURE__ */ new Set([
  "-s",
  "--strategy",
  "-X",
  "--strategy-option",
  "--depth",
  "--deepen",
  "--shallow-since",
  "--shallow-exclude",
  "-j",
  "--jobs",
  "--upload-pack",
  "-o",
  "--server-option",
  "--negotiation-tip"
]);
var REMOTE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
function ownUpstream(git, branch, branches, exists) {
  const [repo, ...specs] = positionalsOf(git.args, PULL_VALUES);
  if (repo === void 0) return true;
  if (!REMOTE_NAME.test(repo) || exists(import_node_path25.default.resolve(git.dir, repo))) return false;
  const name = (ref) => folded(ref.replace(/^(?:refs\/heads\/|heads\/)/, ""), branches);
  return specs.every((spec) => !spec.includes(":") && !spec.startsWith("+") && name(spec) === name(branch));
}
async function checkHistoryMove(part, settings, git, created = null, exists = existsOnDisk, caseInsensitive = false) {
  const facts = part.git;
  if (facts === null) return null;
  const command = historyMove(facts, exists);
  if (command === null) return null;
  const branches = branchesOf(settings, caseInsensitive);
  const named2 = namedRewrite(facts, branches);
  if (named2 !== null) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`${command}\` names \`${named2}\`, which can rewrite a protected branch's history. Ask the user to run it with \`!\`.`
    };
  }
  if (part.lostDir !== null && created === null) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`${command}\` runs after \`${part.lostDir.why}\`, in a folder the gate can't follow, so it can't tell whether it moves a protected branch. Run it after a \`cd\` to a plain path.`
    };
  }
  const current2 = created ?? await git.currentBranch(facts.dir);
  if (current2 === null || !isProtected2(current2, branches)) return null;
  if (facts.subcommand === "pull" && ownUpstream(facts, current2, branches, exists)) return null;
  return {
    rule: "protected-branch",
    reason: `Refused: \`${command}\` while on \`${current2}\`, a protected branch, moves its history. Use a feature branch.`
  };
}

// src/tool-gate/rules/push-setup.ts
var BRANCH_SWITCHES = /* @__PURE__ */ new Set(["checkout", "switch", "symbolic-ref", "worktree", "init", "clone"]);
var BRANCH_SETUP_SHORT = /^-[A-Za-z]*[mMut]/;
var BRANCH_SETUP_LONG = ["--move", "--set-upstream-to", "--track"];
var REMOTE_WRITES = /* @__PURE__ */ new Set(["add", "rename", "remove", "rm", "set-url"]);
var PUSH_KEYS = [
  // where and what a push sends
  "push.*",
  "remote.pushdefault",
  "remote.*.push",
  "remote.*.url",
  "remote.*.pushurl",
  "remote.*.mirror",
  "remote.*.fetch",
  "remote.*.receivepack",
  "remote.*.uploadpack",
  "remote.*.vcs",
  "branch.*.merge",
  "branch.*.remote",
  "branch.*.pushremote",
  "url.*.insteadof",
  "url.*.pushinsteadof",
  // other config files, and the repository's work tree
  "include.path",
  "includeif.*.path",
  "core.worktree",
  // commands git runs
  "alias.*",
  "core.hookspath",
  "core.sshcommand",
  "core.gitproxy",
  "core.askpass",
  "core.fsmonitor",
  "core.editor",
  "core.pager",
  "pager.*",
  "sequence.editor",
  "diff.external",
  "diff.*.command",
  "diff.*.textconv",
  "filter.*",
  "merge.*.driver",
  "gpg.program",
  "gpg.*.program",
  "uploadpack.packobjectshook",
  "difftool.*.cmd",
  "mergetool.*.cmd",
  "web.browser",
  "browser.*.cmd",
  "browser.*.path",
  "man.*.cmd",
  "man.*.path"
];
var CONFIG_FILE_OPTIONS2 = [
  { name: "global", negatable: true },
  { name: "system", negatable: true },
  { name: "local", negatable: true },
  { name: "worktree", negatable: true },
  { name: "file", letter: "f", value: true, negatable: true },
  { name: "blob", value: true, negatable: true }
];
var CONFIG_DISPLAY_OPTIONS = [
  { name: "null", letter: "z", negatable: true },
  { name: "name-only", negatable: true },
  { name: "show-origin", negatable: true },
  { name: "show-scope", negatable: true },
  { name: "show-names", negatable: true }
];
var CONFIG_TYPE_OPTIONS = [
  { name: "type", letter: "t", value: true, negatable: true },
  { name: "bool" },
  { name: "int" },
  { name: "bool-or-int" },
  { name: "bool-or-str" },
  { name: "path" },
  { name: "expiry-date" }
];
var CONFIG_LEGACY_ACTIONS = [
  ...["get", "get-all", "get-regexp", "get-urlmatch", "get-color", "get-colorbool"].map((name) => ({ name, action: "read" })),
  { name: "list", letter: "l", action: "read" },
  ...["add", "replace-all", "unset", "unset-all"].map((name) => ({ name, action: "write" })),
  { name: "edit", letter: "e", action: "write" },
  { name: "rename-section", action: "section" },
  { name: "remove-section", action: "section" }
];
var negatableFlag = (name) => ({ name, negatable: true });
var negatableValue = (name) => ({ name, value: true, negatable: true });
var CONFIG_FORMS = /* @__PURE__ */ new Map([
  [null, [
    ...CONFIG_FILE_OPTIONS2,
    ...CONFIG_LEGACY_ACTIONS,
    ...CONFIG_DISPLAY_OPTIONS,
    ...CONFIG_TYPE_OPTIONS,
    negatableValue("default"),
    negatableValue("comment"),
    negatableFlag("fixed-value"),
    negatableFlag("includes")
  ]],
  ["get", [
    ...CONFIG_FILE_OPTIONS2,
    ...CONFIG_DISPLAY_OPTIONS,
    ...CONFIG_TYPE_OPTIONS,
    negatableFlag("includes"),
    negatableFlag("all"),
    negatableFlag("regexp"),
    negatableValue("value"),
    negatableFlag("fixed-value"),
    negatableValue("url"),
    negatableValue("default")
  ]],
  ["set", [
    ...CONFIG_FILE_OPTIONS2,
    ...CONFIG_TYPE_OPTIONS,
    negatableFlag("all"),
    negatableValue("value"),
    negatableFlag("fixed-value"),
    negatableValue("comment"),
    negatableFlag("append")
  ]],
  ["unset", [...CONFIG_FILE_OPTIONS2, negatableFlag("all"), negatableValue("value"), negatableFlag("fixed-value")]],
  ["list", [...CONFIG_FILE_OPTIONS2, ...CONFIG_DISPLAY_OPTIONS, ...CONFIG_TYPE_OPTIONS, negatableFlag("includes")]],
  ["rename-section", CONFIG_FILE_OPTIONS2],
  ["remove-section", CONFIG_FILE_OPTIONS2],
  ["edit", CONFIG_FILE_OPTIONS2]
]);
var CONFIG_READ_VERBS = /* @__PURE__ */ new Set(["get", "list"]);
var CONFIG_SECTION_VERBS = /* @__PURE__ */ new Set(["rename-section", "remove-section"]);
var PUSH_GLOBAL_OPTIONS = ["-c", "--config-env", "--git-dir", "--work-tree"];
var GIT_REPO_VARIABLE = /^GIT_(?:DIR|WORK_TREE|CONFIG.*)$/;
var GIT_SETUP_VARIABLE = /^(?:GIT_[A-Za-z0-9_]*|HOME|XDG_CONFIG_HOME)$/;
function setupVariable(name) {
  return GIT_SETUP_VARIABLE.test(name) && !SAFE_GIT_VARIABLE.test(name);
}
var QUIET = /* @__PURE__ */ new Set(["-q", "--quiet"]);
var CREATE_OPTIONS = /* @__PURE__ */ new Map([
  ["checkout", ["-b"]],
  ["switch", ["-c", "--create"]]
]);
function createdBranchStart(part) {
  const git = part.git;
  if (git === null) return null;
  const create = CREATE_OPTIONS.get(git.subcommand);
  const args = git.args.filter((a) => !QUIET.has(a));
  if (create === void 0 || !create.includes(args[0]) || args.length < 2 || args.length > 3) return null;
  const [, name, start] = args;
  if (name.startsWith("-") || name.includes(UNKNOWN) || start?.startsWith("-") === true) return null;
  return { name, start };
}
function createdBranch(part) {
  return createdBranchStart(part)?.name ?? null;
}
function localStart(start) {
  return !start.includes("/") && !start.includes(UNKNOWN);
}
function pushNames(part, branch) {
  const { positional } = readPushWords(part.git?.args ?? []);
  return positional.slice(1).some((spec) => {
    const dst = rawDestination(spec);
    return dst === branch || dst === `refs/heads/${branch}`;
  });
}
function newBranchFor(parts, count, part) {
  const dir = part?.git?.dir;
  let created = null;
  for (let i = 0; i < count; i++) {
    const made = parts[i].git?.dir === dir ? createdBranchStart(parts[i]) : null;
    if (made !== null) created = made;
    else if (setupChange(parts[i]) !== null) created = null;
    if (!parts[i].followedByAnd) created = null;
  }
  if (created === null || part === void 0) return null;
  const { name, start } = created;
  if (part.git?.subcommand === "push" && start !== void 0 && !localStart(start) && !pushNames(part, name)) return null;
  return name;
}
function branchCreatedBefore(parts, index) {
  return newBranchFor(parts, index, parts[index]);
}
var VARIABLE_SETTERS2 = /* @__PURE__ */ new Set(["export", "declare", "typeset", "readonly", "local"]);
function configLong(options, flag) {
  const names = options.flatMap((option) => [
    { name: option.name, option, negated: false },
    ...option.negatable === true ? [{ name: `no-${option.name}`, option, negated: true }] : []
  ]);
  const exact = names.find((n) => n.name === flag);
  if (exact !== void 0) return exact;
  const prefixed = names.filter((n) => n.name.startsWith(flag));
  return flag !== "" && prefixed.length === 1 ? prefixed[0] : null;
}
function readConfigWords(args) {
  const verb = args[0] !== void 0 && CONFIG_FORMS.has(args[0]) ? args[0] : null;
  const options = CONFIG_FORMS.get(verb) ?? [];
  const actions = /* @__PURE__ */ new Set();
  const positional = [];
  for (let i = verb === null ? 0 : 1; i < args.length; i++) {
    const a = args[i];
    if (positional.length > 0 || a === "-" || !a.startsWith("-")) {
      positional.push(a);
    } else if (a === "--") {
      positional.push(...args.slice(i + 1));
      break;
    } else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const long = configLong(options, a.slice(2, eq === -1 ? void 0 : eq));
      if (long === null) return { unreadable: a };
      const takesValue = long.option.value === true && !long.negated;
      if (takesValue && eq === -1 && ++i >= args.length) return { unreadable: a };
      if (!takesValue && eq !== -1) return { unreadable: a };
      if (long.option.action !== void 0 && !long.negated) actions.add(long.option.action);
    } else {
      for (let j = 1; j < a.length; j++) {
        const option = options.find((o) => o.letter === a[j]);
        if (option === void 0) return { unreadable: a };
        if (option.action !== void 0) actions.add(option.action);
        if (option.value !== true) continue;
        if (j + 1 === a.length && ++i >= args.length) return { unreadable: a };
        break;
      }
    }
  }
  return { verb, actions, positional };
}
function pushKeyWritten(args) {
  const words = readConfigWords(args);
  if ("unreadable" in words) return words;
  const { verb, actions, positional } = words;
  if (verb !== null && CONFIG_READ_VERBS.has(verb)) return null;
  const read = actions.has("read");
  const section = actions.has("section") || verb !== null && CONFIG_SECTION_VERBS.has(verb);
  const write = actions.has("write") || verb !== null;
  const key2 = positional[0];
  if (key2 === void 0 || read || !(write || section || positional.length >= 2)) return null;
  const lower = key2.toLowerCase();
  if (section) return positional.slice(0, 2).find((name) => WRITE_SECTIONS.has(name.toLowerCase().split(".")[0])) ?? null;
  if (keyMatches(CREDENTIAL_KEYS, lower)) return positional[1] !== void 0 && helperRuns(positional[1]) ? key2 : null;
  return keyMatches(PUSH_KEYS, lower) || keyMatches(RUN_ANY_KEYS, lower) ? key2 : null;
}
function variableChange(part) {
  const assigned = part.assignments.find((name) => GIT_REPO_VARIABLE.test(name) || part.program === null && setupVariable(name));
  if (assigned !== void 0) return part.assignments.join(" ");
  if (part.program !== null && VARIABLE_SETTERS2.has(part.program)) {
    const named2 = part.words.slice(1).find((w) => setupVariable(w.split("=")[0]));
    if (named2 !== void 0) return `${part.program} ${named2.split("=")[0]}`;
  }
  return null;
}
function setupChange(part) {
  const variable = variableChange(part);
  if (variable !== null) return variable;
  const git = part.git;
  if (git === null) return null;
  const sub = git.subcommand;
  if (BRANCH_SWITCHES.has(sub)) return `git ${sub}`;
  if (sub === "remote" && REMOTE_WRITES.has(git.args[0] ?? "")) return `git remote ${git.args[0]}`;
  const option = git.args.find((a) => !a.startsWith("--") && BRANCH_SETUP_SHORT.test(a) || BRANCH_SETUP_LONG.some((o) => a === o || a.startsWith(`${o}=`)));
  if (sub === "branch" && option !== void 0) return `git branch ${option}`;
  return null;
}
function carriedSetup(part) {
  const git = part.git;
  if (git === null) return null;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    if (!PUSH_GLOBAL_OPTIONS.some((o) => w === o || w.startsWith(`${o}=`))) continue;
    if (w === "-c" && checkedSshSetting(globals[i + 1])) {
      i++;
      continue;
    }
    return `git ${w.split("=")[0]}`;
  }
  return part.assignments.find((name, n) => setupVariable(name) && !(SSH_VARIABLES.has(name) && harmlessSsh(part.assignmentValues[n] ?? ""))) ?? null;
}
function checkedSshSetting(setting) {
  if (setting === void 0 || !setting.includes("=")) return false;
  return keyMatches(SSH_KEYS, keyOf(setting)) && harmlessSsh(setting.slice(setting.indexOf("=") + 1));
}
function cantCheck(why, subcommand = "push") {
  const advice = subcommand === "push" ? "Push with a separate plain `git push`." : `Run a separate plain \`git ${subcommand}\`.`;
  return {
    rule: "protected-branch",
    reason: `Refused: this \`git ${subcommand}\` can't be checked: ${why}. ${advice}`
  };
}
function remoteVerb(args) {
  const at = args.findIndex((a) => !a.startsWith("-"));
  return at === -1 ? { verb: void 0, rest: [] } : { verb: args[at], rest: args.slice(at + 1) };
}
function addsMirror(git) {
  if (git.subcommand !== "remote" || remoteVerb(git.args).verb !== "add") return false;
  return git.args.some((a) => a === "--mirror" || a.startsWith("--mirror="));
}
function lostFolder(part) {
  if (part.lostDir === null) return null;
  return `\`${part.lostDir.why}\` moves it to a folder the gate can't follow`;
}
var TRACE_VARIABLE = /^GIT_TRACE[A-Za-z0-9_]*$/;
function unknownTrace(part, own) {
  const assigned = part.assignments.find((name, n) => TRACE_VARIABLE.test(name) && part.assignmentValues[n]?.includes(UNKNOWN) === true);
  if (assigned !== void 0 && (own || part.program === null)) return assigned;
  if (part.program === null || !VARIABLE_SETTERS2.has(part.program)) return null;
  const word = part.words.slice(1).find((w) => TRACE_VARIABLE.test(w.split("=")[0]) && w.includes(UNKNOWN));
  return word === void 0 ? null : word.split("=")[0];
}
function traceSet(part, earlier, count) {
  let found2 = unknownTrace(part, true);
  for (let i = 0; i < count && found2 === null; i++) found2 = unknownTrace(earlier[i], false);
  return found2;
}
function checkCommitSetup(part, earlier, count) {
  const lost = lostFolder(part);
  if (lost !== null) return cantCheck(lost, "commit");
  const trace = traceSet(part, earlier, count);
  if (trace !== null) return cantCheck(`\`${trace}\` sends git's trace to a file only known when it runs`, "commit");
  const carried = part.assignments.find(setupVariable);
  if (carried !== void 0) return cantCheck(`\`${carried}\` changes which repository or settings it uses`, "commit");
  for (let i = 0; i < count; i++) {
    const change = variableChange(earlier[i]);
    if (change !== null) return cantCheck(`\`${change}\` earlier in the same command changes which repository or settings it uses`, "commit");
  }
  return null;
}
function checkPushSetup(part, earlier, count = earlier.length) {
  if (settingsOf(part).some(([name]) => name === "GIT_ALLOW_PROTOCOL")) return ALLOW_PROTOCOL_REFUSAL;
  const planted = plantedConfig(part, earlier, count);
  if (planted !== null) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`git ${part.git?.subcommand}\` with \`${planted}\` plants config or hooks in the new repository, which can change where pushes go or what git runs. Ask the user to run it with \`!\`.`
    };
  }
  if (carriesKey(OSS_KEYS, part, earlier, count)) return OSS_REFUSAL;
  if (carriesKey(REF_HISTORY_KEYS, part, earlier, count)) return REF_HISTORY_REFUSAL;
  const tty = fakeTtyPager(part, earlier, count);
  if (tty !== null) return runsRefusal(tty, `\`git ${part.git?.subcommand}\` (it has a terminal, so git starts its pager)`);
  const runs = runConfig(part, earlier, count) ?? uploadProgram(part);
  if (runs !== null) return runsRefusal(runs, `\`git ${part.git?.subcommand}\``);
  if (part.git?.subcommand === "config") {
    const key2 = pushKeyWritten(part.git.args);
    if (key2 === null) return null;
    if (typeof key2 !== "string") {
      return {
        rule: "protected-branch",
        reason: `Refused: the gate can't read \`git config\` option \`${key2.unreadable}\` (one git doesn't have, or short for several), so it can't tell which key is written. Spell the options in full.`
      };
    }
    if (keyMatches(OSS_KEYS, key2) || key2.toLowerCase() === "oss") return OSS_REFUSAL;
    if (keyMatches(REF_HISTORY_KEYS, key2)) return REF_HISTORY_REFUSAL;
    return {
      rule: "protected-branch",
      reason: `Refused: \`git config ${key2}\` changes where pushes go or what git runs. Ask the user to change it with \`!\`.`
    };
  }
  if (part.git !== null && addsMirror(part.git)) {
    return {
      rule: "protected-branch",
      reason: "Refused: `git remote add --mirror` changes where pushes go (every push to it sends all branches). Ask the user to add it with `!`."
    };
  }
  if (part.git?.subcommand === "commit") return checkCommitSetup(part, earlier, count) ?? programVariableRefusal(part, earlier, count);
  if (part.git?.subcommand !== "push") return null;
  const lost = lostFolder(part);
  if (lost !== null) return cantCheck(lost);
  const carried = carriedSetup(part);
  if (carried !== null) return cantCheck(`\`${carried}\` changes which repository or settings it uses`);
  const trace = traceSet(part, earlier, count);
  if (trace !== null) return cantCheck(`\`${trace}\` sends git's trace to a file only known when it runs`);
  for (let i = 0; i < count; i++) {
    if (earlier[i].git?.dir === part.git.dir && createdBranch(earlier[i]) !== null && newBranchFor(earlier, count, part) !== null) continue;
    const change = setupChange(earlier[i]);
    if (change !== null) return cantCheck(`\`${change}\` earlier in the same command changes which branch it pushes or where`);
  }
  const program = uploadProgram(part);
  return program === null ? programVariableRefusal(part, earlier, count) : runsRefusal(program, "`git push`");
}
var REMOTE_URL_KEYS = ["remote.*.url", "remote.*.pushurl"];
var INSTEAD_OF = /^url\.(.*)\.(?:push)?insteadof$/i;
var REMOTE_FETCH = /^remote\.(.*)\.fetch$/i;
function forgesRemote(key2, value) {
  if (keyMatches(REMOTE_URL_KEYS, key2)) return value === void 0 || isLocalUrl(value);
  const base = INSTEAD_OF.exec(key2);
  if (base !== null) return isLocalUrl(base[1]);
  const name = REMOTE_FETCH.exec(key2);
  if (name === null) return false;
  if (value === void 0) return true;
  const spec = value.startsWith("+") ? value.slice(1) : value;
  if (spec.includes(":") && replaceRef(rawDestination(spec))) return true;
  return spec.includes(":") && remoteTracking(rawDestination(spec), true) && spec !== `refs/heads/*:refs/remotes/${name[1]}/*`;
}
var REMOTE_ADD_VALUES = /* @__PURE__ */ new Set(["-t", "--track", "-m", "--master"]);
var LOCAL_REMOTE_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: this git call points a remote at a path on this machine or a `file://` URL, which can be the repository itself and forge its remote-tracking refs. Ask the user to add it with `!`."
};
function checkLocalRemote(part, earlier, count = earlier.length) {
  return part.git !== null && part.git.subcommand !== "push" && localRemote(part.git, part, earlier, count) ? LOCAL_REMOTE_REFUSAL : null;
}
function localRemote(git, part, earlier, count) {
  if (git.subcommand === "remote") {
    const { verb, rest } = remoteVerb(git.args);
    if ((verb === "add" || verb === "set-url" && !rest.includes("--delete")) && isLocalUrl(positionalsOf(rest, REMOTE_ADD_VALUES)[1] ?? "")) return true;
  }
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    const env = w === "--config-env" ? globals[i + 1] : w.startsWith("--config-env=") ? w.slice("--config-env=".length) : void 0;
    if (env !== void 0 && forgesRemote(keyOf(env), void 0)) return true;
    const setting = w === "-c" ? globals[i + 1] : void 0;
    if (setting !== void 0 && forgesRemote(keyOf(setting), setting.includes("=") ? setting.slice(setting.indexOf("=") + 1) : void 0)) return true;
  }
  const settings = callSettings(part, earlier, count);
  return settings.some(([name, value]) => {
    if (!CONFIG_KEY_VARIABLE.test(name)) return false;
    const paired = settings.find(([other]) => other === name.replace("_KEY_", "_VALUE_"));
    return forgesRemote(value, paired?.[1]);
  });
}
var ALLOW_PROTOCOL_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: `GIT_ALLOW_PROTOCOL` lets git use protocols such as `ext::`, which runs a command. Ask the user to run it with `!`."
};
function checkAllowProtocolMention(command, parts = []) {
  const plain = command.replace(/['"\\]/g, "");
  if (plain.includes("GIT_ALLOW_PROTOCOL")) return ALLOW_PROTOCOL_REFUSAL;
  return runsGit(parts) && (INDIRECT_ASSIGNMENT.test(command) || parts.some(setsUnreadableName)) ? ALLOW_PROTOCOL_REFUSAL : null;
}
var INDIRECT_ASSIGNMENT = /\$\{(?:!|\([^)]*P[^)]*\))[^}]*?=/;
function runsGit(parts) {
  return parts.some((p) => p.git !== null || p.words.includes("git"));
}
function checkTransportMention(command, parts) {
  return runsGit(parts) && /(?:^|[^A-Za-z0-9+:-])(?:ext|fd)::/i.test(command.replace(/['"\\]/g, "")) ? TRANSPORT_REFUSAL : null;
}
var TRANSPORT_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: an `ext::` or `fd::` git transport runs a command or talks over an open file. Ask the user to run it with `!`."
};
var VALUE_OPTIONS2 = { read: "ptudnNi", mapfile: "udnOsCc", readarray: "udnOsCc" };
function namesSetBy(program, args) {
  if (program === "getopts") return args[1] === void 0 ? [] : [args[1]];
  const names = [];
  const values = VALUE_OPTIONS2[program] ?? "";
  let options = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (options && a === "--") options = false;
    else if (options && /^-[A-Za-z]/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        const letter = a[k];
        const attached = a.slice(k + 1);
        const name = program === "read" && letter === "a" || (program === "printf" || program === "print") && letter === "v";
        if (!name && !values.includes(letter)) continue;
        const operand = attached !== "" ? attached : args[++i] ?? "";
        if (name || attached === "" && !/^[0-9]+$/.test(operand)) names.push(operand);
        break;
      }
    } else if (program !== "printf" && program !== "print") names.push(a);
  }
  return names;
}
function setsUnreadableName(part) {
  const program = part.program;
  if (program === null) return false;
  const unknownName = (w) => w.slice(0, w.includes("=") ? w.indexOf("=") : void 0).includes(UNKNOWN);
  if (part.wrappers.includes("env") && program.includes(UNKNOWN) && program.includes("=")) return true;
  const args = part.words.slice(1);
  if (VARIABLE_SETTERS2.has(program)) {
    if (program !== "export" && program !== "readonly" && args.some((a) => /^-[A-Za-z]*n/.test(a))) return true;
    return args.some((a) => !a.startsWith("-") && unknownName(a));
  }
  if (!(program in VALUE_OPTIONS2) && program !== "printf" && program !== "print" && program !== "getopts") return false;
  return namesSetBy(program, args).some((name) => name.includes(UNKNOWN) || name.replace(/['"\\]/g, "") === "GIT_ALLOW_PROTOCOL");
}
var REF_HISTORY_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: this git setting changes or erases ref history (reflogs), which a lost commit is found by. Ask the user to change it with `!`."
};
var OSS_REFUSAL = {
  rule: "protected-branch",
  reason: "Refused: this git call writes an OSS setting (the `oss` config section), which OSS reads to decide what a phase ships. Ask the user to change it with `!`."
};
function carriesKey(keys, part, earlier, count) {
  const git = part.git;
  if (git === null) return false;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    const setting = w === "-c" || w === "--config-env" ? globals[i + 1] : w.startsWith("--config-env=") ? w.slice("--config-env=".length) : void 0;
    if (setting !== void 0 && keyMatches(keys, keyOf(setting))) return true;
  }
  return callSettings(part, earlier, count).some(([name, value]) => CONFIG_KEY_VARIABLE.test(name) && keyMatches(keys, value));
}
function runsRefusal(what, where) {
  return {
    rule: "protected-branch",
    reason: `Refused: \`${what}\` makes ${where} run a hook folder or program the agent may have written. Ask the user to run it with \`!\`.`
  };
}
function programVariableRefusal(part, earlier, count) {
  const name = programVariable(callSettings(part, earlier, count));
  return name === void 0 ? null : runsRefusal(name, `\`git ${part.git?.subcommand}\``);
}
var NEW_REPO_SUBCOMMANDS = /* @__PURE__ */ new Set(["clone", "init"]);
var TEMPLATE_KEY = "init.templatedir";
var NEW_REPO_VARIABLE = /^GIT_(?:TEMPLATE_DIR|CONFIG.*)$/;
function variableSetBefore(earlier, count) {
  for (let i = 0; i < count; i++) {
    const part = earlier[i];
    const assigned = part.program === null ? part.assignments.find((name) => NEW_REPO_VARIABLE.test(name)) : void 0;
    if (assigned !== void 0) return assigned;
    if (part.program !== null && VARIABLE_SETTERS2.has(part.program)) {
      const named2 = part.words.slice(1).map((w) => w.split("=")[0]).find((name) => NEW_REPO_VARIABLE.test(name));
      if (named2 !== void 0) return named2;
    }
  }
  return void 0;
}
function plantsKey(setting) {
  const key2 = (setting.includes("=") ? setting.slice(0, setting.indexOf("=")) : setting).toLowerCase();
  return key2 === TEMPLATE_KEY || PUSH_KEYS.some((pattern) => matchCommand(pattern, [key2]));
}
function keyOf(setting) {
  return setting.includes("=") ? setting.slice(0, setting.indexOf("=")) : setting;
}
function plantedConfig(part, earlier, count) {
  const git = part.git;
  if (git === null || !NEW_REPO_SUBCOMMANDS.has(git.subcommand)) return null;
  const variable = part.assignments.find((name) => NEW_REPO_VARIABLE.test(name)) ?? variableSetBefore(earlier, count);
  if (variable !== void 0) return variable;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    if (w === "--config-env" || w.startsWith("--config-env=")) return "--config-env";
    if (w === "-c" && i + 1 < globals.length && plantsKey(globals[i + 1])) return keyOf(globals[i + 1]);
  }
  const { args } = git;
  for (let i = 0; i < args.length && args[i] !== "--"; i++) {
    const a = args[i];
    const flag = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    if (a.startsWith("--") && longOption(a, "--template", 4)) return flag;
    if (git.subcommand !== "clone") continue;
    let setting;
    if (a.startsWith("--") && longOption(a, "--config", 5)) setting = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
    else if (a === "-c") setting = args[++i];
    else if (a.startsWith("-c") && !a.startsWith("--")) setting = a.slice(2);
    if (setting !== void 0 && plantsKey(setting)) return keyOf(setting);
  }
  return null;
}
var REF_HISTORY_KEYS = ["core.logallrefupdates", "core.bare", "gc.reflogexpire*", "gc.*.reflogexpire*"];
var OSS_KEYS = ["oss.*"];
var RUN_ANY_KEYS = ["core.hookspath", "alias.*", "include.path", "includeif.*.path", "protocol.allow", "protocol.*.allow", ...REF_HISTORY_KEYS, ...OSS_KEYS];
var WRITE_SECTIONS = new Set([...PUSH_KEYS, ...RUN_ANY_KEYS].map((key2) => key2.split(".")[0]));
var RUN_COMMAND_KEYS = [
  "core.fsmonitor",
  "core.editor",
  "sequence.editor",
  "diff.external",
  "diff.*.textconv",
  "diff.*.command",
  "filter.*.clean",
  "filter.*.smudge",
  "filter.*.process",
  "gpg.program",
  "gpg.*.program",
  "uploadpack.packobjectshook",
  "core.alternaterefscommand",
  "core.askpass",
  "core.gitproxy",
  "merge.*.driver"
];
var NO_PROGRAM_VALUES = /* @__PURE__ */ new Set(["", "true", "false", ":"]);
var CONFIG_KEY_VARIABLE = /^GIT_CONFIG_KEY_[0-9]+$/;
function keyMatches(patterns, key2) {
  return patterns.some((pattern) => matchCommand(pattern, [key2.toLowerCase()]));
}
function runsProgram(key2, value) {
  if (key2.includes(UNKNOWN) || keyMatches(RUN_ANY_KEYS, key2)) return true;
  if (keyMatches(CREDENTIAL_KEYS, key2)) return value === void 0 || helperRuns(value);
  if (keyMatches(SSH_KEYS, key2)) return value === void 0 || !harmlessSsh(value);
  const program = REMOTE_PROGRAM_KEYS.find(([pattern]) => keyMatches([pattern], key2));
  if (program !== void 0) return value !== program[1];
  return keyMatches(RUN_COMMAND_KEYS, key2) && (value === void 0 || !NO_PROGRAM_VALUES.has(value));
}
var CREDENTIAL_KEYS = ["credential.helper", "credential.*.helper"];
var REMOTE_PROGRAM_KEYS = [
  ["remote.*.uploadpack", "git-upload-pack"],
  ["remote.*.receivepack", "git-receive-pack"]
];
function helperRuns(value) {
  if (value.includes(UNKNOWN)) return true;
  if (!value.startsWith("!")) return value.includes("/") || SHELL_METACHARACTER.test(value);
  const words = simpleWords(value.slice(1));
  return words === null || helperCommandRuns(words);
}
var SHELL_METACHARACTER = /[;&|$`<>()\n]/;
var SIMPLE_TEXT = /^[A-Za-z0-9_@%+=:,./~ \t'"-]*$/;
var PLAIN_PROGRAM = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
var CODE_RUNNERS = /* @__PURE__ */ new Set([
  "fish",
  "eval",
  "source",
  "csh",
  "tcsh",
  "pwsh",
  "powershell",
  "tclsh",
  "wish",
  "lua",
  "luajit",
  "find",
  "watch",
  "parallel",
  "make",
  "vim",
  "vi",
  "nvim",
  "ex"
]);
var GIT_RUN_OPTIONS = ["-c", "--config-env", "--exec-path"];
var OP_RUN_COMMANDS = [["run"], ["plugin", "run"]];
function simpleWords(text) {
  if (!SIMPLE_TEXT.test(text)) return null;
  const words = [];
  let word = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === " " || c === "	") {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === "'" || c === '"') {
      const end = text.indexOf(c, i + 1);
      if (end === -1) return null;
      word = (word ?? "") + text.slice(i + 1, end);
      i = end;
    } else {
      word = (word ?? "") + c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}
var STANDARD_BIN_FOLDERS = /* @__PURE__ */ new Set(["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin", "/usr/sbin", "/sbin", "/opt/local/bin"]);
var APP_BUNDLE_PROGRAM = /^\/Applications\/[^/]+\/Contents\/.+/;
function helperCommandRuns(words) {
  const [program] = words;
  if (program === void 0) return true;
  if (!PLAIN_PROGRAM.test(program) && !standardProgram(program)) return true;
  const base = program.slice(program.lastIndexOf("/") + 1).toLowerCase();
  if (CODE_RUNNERS.has(base) || runsItsArguments(base) || scriptFactsOf(base, []) !== null) return true;
  if (base === "git") return words.some((w) => GIT_RUN_OPTIONS.some((o) => w === o || w.startsWith(`${o}=`)));
  const runs = base === "op" && OP_RUN_COMMANDS.some((sub) => sub.every((w, n) => words[n + 1] === w));
  if (!runs) return false;
  const end = words.indexOf("--");
  return end === -1 || helperCommandRuns(words.slice(end + 1));
}
function standardProgram(program) {
  if (!program.startsWith("/") || program.split("/").includes("..")) return false;
  return STANDARD_BIN_FOLDERS.has(program.slice(0, program.lastIndexOf("/"))) || APP_BUNDLE_PROGRAM.test(program);
}
var SSH_KEYS = ["core.sshcommand"];
var SSH_VARIABLES = /* @__PURE__ */ new Set(["GIT_SSH_COMMAND", "GIT_SSH"]);
var SSH_PROGRAM = /^(?:ssh|\/(?:[^/\s]+\/)*ssh)$/;
var SSH_PLAIN_LETTERS = /* @__PURE__ */ new Set([..."46AaCkNnqTtv"]);
var SSH_VALUE_LETTERS2 = /* @__PURE__ */ new Set([..."plicmb"]);
var SSH_OPTION_LETTER = "o";
var SSH_OPTION_KEYS = new Set([
  "StrictHostKeyChecking",
  "UserKnownHostsFile",
  "BatchMode",
  "ConnectTimeout",
  "IdentitiesOnly",
  "IdentityFile",
  "Port",
  "User",
  "ServerAliveInterval",
  "ServerAliveCountMax",
  "LogLevel",
  "Compression",
  "HostKeyAlias",
  "PreferredAuthentications",
  "PubkeyAuthentication",
  "PasswordAuthentication",
  "AddKeysToAgent",
  "ControlMaster",
  "ControlPath",
  "ControlPersist",
  // K10: algorithm lists, retries and agent forwarding (ForwardAgent may name an agent socket, not a program)
  "ForwardAgent",
  "ConnectionAttempts",
  "HostKeyAlgorithms",
  "PubkeyAcceptedKeyTypes",
  "PubkeyAcceptedAlgorithms",
  "KexAlgorithms",
  "Ciphers",
  "MACs"
].map((key2) => key2.toLowerCase()));
var SSH_OPTION_KEY = /^([A-Za-z]+)[ \t=]/;
function harmlessSsh(value) {
  if (NO_PROGRAM_VALUES.has(value)) return true;
  const words = simpleWords(value);
  if (words === null || words.length === 0) return false;
  const [program, ...options] = words;
  if (!SSH_PROGRAM.test(program) || program !== "ssh" && !standardProgram(program)) return false;
  for (let i = 0; i < options.length; i++) {
    const w = options[i];
    if (!w.startsWith("-") || w.length < 2) return false;
    for (let at = 1; at < w.length; at++) {
      const letter = w[at];
      if (SSH_PLAIN_LETTERS.has(letter)) continue;
      if (letter !== SSH_OPTION_LETTER && !SSH_VALUE_LETTERS2.has(letter)) return false;
      const optionValue = at + 1 < w.length ? w.slice(at + 1) : options[++i];
      if (optionValue === void 0) return false;
      if (letter === SSH_OPTION_LETTER && !SSH_OPTION_KEYS.has(SSH_OPTION_KEY.exec(optionValue)?.[1].toLowerCase() ?? "")) return false;
      break;
    }
  }
  return true;
}
function runVariable(settings) {
  const found2 = settings.find(([name, value]) => {
    if (name === "GIT_CONFIG_PARAMETERS") return true;
    if (!CONFIG_KEY_VARIABLE.test(name)) return false;
    const paired = settings.find(([other]) => other === name.replace("_KEY_", "_VALUE_"));
    return runsProgram(value, paired?.[1]);
  });
  return found2?.[0];
}
var PROGRAM_VARIABLES = /* @__PURE__ */ new Set([
  "GIT_SSH_COMMAND",
  "GIT_SSH",
  "GIT_EDITOR",
  "GIT_SEQUENCE_EDITOR",
  "GIT_EXTERNAL_DIFF",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "GIT_PAGER",
  "GIT_PROXY_COMMAND",
  "EDITOR",
  "VISUAL"
]);
var PAGER_VARIABLES = /* @__PURE__ */ new Set(["GIT_PAGER", "PAGER"]);
var PAGER_VALUES = /* @__PURE__ */ new Set([...NO_PROGRAM_VALUES, "cat"]);
var CONFIG_FILE_VARIABLES = /* @__PURE__ */ new Set(["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG", "HOME", "XDG_CONFIG_HOME"]);
var NO_CONFIG_FILE = "/dev/null";
function programVariable(settings) {
  return settings.find(([name, value]) => {
    if (!PROGRAM_VARIABLES.has(name)) return false;
    if (SSH_VARIABLES.has(name)) return !harmlessSsh(value);
    return !(PAGER_VARIABLES.has(name) ? PAGER_VALUES : NO_PROGRAM_VALUES).has(value);
  })?.[0];
}
function callSettings(part, earlier, count) {
  const settings = settingsOf(part);
  for (let i = 0; i < count; i++) {
    if (earlier[i].program === null || VARIABLE_SETTERS2.has(earlier[i].program ?? "")) settings.push(...settingsOf(earlier[i]));
  }
  return settings;
}
function settingsOf(part) {
  const own = part.assignments.map((name, n) => [name, part.assignmentValues[n] ?? ""]);
  if (part.program === null || !VARIABLE_SETTERS2.has(part.program)) return own;
  return [...own, ...part.words.slice(1).map((w) => [w.split("=")[0], w.slice(w.indexOf("=") + 1)])];
}
function runConfig(part, earlier, count) {
  const git = part.git;
  if (git === null || git.subcommand === "push") return null;
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    const env = w === "--config-env" ? globals[i + 1] : w.startsWith("--config-env=") ? w.slice("--config-env=".length) : void 0;
    if (env !== void 0 && runsProgram(keyOf(env), void 0)) return keyOf(env);
    if (w !== "-c" || i + 1 >= globals.length) continue;
    const setting = globals[++i];
    const value = setting.includes("=") ? setting.slice(setting.indexOf("=") + 1) : "true";
    if (git.subcommand === "submodule" && keyOf(setting).toLowerCase() === "protocol.file.allow") continue;
    if (runsProgram(keyOf(setting), value)) return keyOf(setting);
  }
  const settings = callSettings(part, earlier, count);
  const variable = runVariable(settings) ?? programVariable(settings);
  if (variable !== void 0) return variable;
  if (git.subcommand === "commit") return null;
  return settings.find(([name, value]) => CONFIG_FILE_VARIABLES.has(name) && value !== NO_CONFIG_FILE)?.[0] ?? null;
}
var PROGRAM_OPTIONS = /* @__PURE__ */ new Map([
  ["fetch", ["--upload-pack"]],
  ["pull", ["--upload-pack"]],
  ["ls-remote", ["--upload-pack", "--exec"]],
  ["clone", ["--upload-pack"]],
  ["push", ["--receive-pack", "--exec"]]
]);
function uploadProgram(part) {
  const git = part.git;
  const options = git === null ? void 0 : PROGRAM_OPTIONS.get(git.subcommand);
  if (git === null || options === void 0) return null;
  for (const a of git.args) {
    if (a === "--") break;
    const flag = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    if (a.startsWith("--") && options.some((o) => longOption(a, o, 3))) return flag;
    if (git.subcommand === "clone" && a.startsWith("-u")) return "-u";
  }
  return null;
}
var PAGER_KEYS = ["core.pager", "pager.*"];
function fakeTtyPager(part, earlier, count) {
  const git = part.git;
  if (!part.terminal || git === null) return null;
  const set = callSettings(part, earlier, count).find(([name, value]) => PAGER_VARIABLES.has(name) && !PAGER_VALUES.has(value));
  if (set !== void 0) return set[0];
  const globals = part.words.slice(1, part.words.length - git.args.length - 1);
  for (let i = 0; i < globals.length; i++) {
    const w = globals[i];
    const env = w === "--config-env" ? globals[i + 1] : w.startsWith("--config-env=") ? w.slice("--config-env=".length) : void 0;
    if (env !== void 0 && keyMatches(PAGER_KEYS, keyOf(env))) return keyOf(env);
    const setting = w === "-c" ? globals[i + 1] : void 0;
    if (setting === void 0 || !keyMatches(PAGER_KEYS, keyOf(setting))) continue;
    if (!PAGER_VALUES.has(setting.includes("=") ? setting.slice(setting.indexOf("=") + 1) : "true")) return keyOf(setting);
  }
  return null;
}

// src/tool-gate/rules/red-cycle.ts
var import_node_path26 = __toESM(require("node:path"), 1);
var NO_RUN = "Refused: No failing test recorded in this build. Write a failing test and run it on its own with a test command, unpiped (for example `npx vitest run <file>` or `pytest <file>`). Another command that names a test file or has the word test, spec or check in it, and fails, is taken as this build's test command.";
var DEV_DOCS = ".oss/dev/**";
function isSourceFile(filePath, settings, root, home) {
  return (
    // Any case: `foo.TS` is the same kind of file. Test-file patterns and the dev-docs folder stay
    // case-sensitive here, since matching them more widely would exempt more files from the rule.
    settings.sourceExtensions.some((ext) => ext.toLowerCase() === import_node_path26.default.extname(filePath).toLowerCase()) && !matchPath(DEV_DOCS, filePath, { home, root }) && !matchAnyPath(settings.testFilePatterns, filePath, { home, root })
  );
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
      reason: `Refused: \`${import_node_path26.default.relative(root, call.filePath)}\` is not in this cycle and the last test run was green. Write a failing test and run it before editing a new source file.`
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
  return refspecs.find((spec) => spec.slice(spec.indexOf(":") + 1).replace(/^\+/, "").startsWith(TAGS_REF) || wildcardTags(spec));
}
function wildcardTags(refspec) {
  const dst = rawDestination(refspec);
  const star = dst.indexOf("*");
  if (star === -1) return false;
  const known = dst.slice(0, star);
  return TAGS_REF.startsWith(known) || known.startsWith(TAGS_REF);
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
    const found2 = pushedTags(args);
    return found2 === void 0 ? null : refuse(`git push ${found2}`);
  }
  return null;
}

// src/tool-gate/rules/unreadable.ts
var import_node_path27 = __toESM(require("node:path"), 1);
var GIT_WRITES = /* @__PURE__ */ new Set([
  "push",
  "commit",
  "config",
  "send-pack",
  "update-ref",
  "symbolic-ref",
  "branch",
  "tag",
  "reset",
  "checkout",
  "switch",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "pull",
  "fetch",
  "am",
  "stash",
  "notes",
  "replace",
  "filter-branch",
  "fast-import",
  "worktree",
  "remote",
  "clone",
  "init"
]);
var GIT_PATH_WRITES = /* @__PURE__ */ new Set(["clean", "subtree", "http-push", "rm", "mv", "restore", "apply", "am"]);
function checkUnknownGitOption(part) {
  const git = part.git;
  if (git?.unknownOption === void 0) return null;
  const risky = [git.subcommand, git.args[0]].find((w) => w !== void 0 && (GIT_WRITES.has(w) || GIT_PATH_WRITES.has(w)));
  if (risky === void 0) return null;
  return {
    rule: "unreadable",
    reason: `Refused: \`git ${git.unknownOption}\` is a git option the gate doesn't know, so it can't tell what \`git \u2026 ${risky}\` runs. Run it without that option.`
  };
}
var INTERPRETERS4 = /* @__PURE__ */ new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "node",
  "perl",
  "ruby",
  "deno",
  "bun",
  "osascript",
  "php",
  "eval",
  "source",
  ".",
  // fix round 4, K6: expect runs Tcl, which runs commands (`exec`, `system`)
  "expect"
]);
var PYTHON4 = /^python[0-9.]*$/;
var TEXT_ONLY = { realpath: (p) => import_node_path27.default.normalize(p) };
function tooComplex(reason) {
  return {
    rule: "unreadable",
    reason: `Refused: this command is too complex for the gate to check (${reason}); split it into simpler commands.`
  };
}
function riskIn(part, settings, places, home) {
  const { name } = part;
  if (name === "git" && part.git !== null && GIT_WRITES.has(part.git.subcommand)) return `runs \`git ${part.git.subcommand}\``;
  if (name !== null && (INTERPRETERS4.has(name) || PYTHON4.test(name))) return `runs \`${name}\``;
  if (part.hiddenScript !== void 0) return part.hiddenScript;
  if (scriptFactsOf(name, part.words.slice(1))?.unreadable != null) return `runs a \`${name}\` script the gate can't read`;
  const dir = part.git?.dir ?? part.cwd;
  for (const word of part.words) {
    if (protectedPathNamed(word, dir, settings, places, TEXT_ONLY, home) !== null) return "names a protected path";
    const glob = part.globs.get(word);
    if (glob === void 0) continue;
    const pattern = globPathOf(glob, escapeGlob(dir), home);
    if (places.some((at) => shellGlobMayMatch(pattern, settings.protectedPaths, at, true, part.dotGlob))) return "names a protected path";
  }
  return null;
}
function checkUnreadable(reason, parts, settings, root, home, caseInsensitive) {
  const places = [{ root, home, caseInsensitive }];
  for (const part of parts) {
    const risk = riskIn(part, settings, places, home);
    if (risk === null) continue;
    return {
      rule: "unreadable",
      reason: `Refused: part of this command can't be read (${reason}), and the command also ${risk}. Split it into simpler commands so the gate can check each one.`
    };
  }
  return null;
}

// src/tool-gate/gate.ts
var import_node_os5 = __toESM(require("node:os"), 1);

// src/tool-gate/sandbox.ts
var import_node_child_process3 = require("node:child_process");
var import_node_fs16 = __toESM(require("node:fs"), 1);
var import_node_os3 = __toESM(require("node:os"), 1);
var import_node_path28 = __toESM(require("node:path"), 1);
var SANDBOX_EXEC = "/usr/bin/sandbox-exec";
var ENV = "/usr/bin/env";
var SHELL = ["/bin/bash", "--norc", "--noprofile", "-c"];
var GROUP_WRAPPER = `set -m; exec 3>&2 2>/dev/null; /bin/bash --norc --noprofile -c "$1" 2>&3 3>&- & p=$!; exec 2>&3 3>&-; set +m; trap 'kill -TERM -- -$p 2>/dev/null' EXIT; trap 'exit 143' TERM INT HUP; wait $p`;
var OSS_PORT = 8473;
var DNS_SOCKET = "/private/var/run/mDNSResponder";
var MANAGED_SETTINGS = "/Library/Application Support/ClaudeCode/managed-settings.json";
var KEYCHAIN_SERVICES = ["com.apple.SecurityServer", "com.apple.securityd.xpc", "com.apple.secd", "com.apple.trustd.agent"];
var KEYCHAIN_PREFIXES = ["com.apple.security."];
var ENV_NAMES = /* @__PURE__ */ new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "JAVA_HOME",
  "GOPATH",
  "GOROOT",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "NVM_DIR",
  "PYENV_ROOT",
  "VIRTUAL_ENV",
  "CONDA_PREFIX",
  "NODE_ENV",
  "CI"
]);
var LOCALE_NAME = /^LC_[A-Z]+$/;
function sbString(text) {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
function inside(dir, root) {
  return dir === root || dir.startsWith(`${root}/`);
}
function ancestorsUpTo(dir, top) {
  const out = [];
  for (let at = import_node_path28.default.dirname(dir); inside(at, top); at = import_node_path28.default.dirname(at)) {
    out.push(at);
    if (at === top || at === import_node_path28.default.dirname(at)) break;
  }
  return out;
}
function reviewSandboxProfile(places) {
  const homes = [...new Set(places.homes.map((dir) => dir.replace(/(.)\/+$/, "$1")))];
  const priv = places.privateDir;
  const readable = readableUnderHome({ homes, repos: places.repos, privateDir: priv });
  const agents = reviewFoldersRoot(priv);
  const metadata = [
    .../* @__PURE__ */ new Set([...homes, ...readable.flatMap((r) => homes.filter((home) => inside(r.at, home)).flatMap((home) => ancestorsUpTo(r.at, home))), ...agents === null ? [] : ancestorsUpTo(priv, agents)])
  ];
  const shielded = [...places.repos, ...homes].filter((p) => inside(p, priv) && p !== priv);
  const writeDenied = [...shielded.map((p) => `(subpath ${sbString(p)})`), ...[...new Set(shielded.flatMap((p) => ancestorsUpTo(p, priv)))].map((p) => `(literal ${sbString(p)})`)];
  const credentials = credentialPaths(homes).map(({ path: p, kind }) => `(${kind === "folder" ? "subpath" : kind === "file" ? "literal" : "prefix"} ${sbString(p)})`);
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    // round 16, SEC INFO-1: the controlling terminal only, not the user's other ttys (/dev/ttys*)
    `(allow file-write* (subpath ${sbString(priv)}) (literal "/dev/null") (literal "/dev/dtracehelper") (literal "/dev/tty") (regex #"^/dev/fd/"))`,
    ...writeDenied.length > 0 ? [`(deny file-write* ${writeDenied.join(" ")})`] : [],
    // round 11, SEC CRITICAL-1: no symlink anywhere (ln -s, symlink(), then a rename over a checked
    // file), so a file the gate checked can't become a link before Claude Code's tools open it
    "(deny file-write-create (vnode-type SYMLINK))",
    "(deny user-preference-write)",
    "(deny lsopen)",
    "(deny appleevent-send)",
    '(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))',
    "(deny signal)",
    "(allow signal (target same-sandbox))",
    "(deny network-outbound (remote unix-socket))",
    `(allow network-outbound (remote unix-socket (path-literal ${sbString(DNS_SOCKET)})))`,
    `(deny file-read* ${[...homes, ...agents === null ? [] : [agents]].map((dir) => `(subpath ${sbString(dir)})`).join(" ")})`,
    `(allow file-read* ${readable.map((r) => `(${r.kind === "file" ? "literal" : "subpath"} ${sbString(r.at)})`).join(" ")})`,
    `(allow file-read-metadata ${metadata.map((p) => `(literal ${sbString(p)})`).join(" ")})`,
    // their contents only: git status in the root still sees that a nested repo is there
    ...(places.hidden ?? []).length > 0 ? [`(deny file-read-data ${(places.hidden ?? []).map((p) => `(subpath ${sbString(p)})`).join(" ")})`] : [],
    `(deny file-read* ${credentials.join(" ")})`,
    `(deny file-read* ${transcriptRoots([places.tmpdir]).map((root) => `(regex #"${transcriptPattern(root)}")`).join(" ")})`,
    '(deny mach-lookup (global-name-prefix "com.apple.pasteboard"))',
    // round 12, SEC CRITICAL-A: no mounts (a disk image over `.git/hooks`): no DiskArbitration, no mount tools
    '(deny mach-lookup (global-name-prefix "com.apple.DiskArbitration"))',
    // round 13, SEC INFO-1: and the third-party file-system tools (macFUSE and the like)
    '(deny process-exec (literal "/usr/bin/hdiutil") (regex #"^/sbin/mount(_|$)") (subpath "/System/Library/Filesystems") (subpath "/Library/Filesystems"))',
    // round 14, SEC CRITICAL-1: nor mount(2)/unmount(2) called directly (devfs over ~/.claude/plugins)
    "(deny file-mount)",
    "(deny file-unmount)",
    `(deny network-bind ${[...new Set(places.ports ?? [OSS_PORT])].map((port) => `(local ip "*:${port}")`).join(" ")})`,
    `(deny mach-lookup ${[...KEYCHAIN_SERVICES.map((name) => `(global-name ${sbString(name)})`), ...KEYCHAIN_PREFIXES.map((name) => `(global-name-prefix ${sbString(name)})`)].join(" ")})`
  ].join("\n");
}
function shellQuote2(word) {
  return `'${word.replaceAll("'", "'\\''")}'`;
}
function cacheEnv(root) {
  const at = (name) => import_node_path28.default.join(root, name);
  return {
    npm_config_cache: at("npm"),
    GOCACHE: at("go-build"),
    PYTHONPYCACHEPREFIX: at("pycache"),
    XDG_CACHE_HOME: at("xdg"),
    CARGO_TARGET_DIR: at("cargo-target"),
    RUFF_CACHE_DIR: at("ruff"),
    MYPY_CACHE_DIR: at("mypy"),
    CLANG_MODULE_CACHE_PATH: at("clang-modules"),
    PYTEST_ADDOPTS: "-p no:cacheprovider"
  };
}
function sandboxEnv(hookEnv, privateDir) {
  const kept = Object.entries(hookEnv).filter((entry) => entry[1] !== void 0 && (ENV_NAMES.has(entry[0]) || LOCALE_NAME.test(entry[0])));
  return { ...Object.fromEntries(kept), TMPDIR: privateDir, ...cacheEnv(privateDir) };
}
function wrapCommand(command, profile, env) {
  const assignments = Object.entries(env).map(([name, value]) => shellQuote2(`${name}=${value}`));
  return [SANDBOX_EXEC, "-p", shellQuote2(profile), ENV, "-i", ...assignments, ...SHELL, shellQuote2(GROUP_WRAPPER), "oss-review", shellQuote2(command)].join(" ");
}
function realOrNull3(dir) {
  try {
    return import_node_fs16.default.realpathSync(dir);
  } catch {
    return null;
  }
}
function passwordHome() {
  try {
    const dir = import_node_os3.default.userInfo().homedir;
    return import_node_path28.default.isAbsolute(dir) ? realOrNull3(dir) ?? dir : void 0;
  } catch {
    return void 0;
  }
}
function darwinUserTemp() {
  const read = (0, import_node_child_process3.spawnSync)("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], { encoding: "utf8", timeout: timeLeft(500) });
  const dir = read.status === 0 ? read.stdout.trim() : "";
  return import_node_path28.default.isAbsolute(dir) ? realOrNull3(dir) : null;
}
function ownPrivateFolder(dir) {
  try {
    import_node_fs16.default.mkdirSync(dir, { mode: 448 });
  } catch (error) {
    if (error.code !== "EEXIST") return false;
  }
  try {
    const stat = import_node_fs16.default.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.()) return false;
    if ((stat.mode & 511) !== 448) import_node_fs16.default.chmodSync(dir, 448);
    return (import_node_fs16.default.lstatSync(dir).mode & 511) === 448;
  } catch {
    return false;
  }
}
var SAFE_ID2 = /^[A-Za-z0-9_-]{1,128}$/;
function privateFolderPath(userTemp, sessionId, agentId) {
  const session = typeof sessionId === "string" && SAFE_ID2.test(sessionId) ? sessionId : "session";
  const dir = import_node_path28.default.join(userTemp, "oss-review", session);
  return typeof agentId === "string" && SAFE_ID2.test(agentId) ? import_node_path28.default.join(dir, agentId) : dir;
}
function privateFolder2(userTemp, sessionId, agentId) {
  const dir = privateFolderPath(userTemp, sessionId, agentId);
  const levels = [import_node_path28.default.join(userTemp, "oss-review"), ...import_node_path28.default.dirname(dir) === import_node_path28.default.join(userTemp, "oss-review") ? [] : [import_node_path28.default.dirname(dir)], dir];
  return levels.every(ownPrivateFolder) && realOrNull3(dir) === dir ? dir : null;
}
function reviewUserTemp(platform, tmpdir, override) {
  if (override !== void 0) return realOrNull3(override);
  if (platform === "darwin") return darwinUserTemp();
  const given = tmpdir !== void 0 && import_node_path28.default.isAbsolute(tmpdir) ? tmpdir : "/tmp";
  const real = realOrNull3(given);
  return real === "/" ? null : real;
}
function sandboxSetting(file) {
  try {
    const data = JSON.parse(import_node_fs16.default.readFileSync(file, "utf8"));
    const sandbox = typeof data === "object" && data !== null ? data.sandbox : void 0;
    const enabled = typeof sandbox === "object" && sandbox !== null ? sandbox.enabled : void 0;
    return typeof enabled === "boolean" ? enabled : void 0;
  } catch {
    return void 0;
  }
}
function hostSandboxOn(homes, env) {
  if (env.SANDBOX_RUNTIME === "1") return true;
  const files = [...homes.flatMap((home) => [import_node_path28.default.join(home, ".claude", "settings.json"), import_node_path28.default.join(home, ".claude", "settings.local.json")]), MANAGED_SETTINGS];
  return files.map(sandboxSetting).reduce((on, setting) => setting ?? on, false);
}
var realRunner = (args) => {
  const run = (0, import_node_child_process3.spawnSync)(SANDBOX_EXEC, [...args], { stdio: "ignore", timeout: timeLeft(1e3) });
  return run.status === 0;
};
var UNSAFE = "the review sandbox can't be used on this Mac right now, and a review agent's Bash call runs only inside it";
function reviewContainment(opts, run = realRunner) {
  if (opts.disabled) return { kind: "fallback", why: "off" };
  if (opts.platform !== "darwin") return { kind: "fallback", why: "platform" };
  const optedOut = typeof opts.toolInput === "object" && opts.toolInput !== null && opts.toolInput.dangerouslyDisableSandbox === true;
  const pwHome = opts.passwordHome === void 0 ? passwordHome() : realOrNull3(opts.passwordHome) ?? opts.passwordHome;
  const homes = [...new Set([realOrNull3(opts.home) ?? opts.home, pwHome].filter((dir) => dir !== void 0))];
  if (!optedOut && hostSandboxOn(opts.settingsHomes ?? homes, opts.env)) return { kind: "fallback", why: "host-sandbox" };
  const refused3 = (why) => ({ kind: "refused", reason: `${UNSAFE} (${why})` });
  if (!import_node_path28.default.isAbsolute(opts.home) || !import_node_fs16.default.existsSync(SANDBOX_EXEC)) return refused3("no sandbox-exec, or HOME is not a full path");
  const temp = opts.userTemp !== void 0 ? realOrNull3(opts.userTemp) : darwinUserTemp();
  if (temp === null) return refused3("no user temp folder");
  const privateDir = privateFolder2(temp, opts.sessionId, opts.agentId);
  if (privateDir === null) return refused3("its private folder is a link, not ours or not private");
  const base = { homes, privateDir, ...opts.tmpdir === void 0 ? {} : { tmpdir: opts.tmpdir }, ...opts.ports === void 0 ? {} : { ports: opts.ports } };
  if (!run(["-p", reviewSandboxProfile({ ...base, repos: [] }), "/usr/bin/true"])) return refused3("sandbox-exec failed its self-test");
  const env = sandboxEnv(opts.env, privateDir);
  return {
    kind: "sandbox",
    wrap: (command, repos, hidden = []) => {
      const all = [...new Set(repos.flatMap((repo) => [repo, realOrNull3(repo) ?? repo]))];
      if ([...all, ...homes].some((p) => inside(p, privateDir)) || all.some((repo) => inside(privateDir, repo))) return null;
      return wrapCommand(command, reviewSandboxProfile({ ...base, repos: all, hidden: [...new Set(hidden.flatMap((h) => [h, realOrNull3(h) ?? h]))] }), env);
    }
  };
}

// src/tool-gate/mounts.ts
var import_node_child_process4 = require("node:child_process");
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_fs17 = __toESM(require("node:fs"), 1);
var import_node_path29 = __toESM(require("node:path"), 1);
var MOUNT_LINE = /^(.+?) on (.+?) (?:type \S+ )?\([^()]*\)$/;
var unescape = (field) => field.replace(/\\([0-7]{3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
function mountTable(platform, capMs) {
  if (platform === "linux") {
    try {
      return import_node_fs17.default.readFileSync("/proc/self/mounts", "utf8").split("\n").flatMap((line) => {
        const [device, at] = line.split(" ");
        return device === void 0 || at === void 0 || at === "" ? [] : [{ device: unescape(device), at: unescape(at) }];
      });
    } catch {
      return null;
    }
  }
  const run = (0, import_node_child_process4.spawnSync)("/sbin/mount", [], { encoding: "utf8", timeout: capMs, stdio: ["ignore", "pipe", "ignore"] });
  if (run.status !== 0 || typeof run.stdout !== "string") return null;
  return run.stdout.split("\n").flatMap((line) => {
    const found2 = MOUNT_LINE.exec(line);
    return found2?.[1] === void 0 || found2[2] === void 0 ? [] : [{ device: found2[1], at: found2[2] }];
  });
}
function mountedAtOrUnder(points, places) {
  return points.filter(({ at }) => places.some((place) => at === place || at.startsWith(`${place}/`)));
}
function mountedAbove(points, places) {
  return points.filter(({ at }) => places.some((place) => place !== at && place.startsWith(at === "/" ? "/" : `${at}/`)));
}
var key = (entry) => JSON.stringify([entry.device, entry.at]);
function notIn(a, b) {
  const left = /* @__PURE__ */ new Map();
  for (const entry of b) left.set(key(entry), (left.get(key(entry)) ?? 0) + 1);
  return a.filter((entry) => {
    const count = left.get(key(entry)) ?? 0;
    if (count > 0) left.set(key(entry), count - 1);
    return count === 0;
  });
}
function baselineFile(home, sessionId, agentId) {
  const owner = typeof agentId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(agentId) ? agentId : "session";
  return import_node_path29.default.join(sessionFolder(home, String(sessionId)), `${owner}.mounts`);
}
function recordMountBaseline(home, sessionId, agentId, points) {
  const file = baselineFile(home, sessionId, agentId);
  if (import_node_fs17.default.lstatSync(file, { throwIfNoEntry: false })?.isFile() === true) return;
  const draft = `${file}.draft-${process.pid}-${import_node_crypto.default.randomBytes(6).toString("hex")}`;
  try {
    writePrivateFile(draft, JSON.stringify(points));
    try {
      import_node_fs17.default.linkSync(draft, file);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  } finally {
    import_node_fs17.default.rmSync(draft, { force: true });
  }
}
var isEntry = (value) => typeof value === "object" && value !== null && typeof value.device === "string" && typeof value.at === "string";
function readMountBaseline(home, sessionId, agentId) {
  try {
    const data = JSON.parse(readPrivateFile(baselineFile(home, sessionId, agentId)) ?? "null");
    return Array.isArray(data) && data.every(isEntry) ? data : null;
  } catch {
    return null;
  }
}

// src/tool-gate/nested-repos.ts
var import_node_child_process5 = require("node:child_process");
var import_node_fs18 = __toESM(require("node:fs"), 1);
var import_node_os4 = __toESM(require("node:os"), 1);
var import_node_path30 = __toESM(require("node:path"), 1);
var NOT_WALKED = ["node_modules", "target", ".venv", "venv", "__pycache__", ".gradle", "Pods", "DerivedData", ".build", ".tox"];
var CHUNK_BYTES = 1024 * 1024;
var GITLINK = Buffer.from("160000 ");
var SLASH = "/".charCodeAt(0);
var GIT_CAP_MS = 1e3;
var STALE_MS = 10 * 60 * 1e3;
var TEMP_PREFIX = "oss-nested-";
function gitEnv2() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) if (!name.startsWith("GIT_")) env[name] = value;
  return { ...env, LC_ALL: "C", LANG: "C", LANGUAGE: "C" };
}
function keptEntries(fd, keep) {
  const kept = [];
  const buffer = Buffer.alloc(CHUNK_BYTES);
  let rest = Buffer.alloc(0);
  let at = 0;
  for (let read = import_node_fs18.default.readSync(fd, buffer, 0, CHUNK_BYTES, at); read > 0; read = import_node_fs18.default.readSync(fd, buffer, 0, CHUNK_BYTES, at)) {
    at += read;
    let data = Buffer.concat([rest, buffer.subarray(0, read)]);
    for (let end = data.indexOf(0); end !== -1; end = data.indexOf(0)) {
      const entry = data.subarray(0, end);
      if (keep(entry)) kept.push(entry.toString("utf8"));
      data = data.subarray(end + 1);
    }
    rest = Buffer.from(data);
  }
  return kept;
}
function tempParent(tempRoot) {
  const parent = import_node_path30.default.join(tempRoot, `${TEMP_PREFIX}${process.getuid?.() ?? "user"}`);
  try {
    import_node_fs18.default.mkdirSync(parent, { mode: 448 });
  } catch {
  }
  const stat = import_node_fs18.default.lstatSync(parent, { throwIfNoEntry: false });
  if (stat === void 0 || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 63) !== 0) return tempRoot;
  for (const name of import_node_fs18.default.readdirSync(parent)) {
    const dir = import_node_path30.default.join(parent, name);
    const age = Date.now() - (import_node_fs18.default.lstatSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (name.startsWith(TEMP_PREFIX) && age > STALE_MS) import_node_fs18.default.rmSync(dir, { recursive: true, force: true });
  }
  return parent;
}
function runGitToFile(gitBin, args, cwd, fd, limitMs, tracker = null) {
  return new Promise((resolve2) => {
    let child;
    try {
      child = (0, import_node_child_process5.spawn)(gitBin, ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], { cwd, env: gitEnv2(), detached: true, stdio: ["ignore", fd, "ignore"] });
    } catch {
      resolve2({ status: null, timedOut: false, failed: true });
      return;
    }
    const pid = child.pid;
    if (pid !== void 0) tracker?.started(pid);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pid !== void 0) {
        killGroup(pid);
        tracker?.ended(pid);
      }
      resolve2(result);
    };
    const timer = setTimeout(() => finish({ status: null, timedOut: true, failed: false }), limitMs);
    child.once("error", () => finish({ status: null, timedOut: false, failed: true }));
    child.once("close", (status) => finish({ status, timedOut: false, failed: false }));
  });
}
var fileRunner = (gitBin, args, cwd, fd, limitMs) => runGitToFile(gitBin, args, cwd, fd, limitMs);
var isRecordValue = (value) => typeof value === "object" && value !== null;
function nestedAskOf(message) {
  const ask = isRecordValue(message) ? message.nestedGit : void 0;
  if (!isRecordValue(ask)) return null;
  const ok = typeof ask.id === "number" && typeof ask.gitBin === "string" && Array.isArray(ask.args) && ask.args.every((a) => typeof a === "string") && typeof ask.cwd === "string" && Number.isInteger(ask.fd) && typeof ask.limitMs === "number";
  return ok ? ask : null;
}
function nestedGitViaPort(port) {
  const waiting = /* @__PURE__ */ new Map();
  let nextId = 0;
  port.on("message", (message) => {
    const result = isRecordValue(message) ? message.nestedResult : void 0;
    if (!isRecordValue(result) || typeof result.id !== "number") return;
    waiting.get(result.id)?.({ status: typeof result.status === "number" ? result.status : null, timedOut: result.timedOut === true, failed: result.failed !== false });
    waiting.delete(result.id);
  });
  fileRunner = (gitBin, args, cwd, fd, limitMs) => new Promise((resolve2) => {
    const id = nextId++;
    waiting.set(id, resolve2);
    port.postMessage({ nestedGit: { id, gitBin, args: [...args], cwd, fd, limitMs } });
  });
}
function answerNestedGit(message, tracker, reply) {
  const ask = nestedAskOf(message);
  if (ask === null) return false;
  void runGitToFile(ask.gitBin, ask.args, ask.cwd, ask.fd, ask.limitMs, tracker).then((result) => reply({ nestedResult: { id: ask.id, ...result } }));
  return true;
}
function realGitRunIn(parent, gitBin) {
  return async (args, cwd, keep, limitMs) => {
    const dir = import_node_fs18.default.mkdtempSync(import_node_path30.default.join(parent, TEMP_PREFIX));
    let fd;
    try {
      fd = import_node_fs18.default.openSync(import_node_path30.default.join(dir, "out"), "w+", 384);
    } finally {
      import_node_fs18.default.rmSync(dir, { recursive: true, force: true });
    }
    try {
      const run = await fileRunner(gitBin ?? gitBinary(), args, cwd, fd, limitMs);
      if (run.timedOut) return { status: run.status, stdout: "", timedOut: true };
      if (run.failed || run.status !== 0) return { status: run.status, stdout: "", timedOut: false };
      return { status: 0, stdout: keptEntries(fd, keep).map((entry) => `${entry}\0`).join(""), timedOut: false };
    } finally {
      import_node_fs18.default.closeSync(fd);
    }
  };
}
var realGitRun = (args, cwd, keep, limitMs) => realGitRunIn(tempParent(import_node_os4.default.tmpdir()))(args, cwd, keep, limitMs);
function inside2(p, root) {
  return p.startsWith(`${root}/`);
}
function worktrees(commonDir) {
  const dir = import_node_path30.default.join(commonDir, "worktrees");
  let names;
  try {
    names = import_node_fs18.default.readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      const text = import_node_fs18.default.readFileSync(import_node_path30.default.join(dir, name, "gitdir"), "utf8").trim();
      return import_node_path30.default.isAbsolute(text) ? [import_node_fs18.default.realpathSync(import_node_path30.default.dirname(text))] : [];
    } catch {
      return [];
    }
  });
}
async function askGit(top, run) {
  const isRepo = (entry) => entry.length > 0 && entry[entry.length - 1] === SLASH;
  const isGitlink = (entry) => entry.subarray(0, GITLINK.length).equals(GITLINK);
  const limit = timeLeft(GIT_CAP_MS);
  const [others, stage] = await Promise.all([
    run(["ls-files", "--others", "--exclude-standard", "-z", "--", ".", ...NOT_WALKED.map((name) => `:(exclude,glob)**/${name}/**`)], top, isRepo, limit),
    run(["ls-files", "--stage", "-z"], top, isGitlink, limit)
  ]);
  if (others.timedOut || stage.timedOut) return "timeout";
  if (others.status !== 0 || stage.status !== 0) return "unknown";
  const entries = (out, keep) => out.split("\0").filter((entry) => keep(Buffer.from(entry, "utf8")));
  const repos = entries(others.stdout, isRepo).map((entry) => entry.slice(0, -1));
  const links = entries(stage.stdout, isGitlink).map((entry) => entry.slice(entry.indexOf("	") + 1));
  return [...repos, ...links];
}
async function nestedRepos(top, dirs, named2, opts = {}) {
  let real;
  try {
    real = import_node_fs18.default.realpathSync(dirs.commonDir);
  } catch {
    return { kind: "unknown" };
  }
  const entries = await askGit(top, opts.run ?? (opts.tempRoot === void 0 && opts.gitBin === void 0 ? realGitRun : realGitRunIn(tempParent(opts.tempRoot ?? import_node_os4.default.tmpdir()), opts.gitBin)));
  if (entries === "timeout") return { kind: "timeout" };
  if (entries === "unknown") return { kind: "unknown" };
  const trees = worktrees(real).filter((dir) => inside2(dir, top));
  const repos = [.../* @__PURE__ */ new Set([...entries.map((entry) => import_node_path30.default.join(top, entry)), ...trees])].filter((dir) => !named2.includes(dir));
  return { kind: "found", repos };
}

// src/tool-gate/gate.ts
var CASE_INSENSITIVE_PLATFORMS = /* @__PURE__ */ new Set(["darwin", "win32"]);
var GIT_LIMITS = { maxRuns: 8, timeMs: 1200 };
var PATH_LIMITS = { maxLookups: 2e4, maxSteps: 2e5 };
var TREE_LIMITS = { maxDirs: 1e4, maxEntries: 2e5, timeMs: 1e3 };
var DECISION_MS = 1e3;
var TELL = "tool-gate failed, rules not checked.";
var TIMEOUT_MS2 = 2e3;
var HOOK_EVENTS = /* @__PURE__ */ new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);
function tempRoots(ctx) {
  const roots = ["/tmp", "/private/tmp"];
  const tmpdir = ctx.tmpdir;
  if (tmpdir === void 0 || !import_node_path31.default.isAbsolute(tmpdir)) return roots;
  const given = import_node_path31.default.normalize(tmpdir).replace(/(.)\/+$/, "$1");
  let real = given;
  try {
    real = import_node_fs19.default.realpathSync(given);
  } catch {
  }
  return given === "/" || real === "/" ? roots : [...roots, given, real];
}
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function readHook(input) {
  const data = JSON.parse(input);
  if (typeof data !== "object" || data === null) throw new Error("hook input is not an object");
  const record3 = data;
  if (typeof record3.cwd !== "string" || typeof record3.tool_name !== "string") {
    throw new Error("hook input has no cwd or tool_name");
  }
  return {
    cwd: record3.cwd,
    hookEventName: typeof record3.hook_event_name === "string" ? record3.hook_event_name : "",
    toolName: record3.tool_name,
    toolInput: record3.tool_input,
    error: typeof record3.error === "string" ? record3.error : void 0,
    isInterrupt: record3.is_interrupt === true,
    agent: callingAgentOf(record3),
    background: isRecord2(record3.tool_input) && record3.tool_input.run_in_background === true,
    sessionId: record3.session_id,
    agentId: record3.agent_id,
    ...isRecord2(record3.tool_response) && typeof record3.tool_response.stdout === "string" ? { stdout: record3.tool_response.stdout } : {}
  };
}
function repoRootOf(cwd) {
  for (let dir = cwd; ; dir = import_node_path31.default.dirname(dir)) {
    if (import_node_fs19.default.existsSync(import_node_path31.default.join(dir, ".git"))) return dir;
    if (import_node_path31.default.dirname(dir) === dir) return cwd;
  }
}
function toplevelOf(dir) {
  const repo = findRepo(dir);
  return repo.kind === "repo" ? repo.top : null;
}
function projectRootOf(projectDir, cwd) {
  const usable = projectDir !== void 0 && import_node_path31.default.isAbsolute(projectDir) && import_node_fs19.default.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory() === true;
  return usable ? projectDir : repoRootOf(cwd);
}
function reviewedRepos(ctx) {
  if (!isGateAgent(ctx.hook.agent, ctx.settings.gateAgents)) return [ctx.root];
  const top = toplevelOf(ctx.hook.cwd);
  let named2 = [];
  try {
    named2 = import_node_path31.default.isAbsolute(ctx.home) ? reviewedReposFor(ctx.home, ctx.hook.sessionId) : [];
  } catch {
  }
  return [.../* @__PURE__ */ new Set([ctx.root, ...top === null ? [] : [top], ...named2])];
}
function homesOf(home) {
  return [...new Set([home, import_node_os5.default.userInfo().homedir].filter((dir) => import_node_path31.default.isAbsolute(dir)))];
}
function isToplevel(dir) {
  try {
    return toplevelOf(dir) === import_node_fs19.default.realpathSync(dir);
  } catch {
    return false;
  }
}
function namedRepos(ctx) {
  try {
    return import_node_path31.default.isAbsolute(ctx.home) ? reviewedReposFor(ctx.home, ctx.hook.sessionId) : [];
  } catch {
    return [];
  }
}
var RETRY_ALONE = "retry this call on its own, or with fewer calls at once";
async function readableRepos(ctx) {
  const top = toplevelOf(ctx.hook.cwd);
  const named2 = namedRepos(ctx);
  const tops = [.../* @__PURE__ */ new Set([...isToplevel(ctx.root) ? [ctx.root] : [], ...top === null ? [] : [top], ...named2.filter(isToplevel)])];
  const repos = [.../* @__PURE__ */ new Set([...tops, ...tops.flatMap(gitFoldersOf)])];
  const hidden = [];
  for (const top2 of new Set(tops.map((dir) => import_node_fs19.default.realpathSync(dir)))) {
    const repo = findRepo(top2);
    const nested = repo.kind === "repo" ? await nestedRepos(top2, repo, tops, ctx.nestedGit === void 0 ? {} : { run: ctx.nestedGit }) : { kind: "unknown" };
    if (nested.kind === "timeout") return { repos, hidden, problem: `the nested-repo check timed out for the reviewed repo \`${top2}\`; ${RETRY_ALONE}`, timedOut: true };
    if (nested.kind === "unknown") return { repos, hidden, problem: `git can't tell which other repos the reviewed repo \`${top2}\` holds`, timedOut: false };
    hidden.push(...nested.repos);
  }
  return { repos, hidden, problem: readRootsProblem(repos, homesOf(ctx.home), ctx.caseInsensitive), timedOut: false };
}
function gitFoldersOf(top) {
  const repo = findRepo(top);
  if (repo.kind !== "repo") return [];
  return [repo.gitDir, repo.commonDir].flatMap((dir) => {
    try {
      return [import_node_fs19.default.realpathSync(dir)];
    } catch {
      return [];
    }
  });
}
function ossPorts(home, env) {
  const ports = [OSS_PORT, Number(env.OSS_PROXY_PORT)];
  try {
    const config = JSON.parse(userConfigText(home) ?? "{}");
    const models = isRecord2(config) ? config.models : void 0;
    if (isRecord2(models)) ports.push(Number(models.proxyPort));
  } catch {
  }
  return [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port < 65536))];
}
function ownFolder(ctx) {
  const temp = reviewUserTemp(ctx.platform, ctx.tmpdir, ctx.sandboxDeps?.userTemp);
  return temp === null ? null : privateFolder2(temp, ctx.hook.sessionId, ctx.hook.agentId);
}
var OFFLOAD_RECORD = "offload";
var OFFLOAD_PRINTED = /^(\/[^\n]*\/oss-offload\.[A-Za-z0-9.]+)\/prompt\.md\n?$/;
function recordOffloadFolder(ctx, command) {
  const { hook } = ctx;
  const printed = OFFLOAD_PRINTED.exec(hook.stdout ?? "");
  if (printed === null || !command.includes("mktemp -d -t oss-offload.") || !isSafeId(hook.agentId) || !isSafeId(hook.sessionId)) return;
  const folder = import_node_path31.default.normalize(printed[1] ?? "");
  const temp = tempRoots(ctx);
  if (!temp.some((root) => folder.startsWith(`${root}/`)) || !offloadFolderSafe(folder, temp) || !isOwnStep(ctx, command)) return;
  try {
    appendPrivateFile(import_node_path31.default.join(sessionFolder(ctx.home, hook.sessionId), `${hook.agentId}.${OFFLOAD_RECORD}`), `${folder}
`);
  } catch {
  }
}
function offloadFoldersOf(ctx) {
  const { sessionId, agentId } = ctx.hook;
  if (!import_node_path31.default.isAbsolute(ctx.home) || !isSafeId(agentId) || sessionState(ctx.home, sessionId) !== "ok") return [];
  try {
    const text = readPrivateFile(import_node_path31.default.join(runRoot(ctx.home), sessionId, `${agentId}.${OFFLOAD_RECORD}`));
    return text === null ? [] : text.split("\n").filter((line) => import_node_path31.default.isAbsolute(line));
  } catch {
    return [];
  }
}
var MAX_WRITE_BEFORE_BYTES = 5 * 1024 * 1024;
var MAX_RULE_FILE_BYTES = 1024 * 1024;
function readRegularFileOrNull(absPath) {
  const read = readRegularFile(absPath, MAX_WRITE_BEFORE_BYTES);
  return typeof read === "object" ? read.text : null;
}
var MAX_SCRIPT_FILE_BYTES = 64 * 1024;
function readScriptFile(absPath) {
  const read = readRegularFile(absPath, MAX_SCRIPT_FILE_BYTES);
  return typeof read === "object" ? read.text : null;
}
function readRuleFile(absPath) {
  const read = readRegularFile(absPath, MAX_RULE_FILE_BYTES);
  if (read === "missing") return null;
  if (read === "not-regular") throw new Error("not a regular file under 1 MB");
  return read.text;
}
function userConfigText(home) {
  if (!import_node_path31.default.isAbsolute(home)) return null;
  const read = readRegularFile(import_node_path31.default.join(home, ".oss", "config.json"), MAX_RULE_FILE_BYTES);
  return typeof read === "object" ? read.text : null;
}
function logDecision(store, event) {
  try {
    store.appendEvent(event);
  } catch {
  }
}
function bashCommand(toolInput) {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const command = toolInput.command;
  return typeof command === "string" ? command : null;
}
function tellEvent(hook, mode) {
  if (hook !== null && HOOK_EVENTS.has(hook.hookEventName)) return hook.hookEventName;
  return mode === "pre" ? "PreToolUse" : "PostToolUse";
}
function allow(hookEventName, context) {
  if (context === void 0) return { exitCode: 0, stdout: "", stderr: "" };
  const output = { hookSpecificOutput: { hookEventName, additionalContext: context } };
  return { exitCode: 0, stdout: `${JSON.stringify(output)}
`, stderr: "" };
}
var MAX_AGENT_FILE_BYTES = 256 * 1024;
var SETUP_SCRIPTS = ["agent-model-check.js", "agent-offload.js"];
function isOwnStep(ctx, command) {
  const file = ownAgentFile(ctx.hook.agent);
  if (file === null || ctx.bundleRoot === void 0 || !import_node_path31.default.isAbsolute(ctx.bundleRoot)) return false;
  const read = readRegularFile(import_node_path31.default.join(ctx.bundleRoot, "agents", file), MAX_AGENT_FILE_BYTES);
  const temp = tempRoots(ctx);
  if (typeof read !== "object" || !isOwnSetupStep(command, read.text, temp, [...reviewedRepos(ctx), ctx.home], (folder) => offloadFolderSafe(folder, temp))) return false;
  try {
    const own = import_node_fs19.default.realpathSync(ctx.bundleRoot);
    const roots = [ctx.pluginRoot, import_node_path31.default.join(ctx.home, ".claude", "plugins", "oss")].filter((root) => import_node_path31.default.isAbsolute(root));
    return roots.every(
      (root) => SETUP_SCRIPTS.every((script) => {
        const at = import_node_path31.default.join(root, "watcher", "dist", "cli", script);
        return !import_node_fs19.default.existsSync(at) || import_node_fs19.default.realpathSync(at).startsWith(`${own}${import_node_path31.default.sep}`);
      })
    );
  } catch {
    return false;
  }
}
function trustedPluginRoot(ctx) {
  if (ctx.bundleRoot === void 0 || !import_node_path31.default.isAbsolute(ctx.bundleRoot)) return null;
  const installed = import_node_path31.default.join(ctx.home, ".claude", "plugins", "oss");
  const named2 = ctx.pluginRoot !== "" ? ctx.pluginRoot : installed;
  if (!import_node_path31.default.isAbsolute(named2) || !import_node_path31.default.isAbsolute(installed)) return null;
  try {
    const own = import_node_fs19.default.realpathSync(ctx.bundleRoot);
    const installedOk = !import_node_fs19.default.existsSync(installed) || import_node_fs19.default.realpathSync(installed) === own;
    return import_node_fs19.default.realpathSync(named2) === own && installedOk ? own : null;
  } catch {
    return null;
  }
}
function pluginInRepo(ctx) {
  try {
    const plugin = import_node_fs19.default.realpathSync(ctx.pluginRoot);
    return [ctx.root, ...reviewedRepos(ctx)].some((repo) => {
      const real = import_node_fs19.default.realpathSync(repo);
      return plugin === real || plugin.startsWith(`${real}${import_node_path31.default.sep}`);
    });
  } catch {
    return true;
  }
}
function pluginProtected(ctx) {
  try {
    const hookFile = import_node_path31.default.join(import_node_fs19.default.realpathSync(ctx.pluginRoot), "hooks", "oss-hook.sh");
    return isProtected(hookFile, ctx.settings, placesOf(ctx.root, ctx.home, ctx.paths, ctx.caseInsensitive), ctx.paths);
  } catch (error) {
    if (error instanceof OverBudget) throw error;
    return false;
  }
}
function trustedSourcesOf(ctx) {
  const plugin = import_node_path31.default.isAbsolute(ctx.pluginRoot) && pluginProtected(ctx) && !pluginInRepo(ctx) ? [import_node_path31.default.join(ctx.pluginRoot, "hooks")] : [];
  return { folders: [...homesOf(ctx.home).map((home) => import_node_path31.default.join(home, ".oss", "hooks")), ...plugin], pluginRootVariable: plugin.length > 0 };
}
function withCallVariables(ctx, command) {
  if (!command.includes("$") || isGateAgent(ctx.hook.agent, ctx.settings.gateAgents)) return command;
  try {
    return resolveCallVariables(command, ctx.home, trustedPluginRoot(ctx));
  } catch (error) {
    if (error instanceof OverBudget) throw error;
    return command;
  }
}
async function checkBash(ctx, command) {
  const { hook, root, home, settings } = ctx;
  const read = withCallVariables(ctx, command);
  const follow = !isGateAgent(hook.agent, settings.gateAgents);
  const facts = readCommand(read, hook.cwd, home, ctx.caseInsensitive, toplevelOf, readScriptFile, ctx.cdpath, follow, trustedSourcesOf(ctx), ctx.env);
  if ("unreadable" in facts && facts.limit) return { refusal: tooComplex(facts.reason) };
  const ownStep = isOwnStep(ctx, command);
  const reviewer = ownStep ? null : ("unreadable" in facts ? checkGateAgentUnreadable(hook.agent, settings, facts.reason) : null) ?? checkGateAgentCommand(hook.agent, settings, command);
  if (reviewer !== null) return { refusal: reviewer };
  const tooLarge = checkCallSize(facts.parts);
  if (tooLarge !== null) return { refusal: tooLarge };
  const { paths } = ctx;
  const places = placesOf(root, home, paths, ctx.caseInsensitive);
  const trustOf = trustForCall(repoTrust);
  const sources = trustedSourcesOf(ctx);
  const repos = reviewedRepos(ctx);
  for (const [index, part] of facts.parts.entries()) {
    const refusal3 = checkUnknownGitOption(part) ?? checkAllowProtocolMention(command, facts.parts) ?? checkPushSetup(part, facts.parts, index) ?? checkTransportMention(command, facts.parts) ?? checkLocalRemote(part, facts.parts, index) ?? checkRepoTrust(part, trustOf) ?? checkBranchSwitch(part, facts.parts, index, settings, void 0, ctx.caseInsensitive) ?? await checkBranchRefs(part, settings, ctx.git, ctx.caseInsensitive) ?? await checkProtectedBranch(part, settings, ctx.git, branchCreatedBefore(facts.parts, index), ctx.caseInsensitive) ?? await checkHistoryMove(part, settings, ctx.git, branchCreatedBefore(facts.parts, index), void 0, ctx.caseInsensitive) ?? checkForcePush(part, settings) ?? checkTags(part, settings) ?? checkProductionHost(part, settings) ?? checkOssHookEnv(part, command, home, sources) ?? checkArchLaunchctlMention(part, settings, places, paths, home) ?? checkVerdictCaptureCall(part, command, { home, pluginRoot: ctx.pluginRoot, paths, caseInsensitive: ctx.caseInsensitive }) ?? checkProtectedPathBash(part, settings, root, home, paths, ctx.caseInsensitive, places, ctx.tree) ?? (ownStep ? null : checkGateAgentBash(part, hook.agent, settings, { repos, home, exists: import_node_fs19.default.existsSync, temp: tempRoots(ctx), fallback: ctx.containment?.kind === "fallback", darwin: ctx.platform === "darwin", sandboxed: ctx.containment?.kind === "sandbox" }, paths, ctx.caseInsensitive, { earlier: facts.parts.slice(0, index), background: hook.background })) ?? await checkGitClean(part, settings, root, home, paths, ctx.git, ctx.caseInsensitive, places, { earlier: facts.parts, count: index, tree: ctx.tree }) ?? await checkGitStash(part, settings, root, home, paths, ctx.git, places, { earlier: facts.parts, count: index }) ?? checkProtectedPathMention(part, settings, root, home, paths, ctx.caseInsensitive, places);
    if (refusal3 !== null) return { refusal: refusal3, program: part.program };
  }
  if ("unreadable" in facts && !ownStep) {
    const risky = checkUnreadable(facts.reason, facts.parts, settings, root, home, ctx.caseInsensitive);
    if (risky !== null) return { refusal: risky };
    logDecision(ctx.store, { ts: ctx.ts, tool: hook.toolName, kind: "unreadable", result: "allowed" });
  }
  return null;
}
function shown(reason) {
  return reason.replaceAll(UNKNOWN, "\u2026").replaceAll("\0", "");
}
function checkEdit(ctx) {
  const { hook, root, home, settings } = ctx;
  const target = readEditTarget(hook.toolName, hook.toolInput, hook.cwd, home);
  if (target === null) return null;
  const guarded = checkProtectedPathEdit(target, settings, root, home, ctx.paths, ctx.caseInsensitive);
  if (guarded !== null) return { refusal: guarded };
  const reviewer = isGateAgent(hook.agent, settings.gateAgents);
  const reviewed = checkGateAgentEdit(target, hook.agent, settings, { repos: reviewedRepos(ctx), home, exists: import_node_fs19.default.existsSync, temp: tempRoots(ctx), privateDir: reviewer ? ownFolder(ctx) : null, offloadFolders: reviewer ? offloadFoldersOf(ctx) : [] }, ctx.paths, ctx.caseInsensitive);
  if (reviewed !== null) return { refusal: reviewed };
  const call = readEditCall(hook.toolName, hook.toolInput, hook.cwd, home, readRegularFileOrNull);
  if (call === null) return null;
  const refusal3 = checkFocusedTests(call, settings, root, home, ctx.caseInsensitive) ?? checkRedCycle(call, settings, root, home, fileWorkflowState(root), ctx.store);
  return refusal3 === null ? null : { refusal: refusal3 };
}
function record2(ctx, command) {
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
function isMonitorCall(hook) {
  if (hook.toolName === "Monitor") return true;
  return hook.toolName === "Bash" && isRecord2(hook.toolInput) && ("timeout_ms" in hook.toolInput || "ws" in hook.toolInput);
}
var MONITOR_REFUSED = {
  rule: "gate-agent-write",
  reason: "Refused by gate-agent-write: a review agent may not use the Monitor tool (it runs outside the review sandbox). Run the check as a Bash call that ends, or report what you need to the main agent."
};
function uncontained(reason) {
  return {
    rule: "gate-agent-write",
    reason: `Refused by gate-agent-write: ${reason}. Run nothing for now and report what you need to the main agent; the user can check that /usr/bin/sandbox-exec works and that the reviewed repo and HOME are not inside the review sandbox's private temp folder.`
  };
}
async function containedInput(ctx, command) {
  const { containment, hook } = ctx;
  if (containment === null || isOwnStep(ctx, command)) return null;
  if (containment.kind === "refused") return { refusal: uncontained(containment.reason) };
  if (containment.kind === "fallback") {
    logDecision(ctx.store, { ts: ctx.ts, tool: hook.toolName, kind: "review-fallback", result: "allowed" });
    return null;
  }
  const readable = await readableRepos(ctx);
  if (readable.timedOut) return { refusal: { rule: "gate-agent-write", reason: `Refused by gate-agent-write: ${readable.problem ?? ""}.` } };
  if (readable.problem !== null) return { refusal: uncontained(`the review sandbox can't open the reviewed repos: ${readable.problem}`) };
  const wrapped = isRecord2(hook.toolInput) ? containment.wrap(command, readable.repos, readable.hidden) : null;
  if (wrapped === null || !isRecord2(hook.toolInput)) return { refusal: uncontained("a reviewed repo or HOME is inside the review sandbox's private folder, so the sandbox can't keep it read-only") };
  return { input: { ...hook.toolInput, command: wrapped } };
}
var MOUNT_TABLE_MS = 1200;
function mountPlaces(ctx, table) {
  const mountedOn = new Set(table.map((entry) => entry.at));
  const top = toplevelOf(ctx.hook.cwd);
  const candidates = withReal([ctx.root, ...top === null ? [] : [top], ...namedRepos(ctx)].filter((dir) => import_node_path31.default.isAbsolute(dir) && dir !== import_node_path31.default.parse(dir).root));
  const roots = candidates.filter((dir) => mountedOn.has(dir) || isToplevel(dir));
  const temp = reviewUserTemp(ctx.platform, ctx.tmpdir, ctx.sandboxDeps?.userTemp);
  const own = temp === null ? [] : [privateFolderPath(temp, ctx.hook.sessionId, ctx.hook.agentId)];
  const gate = [...import_node_path31.default.isAbsolute(ctx.home) ? [import_node_path31.default.join(ctx.home, ".claude"), import_node_path31.default.join(ctx.home, ".oss")] : [], ctx.pluginRoot, ...ctx.bundleRoot === void 0 ? [] : [ctx.bundleRoot]];
  const fixed = [...own, ...gate.filter((dir) => import_node_path31.default.isAbsolute(dir) && dir !== import_node_path31.default.parse(dir).root)];
  return { watched: withReal([...roots, ...roots.flatMap(gitFoldersOf), ...fixed]), above: withReal([...candidates, ...fixed]) };
}
function readMountTable(mounts, now) {
  try {
    const start = now();
    const table = mounts !== void 0 ? mounts() : mountTable(process.platform, MOUNT_TABLE_MS);
    return now() - start > MOUNT_TABLE_MS ? null : table;
  } catch {
    return null;
  }
}
function voidRun(ctx) {
  const { sessionId, agentId } = ctx.hook;
  try {
    if (isSafeId(sessionId) && isSafeId(agentId) && import_node_path31.default.isAbsolute(ctx.home)) mark(ctx.home, sessionId, agentId, "tamper");
  } catch {
  }
}
var refusedFor = (what) => ({ refusal: { rule: "gate-agent-write", reason: `Refused by gate-agent-write: ${what}` } });
function mountRefusal(ctx, mode) {
  const table = ctx.mountTable !== void 0 ? ctx.mountTable : readMountTable(ctx.mounts, ctx.clock);
  const linux = ctx.platform === "linux";
  if (table === null) {
    if (mode === "post") voidRun(ctx);
    return refusedFor(
      mode === "post" ? "the gate couldn't read the mount table after your call, so it can't tell whether the code under review was swapped; this review is void. Stop and report this to the main agent." : "the gate couldn't read the mount table, which it needs before a review agent's call so it can tell whether anything was mounted over the code under review or the gate. Try again, or report this to the main agent."
    );
  }
  if (linux && mode === "pre") {
    try {
      recordMountBaseline(ctx.home, ctx.hook.sessionId, ctx.hook.agentId, table);
    } catch {
      return refusedFor("the gate couldn't record the mount table in its state under ~/.oss/gate-state, which it needs before a review agent's call so it can tell later whether anything was mounted over the code under review. Try again, or report this to the main agent.");
    }
  }
  const baseline = !linux ? [] : import_node_path31.default.isAbsolute(ctx.home) ? readMountBaseline(ctx.home, ctx.hook.sessionId, ctx.hook.agentId) : null;
  let found2;
  try {
    const places = mountPlaces(ctx, table);
    const added = baseline === null ? [] : notIn(table, baseline);
    const gone = baseline === null ? [] : notIn(baseline, table);
    found2 = baseline === null ? null : [...mountedAtOrUnder(added, places.watched), ...mountedAtOrUnder(gone, places.watched), ...linux ? mountedAbove([...added, ...gone], places.above) : []];
  } catch {
    found2 = null;
  }
  if (found2 !== null && found2.length === 0) return null;
  voidRun(ctx);
  const what = found2 === null ? baseline === null ? "the gate has no mount baseline from before your calls, so it can't tell whether the code under review was swapped" : "the gate couldn't work out which places to check for mounts, so it can't tell whether the code under review was swapped" : `a file system was mounted or unmounted ${linux ? "at, under or above" : "at or under"} the reviewed repo, your private folder or the gate's own folders (\`${found2[0]?.at ?? ""}\`), so the code under review or the gate may have been swapped`;
  return refusedFor(`${what}; this review is void. Stop and report this to the main agent.`);
}
async function decide(req, call) {
  const loaded = loadSettings(readRuleFile, req.env.CLAUDE_PLUGIN_ROOT, call.root);
  const settings = withUserReviewPrograms(loaded.settings, userConfigText(call.home));
  const { hook } = call;
  const command = hook.toolName === "Bash" ? bashCommand(hook.toolInput) : null;
  const reviewer = req.mode === "pre" && isGateAgent(hook.agent, settings.gateAgents);
  const containment = reviewer && command !== null ? reviewContainment(
    {
      platform: call.platform,
      home: call.home,
      sessionId: hook.sessionId,
      env: req.hookEnv ?? process.env,
      agentId: hook.agentId,
      ...call.tmpdir === void 0 ? {} : { tmpdir: call.tmpdir },
      ports: ossPorts(call.home, req.hookEnv ?? process.env),
      toolInput: hook.toolInput,
      disabled: req.env.OSS_TOOL_GATE_SANDBOX === "off",
      ...call.sandboxDeps?.userTemp === void 0 ? {} : { userTemp: call.sandboxDeps.userTemp },
      ...call.sandboxDeps?.passwordHome === void 0 ? {} : { passwordHome: call.sandboxDeps.passwordHome },
      ...call.sandboxDeps?.settingsHomes === void 0 ? {} : { settingsHomes: call.sandboxDeps.settingsHomes }
    },
    call.sandboxDeps?.run
  ) : null;
  const ctx = { ...call, settings, containment };
  let refused3 = null;
  const reviewCall = command !== null && isGateAgent(hook.agent, settings.gateAgents);
  const mounted = reviewer || req.mode === "post" && reviewCall ? mountRefusal(ctx, req.mode) : null;
  if (req.mode === "post") {
    refused3 = mounted;
    if (command !== null) record2(ctx, command);
    if (reviewCall && command !== null) recordOffloadFolder(ctx, command);
  } else if (mounted !== null) {
    refused3 = mounted;
  } else if (reviewer && isMonitorCall(hook)) {
    refused3 = { refusal: MONITOR_REFUSED };
  } else if (reviewer && READ_TOOLS.has(hook.toolName)) {
    const readable = await readableRepos(call);
    const read = checkReviewRead(hook.toolName, hook.toolInput, hook.cwd, { homes: homesOf(call.home), repos: readable.repos, hidden: readable.hidden, problem: readable.problem, privateDir: ownFolder(call), ...call.tmpdir === void 0 ? {} : { tmpdir: call.tmpdir } }, call.caseInsensitive);
    refused3 = read === null ? null : { refusal: read };
  } else {
    try {
      refused3 = command !== null ? await checkBash(ctx, command) : checkEdit(ctx);
    } catch (error) {
      if (!(error instanceof OverBudget)) throw error;
      refused3 = { refusal: tooComplex(error.what) };
    }
  }
  const contained = refused3 === null && reviewer && command !== null ? await containedInput(ctx, command) : null;
  if (contained !== null && "refusal" in contained) refused3 = contained;
  const updatedInput = contained !== null && "input" in contained ? contained.input : null;
  const refusal3 = refused3?.refusal ?? null;
  if (refused3 !== null) {
    logDecision(ctx.store, {
      ts: ctx.ts,
      tool: hook.toolName,
      kind: "refusal",
      rule: refused3.refusal.rule,
      ...programField(refused3.program),
      result: "refused"
    });
  }
  if (loaded.rejected !== void 0) {
    logDecision(ctx.store, {
      ts: ctx.ts,
      tool: hook.toolName,
      kind: "rule-file-rejected",
      result: refusal3 !== null ? "refused" : "allowed"
    });
  }
  if (refusal3 !== null) {
    const reason = shown(refusal3.reason);
    const stderr = loaded.rejected === void 0 ? reason : `${reason}
${loaded.rejected}`;
    return { exitCode: 2, stdout: "", stderr: `${stderr}
` };
  }
  if (updatedInput !== null) {
    const context = loaded.rejected === void 0 ? IN_SANDBOX : `${IN_SANDBOX}
${loaded.rejected}`;
    const output = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput, additionalContext: context } };
    return { exitCode: 0, stdout: `${JSON.stringify(output)}
`, stderr: "" };
  }
  if (reviewer && command !== null) return OUTSIDE_SANDBOX_ALLOW;
  return allow(hook.hookEventName, loaded.rejected);
}
var OUTSIDE_SANDBOX_NOTE = "This command runs outside the review sandbox.";
var OUTSIDE_SANDBOX_ALLOW = {
  exitCode: 0,
  stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: OUTSIDE_SANDBOX_NOTE } })}
`,
  stderr: ""
};
var IN_SANDBOX = "This command runs in the review sandbox: 'Operation not permitted' under your home or outside $TMPDIR comes from the sandbox, not from the code under review.";
var UNCHECKED_REVIEW = "Refused by gate-agent-write: the gate could not finish checking this review agent's call (it timed out or failed), and a review agent's call that can't be checked is refused. Write the command more simply, or report what you need to the main agent.\n";
function reviewerOrUnknown(req, hook) {
  if (hook === null || hook.agent === void 0) return false;
  for (const root of [req.env.CLAUDE_PLUGIN_ROOT, req.bundleRoot]) {
    if (root === void 0 || !import_node_path31.default.isAbsolute(root)) continue;
    try {
      return isGateAgent(hook.agent, readGateAgents(root, projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd)));
    } catch {
    }
  }
  return true;
}
function failed(req, hook, store, timedOut = false) {
  if (req.mode === "post" && hook !== null && reviewerOrUnknown(req, hook)) voidRun({ hook, home: req.env.HOME });
  const reviewer = req.mode === "pre" && reviewerOrUnknown(req, hook);
  const late = !reviewer && timedOut && req.mode === "pre";
  try {
    store?.appendEvent({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      tool: hook?.toolName ?? "unknown",
      kind: "gate-error",
      result: reviewer || late ? "refused" : "allowed"
    });
  } catch {
  }
  if (reviewer) return { exitCode: 2, stdout: "", stderr: UNCHECKED_REVIEW };
  if (late) return { exitCode: 2, stdout: "", stderr: TIMED_OUT_REFUSAL };
  return allow(tellEvent(hook, req.mode), TELL);
}
function gateErrorResult(req, timedOut = false) {
  let hook = null;
  let store = null;
  try {
    hook = readHook(req.input);
    store = fileStateStore(projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd));
  } catch {
  }
  return failed(req, hook, store, timedOut);
}
async function runToolGate(req, deps = {}) {
  let hook = null;
  let store = null;
  let timer;
  let late = false;
  try {
    hook = readHook(req.input);
    const root = projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    store = fileStateStore(root);
    const now = deps.clock ?? (() => performance.now());
    const mountTable2 = reviewerOrUnknown(req, hook) && (req.mode === "pre" || hook.toolName === "Bash") ? readMountTable(deps.mounts, now) : void 0;
    const timedOut = new Promise((resolve2) => {
      timer = setTimeout(() => resolve2(null), TIMEOUT_MS2);
    });
    const call = {
      hook,
      root,
      home: req.env.HOME,
      store,
      git: budgetedGitReader(deps.gitReader ?? gitReaderFor(root), GIT_LIMITS),
      paths: createPathResolver(PATH_LIMITS),
      tree: createTreeFinder(TREE_LIMITS),
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      caseInsensitive: CASE_INSENSITIVE_PLATFORMS.has(deps.platform ?? process.platform),
      cdpath: req.env.CDPATH === "" ? void 0 : req.env.CDPATH,
      bundleRoot: req.bundleRoot,
      pluginRoot: req.env.CLAUDE_PLUGIN_ROOT,
      tmpdir: req.env.TMPDIR === "" ? void 0 : req.env.TMPDIR,
      env: req.hookEnv ?? process.env,
      platform: deps.platform ?? process.platform,
      sandboxDeps: deps.sandbox,
      nestedGit: deps.nestedGit,
      mounts: deps.mounts,
      clock: now,
      mountTable: mountTable2
    };
    const result = await Promise.race([withDeadline(DECISION_MS, now, () => decide(req, call)), timedOut]);
    if (result === null) {
      late = true;
      throw new Error("tool-gate timed out");
    }
    return result;
  } catch {
    return failed(req, hook, store, late);
  } finally {
    clearTimeout(timer);
  }
}

// src/cli/tool-gate.ts
var USAGE = "Usage: tool-gate pre|post < hook.json\n";
var HARD_LIMIT_MS = 2500;
function ownPluginRoot() {
  return typeof __dirname === "string" ? import_node_path32.default.resolve(__dirname, "..", "..", "..") : "";
}
function modeOf(argv) {
  const mode = argv[0];
  return mode === "pre" || mode === "post" ? mode : null;
}
function gateEnv(env) {
  const { HOME = "", CLAUDE_PROJECT_DIR, CDPATH: CDPATH2, TMPDIR, OSS_TOOL_GATE_SANDBOX } = env;
  return { HOME, CLAUDE_PLUGIN_ROOT: env.CLAUDE_PLUGIN_ROOT || ownPluginRoot(), CLAUDE_PROJECT_DIR, CDPATH: CDPATH2, TMPDIR, OSS_TOOL_GATE_SANDBOX };
}
async function runCli(argv, input, env) {
  const mode = modeOf(argv);
  if (mode === null) return { exitCode: 1, stdout: "", stderr: USAGE };
  const bundleRoot = ownPluginRoot();
  return runToolGate({ mode, input, env: gateEnv(env), ...bundleRoot === "" ? {} : { bundleRoot } });
}
function isGateResult(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return typeof v.exitCode === "number" && typeof v.stdout === "string" && typeof v.stderr === "string";
}
function gitRunOf(value) {
  if (typeof value !== "object" || value === null) return null;
  const run = value.gitRun;
  if (typeof run !== "object" || run === null) return null;
  const r = run;
  const ok = typeof r.id === "number" && typeof r.gitBin === "string" && Array.isArray(r.args) && r.args.every((a) => typeof a === "string") && typeof r.cwd === "string" && typeof r.timeoutMs === "number" && typeof r.maxLines === "number";
  return ok ? run : null;
}
function gitResultOf(value) {
  if (typeof value !== "object" || value === null) return null;
  const result = value.gitResult;
  if (typeof result !== "object" || result === null) return null;
  const r = result;
  return typeof r.id === "number" && (typeof r.out === "string" || r.out === null) ? { id: r.id, out: r.out } : null;
}
function isWorkerRequest(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return Array.isArray(v.argv) && typeof v.input === "string" && typeof v.env === "object" && v.env !== null;
}
var liveGroups = /* @__PURE__ */ new Set();
function decideInWorker(script, argv, input, env, limitMs = HARD_LIMIT_MS) {
  const mode = modeOf(argv);
  if (mode === null) return Promise.resolve({ exitCode: 1, stdout: "", stderr: USAGE });
  const request2 = { argv: [...argv], input, env };
  return new Promise((resolve2) => {
    const worker = new import_node_worker_threads.Worker(script, { workerData: { toolGate: request2 } });
    let done = false;
    const running = /* @__PURE__ */ new Set();
    const finish = (result, timedOut = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.removeAllListeners("message");
      void worker.terminate();
      for (const pid of running) {
        killGroup(pid);
        liveGroups.delete(pid);
      }
      const bundleRoot = ownPluginRoot();
      resolve2(result ?? gateErrorResult({ mode, input, env: gateEnv(env), ...bundleRoot === "" ? {} : { bundleRoot } }, timedOut));
    };
    const timer = setTimeout(() => finish(null, true), limitMs);
    const tracker = {
      started: (pid) => {
        running.add(pid);
        liveGroups.add(pid);
      },
      ended: (pid) => {
        running.delete(pid);
        liveGroups.delete(pid);
      }
    };
    worker.on("message", (message) => {
      if (answerNestedGit(message, tracker, (reply) => !done && worker.postMessage(reply))) return;
      const run = gitRunOf(message);
      if (run === null) {
        finish(isGateResult(message) ? message : null);
        return;
      }
      void runGit(run.gitBin, run.args, run.cwd, run.timeoutMs, run.maxLines, tracker).then((out) => {
        if (!done) worker.postMessage({ gitResult: { id: run.id, out } });
      });
    });
    worker.once("error", () => finish(null));
    worker.once("exit", () => finish(null));
  });
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
function runMain(script, argv) {
  const killAll = () => {
    for (const pid of liveGroups) killGroup(pid);
    liveGroups.clear();
  };
  process.once("exit", killAll);
  process.once("SIGTERM", () => {
    killAll();
    process.kill(process.pid, "SIGTERM");
  });
  readStdin().then((input) => decideInWorker(script, argv, input, process.env)).then(answer, () => answer({ exitCode: 1, stdout: "", stderr: "tool-gate: could not read the hook input\n" }));
}
var request = import_node_worker_threads.isMainThread ? void 0 : import_node_worker_threads.workerData?.toolGate;
if (isWorkerRequest(request)) {
  const waiting = /* @__PURE__ */ new Map();
  let nextId = 0;
  import_node_worker_threads.parentPort?.on("message", (message) => {
    const result = gitResultOf(message);
    if (result === null) return;
    waiting.get(result.id)?.(result.out);
    waiting.delete(result.id);
  });
  if (import_node_worker_threads.parentPort !== null) nestedGitViaPort(import_node_worker_threads.parentPort);
  setGitRunner(
    (gitBin, args, cwd, timeoutMs, maxLines) => new Promise((resolve2) => {
      const id = nextId++;
      waiting.set(id, resolve2);
      import_node_worker_threads.parentPort?.postMessage({ gitRun: { id, gitBin, args, cwd, timeoutMs, maxLines } });
    })
  );
  void runCli(request.argv, request.input, request.env).then(
    (result) => import_node_worker_threads.parentPort?.postMessage(result),
    () => import_node_worker_threads.parentPort?.postMessage(null)
  );
} else if (import_node_worker_threads.isMainThread && /tool-gate\.(js|cjs)$/.test(process.argv[1] || "")) {
  runMain(import_node_path32.default.resolve(process.argv[1]), process.argv.slice(2));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HARD_LIMIT_MS,
  decideInWorker,
  runCli,
  runMain
});
