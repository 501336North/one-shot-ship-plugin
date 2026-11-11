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
  HARD_LIMIT_MS: () => HARD_LIMIT_MS,
  decideInWorker: () => decideInWorker,
  runCli: () => runCli
});
module.exports = __toCommonJS(tool_gate_exports);
var import_node_path20 = __toESM(require("node:path"), 1);
var import_node_worker_threads = require("node:worker_threads");

// src/tool-gate/gate.ts
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_path19 = __toESM(require("node:path"), 1);

// src/tool-gate/command-reader.ts
var import_node_path3 = __toESM(require("node:path"), 1);

// src/tool-gate/patterns.ts
var import_node_path = __toESM(require("node:path"), 1);

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
  function ask(key, run) {
    const known = asked.get(key);
    if (known !== void 0) return known;
    const answer2 = (async () => {
      if (asked.size >= limits.maxRuns) throw new OverBudget(`more than ${limits.maxRuns} different git lookups`);
      const left = deadline - now();
      if (left <= 0) throw new OverBudget("git took too long to answer");
      const result = await run(left);
      if (now() >= deadline) throw new OverBudget("git took too long to answer");
      return result;
    })();
    asked.set(key, answer2);
    return answer2;
  }
  return {
    currentBranch: (dir) => ask(JSON.stringify(["branch", dir]), (timeoutMs) => inner.currentBranch(dir, timeoutMs)),
    wouldClean: (dir, options, pathspecs) => ask(JSON.stringify(["clean", dir, options, pathspecs]), (timeoutMs) => inner.wouldClean(dir, options, pathspecs, timeoutMs))
  };
}

// src/tool-gate/deadline.ts
var current = new import_node_async_hooks.AsyncLocalStorage();
var CHECK_EVERY = 256;
function withDeadline(ms, now, run) {
  return current.run({ at: now() + ms, now, ticks: 0 }, run);
}
function tick() {
  const deadline = current.getStore();
  if (deadline !== void 0 && ++deadline.ticks % CHECK_EVERY === 0 && deadline.now() > deadline.at) {
    throw new OverBudget("checking it took too long");
  }
}

// src/tool-gate/patterns.ts
var ANY_FOLDERS = "**";
var ONE_NAME = "?*";
function wildcardMatch(pattern, text, isStar, matches) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    tick();
    if (p < pattern.length && isStar(pattern[p])) {
      star = p++;
      mark = t;
    } else if (p < pattern.length && matches(pattern[p], text[t])) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      t = ++mark;
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
    list = globs.map((glob) => compile(glob, opts));
    lists.set(globs, list);
  }
  return list;
}
function matchAnyPath(globs, absPath, opts) {
  const target = targetOf(absPath, opts);
  return compiledList(globs, opts).some((glob) => segmentsMatch(glob, target));
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
function classEnd(segment, open) {
  let j = open + 1;
  if (segment[j] === "!" || segment[j] === "^") j++;
  if (segment[j] === "]") j++;
  while (j < segment.length && segment[j] !== "]") {
    if (segment[j] === "\\") {
      j += 2;
    } else if (segment[j] === "[" && ":.=".includes(segment[j + 1] ?? "")) {
      const close = segment.indexOf(`${segment[j + 1]}]`, j + 2);
      j = close === -1 ? j + 1 : close + 2;
    } else {
      j++;
    }
  }
  return j < segment.length ? j : -1;
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
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === "\\" && i + 1 < segment.length) {
      atoms.push(literal(segment[++i]));
    } else if (c === "*") {
      if (atoms[atoms.length - 1]?.run !== true) atoms.push({ run: true });
    } else if (c === "?") {
      atoms.push({ run: false, char: null, test: ANY_CHAR });
    } else if (c === "[" && classEnd(segment, i) !== -1) {
      const end = classEnd(segment, i);
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
      const segments = segmentLists[n];
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
function walk(g, atoms, accept, dots = false) {
  const n = g.length;
  const m = atoms.length;
  const seen = new Uint8Array((n + 1) * (m + 1));
  const todo = [0];
  seen[0] = 1;
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
    if (i === n && accept(j)) return true;
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
function shellSegments(pattern, opts) {
  const normal = import_node_path.default.posix.normalize(opts.caseInsensitive === true ? pattern.toLowerCase() : pattern);
  return normal.split("/").map((s) => s === ANY_FOLDERS ? null : shellAtoms(s));
}
function named(b) {
  return b !== null && b.some((atom) => !atom.run && atom.char !== null);
}
function tailMayBeProtected(tail, globs, opts, dots = false, contents = false) {
  const g = shellSegments(belowClimb(tail), opts).filter((s, n) => n > 0 || s === null || s.length > 0);
  return shapesOf(globs, opts).some((p) => {
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
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "\\") i++;
    else if (c === "*" || c === "?" || c === "[" && classEnd(glob, i) !== -1) return true;
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
var DOTS = /* @__PURE__ */ new WeakSet();
function dotsOf(token) {
  return DOTS.has(token);
}
var EXTGLOB_START = /[!@+]$/;
var CODE_QUALIFIER = /[e+]/;
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
var COMMAND_START_WORDS = /* @__PURE__ */ new Set(["then", "do", "else", "elif", "if", "while", "until", "{", "!", "time"]);
var DOUBLE_QUOTE_ESCAPABLE = '$`"\\\n';
var Unreadable = class extends Error {
};
var ReadingLimit = class extends Error {
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
function tokenize(cmd, home, budget = new ReadBudget()) {
  if (cmd.length > MAX_INPUT_CHARS) return { unreadable: true, reason: "command larger than 1 MB", limit: true, tokens: [] };
  const flags = { unreadable: null };
  const scanner = new Scanner(cmd.replaceAll("\0", ""), home, budget, flags);
  try {
    const tokens = scanner.script(0, false);
    return flags.unreadable === null ? { tokens } : { unreadable: true, reason: flags.unreadable, limit: false, tokens };
  } catch (err) {
    if (err instanceof ReadingLimit) return { unreadable: true, reason: err.message, limit: true, tokens: [] };
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
  scripts = [];
  started = false;
  /** Any part was quoted or escaped: then a heredoc delimiter makes its body literal, and the word is no keyword. */
  quoted = false;
  /** A glob qualifier (`*(D)`) may make the pattern match dot entries too. */
  dots = false;
  /** Quoted, escaped or expanded text: never a wildcard. */
  add(text) {
    this.text += text;
    this.glob += escapeGlob(text);
    this.started = true;
  }
  /** An unquoted character as typed: `*`, `?` and `[` in it are wildcards. */
  addPlain(c) {
    this.text += c;
    this.glob += c;
    this.started = true;
  }
  addBrace(c) {
    this.braces.push(this.text.length);
    this.globBraces.push(this.glob.length);
    this.addPlain(c);
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
    const endWord = () => {
      if (!word.started) return;
      const done = word;
      word = new Word();
      const heredoc = pendingRedirect !== null && HEREDOC_OPERATORS.includes(pendingRedirect);
      this.budget.checkChars(done.text.length);
      const values = heredoc ? [done.text] : expandBraces(done.text, done.braces, this.budget);
      this.budget.take(values.length, values.reduce((n, v) => n + v.length, 0));
      const globs = !heredoc && hasShellWildcard(done.glob) ? expandBraces(done.glob, done.globBraces, new ReadBudget()) : [];
      const withGlob = (token, n) => {
        const glob = globs.length === values.length ? globs[n] : void 0;
        if (glob !== void 0 && hasShellWildcard(glob)) GLOBS.set(token, glob);
        if (done.dots) DOTS.add(token);
        return token;
      };
      const scripts = done.scripts.length > 0 ? { scripts: done.scripts } : {};
      if (pendingRedirect !== null) {
        const op = pendingRedirect;
        const redirects = values.map((target, n) => withGlob({ kind: "redirect", op, target, ...n === 0 ? scripts : {} }, n));
        if (heredoc) {
          heredocs.push({ delimiter: done.text, stripTabs: op === "<<-", token: redirects[0], literal: done.quoted });
        }
        tokens.push(...redirects);
        pendingRedirect = null;
        return;
      }
      if (!done.quoted) readCaseWord(done.text);
      tokens.push(...values.map((value, n) => withGlob({ kind: "word", value, ...n === 0 ? scripts : {} }, n)));
    };
    const atCommandStart = () => {
      const last = tokens[tokens.length - 1];
      return last === void 0 || last.kind === "op" || last.kind === "word" && COMMAND_START_WORDS.has(last.value);
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
      if (c === "#" && !word.started) {
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
      if (c === "(" && word.started && (hasShellWildcard(word.glob) || EXTGLOB_START.test(word.glob))) {
        this.qualifier(word);
        continue;
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
      if (caseTop === "pattern" && (operator === ")" || operator === "(")) {
        if (operator === ")") cases[cases.length - 1] = "body";
        tokens.push({ kind: "op", value: operator });
        continue;
      }
      if (caseTop === "body" && operator === ";;") cases[cases.length - 1] = "pattern";
      if (closed && operator === ")" && parens === 0) return tokens;
      if (operator === "(") parens++;
      if (operator === ")") parens--;
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
   * code (`e:…:`, `+name`) makes the call unreadable (ADR-010).
   */
  qualifier(word) {
    const { cmd } = this;
    let depth = 0;
    let end = this.i;
    for (; end < cmd.length; end++) {
      tick();
      if (cmd[end] === "(") depth++;
      else if (cmd[end] === ")" && --depth === 0) break;
    }
    if (end >= cmd.length) throw new Unreadable("unterminated glob qualifier");
    const inside = cmd.slice(this.i + 1, end);
    if (CODE_QUALIFIER.test(inside)) this.flags.unreadable ??= `the glob qualifier (${inside}) can run a command`;
    const extglob = EXTGLOB_START.test(word.glob);
    const start = extglob ? word.glob.slice(0, -1) : word.glob;
    word.glob = start.endsWith("*") ? start : `${start}*`;
    word.text += `(${inside})`;
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
var SHELLS = /* @__PURE__ */ new Set(["bash", "sh", "zsh", "dash", "ksh"]);
var SHELL_VALUE_OPTIONS = /* @__PURE__ */ new Set(["-o", "-O", "--rcfile", "--init-file"]);
var SHORT_OPTION_CLUSTER = /^[-+][A-Za-z0-9]+$/;
var ATTACHED_OPTION_NAME = /^[-+][oO][A-Za-z_]{2,}$/;
var COMMAND_STRING_FLAG = /^-[A-Za-z0-9]*c/;
var DYNAMIC_SCRIPT = /\$\(|`|\$[A-Za-z_{0-9@*#?!$-]/;
var MAX_NESTED_DEPTH = 5;
var MAX_GROUP_DEPTH = 64;
var MAX_WRAPPERS = 64;
var PIPES = ["|", "|&"];
var KEYWORDS = /* @__PURE__ */ new Set(["if", "then", "elif", "else", "fi", "do", "done", "while", "until", "!"]);
var CD_PREFIXES = /* @__PURE__ */ new Set(["command", "builtin", "time"]);
var ReadingLimit2 = class extends Error {
};
var OUTPUT_REDIRECT = /^[0-9]*(?:>>?[|!]?|<>)$|^&>>?[|!]?$|^>>?&[|!]$/;
var FD_DUPLICATION = /^&(?:[0-9]+-?|-)$/;
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;
var ASSIGNMENT_PARTS = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\])?(\+?)=/;
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
function readCommand(cmd, cwd, home, caseInsensitive = false, toplevel, readFile, cdpath) {
  const reading = {
    home,
    budget: new ReadBudget(),
    unreadable: null,
    caseInsensitive,
    toplevel: toplevel ?? null,
    readFile: readFile ?? null,
    written: /* @__PURE__ */ new Set(),
    files: /* @__PURE__ */ new Map(),
    scriptCommands: /* @__PURE__ */ new Map(),
    scanned: 0,
    cdpath: cdpath === void 0 ? null : compactCdpath(cdpath.split(":"))
  };
  try {
    const parts = readScript(cmd, cwd, reading, 0);
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
  return result.tokens;
}
function readScript(cmd, cwd, reading, depth, dots = false) {
  return readTokens(tokensOf(cmd, reading), cwd, reading, depth, dots);
}
function readTokens(tokens, cwd, reading, depth, dots = false) {
  const segments = split(tokens, cwd, reading.home, reading.toplevel, dots, reading.cdpath);
  return segments.flatMap((segment) => toParts(segment, segments, reading, depth));
}
var TOPLEVEL_WORDS = ["git", "rev-parse", "--show-toplevel"];
function isToplevelWord(token) {
  const script = token.scripts?.length === 1 ? token.scripts[0] : null;
  return token.value === UNKNOWN && script !== null && script.length === TOPLEVEL_WORDS.length && script.every((t, n) => t.kind === "word" && t.value === TOPLEVEL_WORDS[n]);
}
var VARIABLE_BUILTINS = /* @__PURE__ */ new Set(["export", "declare", "typeset", "readonly", "local"]);
function setsGitVariable(commandWords, assigned) {
  if (commandWords.length === 0 && assigned.some((w) => w.startsWith("GIT_"))) return true;
  return VARIABLE_BUILTINS.has(commandWords[0] ?? "") && commandWords.slice(1).some((w) => w.startsWith("GIT_"));
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
function split(tokens, cwd, home, toplevel = null, dots = false, startCdpath = null) {
  const segments = [];
  const groups = [];
  const pushed = [];
  let header = null;
  let casePatterns = false;
  let caseDepth = 0;
  let closedGroupStart = null;
  let afterPipe = false;
  let dir = cwd;
  let lost = null;
  let gitVariableSet = false;
  let dotGlob = dots;
  let cdpath = startCdpath;
  let cdpathArray = null;
  let dotsWord = false;
  let pipedFrom = null;
  let words = [];
  let redirects = [];
  let globs = /* @__PURE__ */ new Map();
  let scripts = [];
  const atCommandStart = () => words.length === 0 && redirects.length === 0;
  const openGroup = (groupDir) => {
    if (groups.length >= MAX_GROUP_DEPTH) throw new ReadingLimit2(`groups nested deeper than ${MAX_GROUP_DEPTH}`);
    groups.push({ dir: groupDir, lost, dotGlob, start: segments.length });
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
      cwd: dir,
      lostDir: lost,
      exits: [{ op: next, following: segments.length + 1 }],
      scripts,
      dotGlob: dotGlob || dotsWord,
      pipedFrom
    });
    const apart = afterPipe || isPipe(next) || next === "&";
    if (cdpathArray !== null) {
      cdpath = compactCdpath(cdpathArray === "append" ? [...cdpath ?? [], ...commandWords] : commandWords);
      cdpathArray = null;
    }
    if (!apart) {
      const searched = commandWords.length > 0 ? cdpathAfter(assigned, [], cdpath) : cdpath;
      ({ dir, lost } = dirAfter(commandWords, { dir, lost }, pushed, home, globs, searched));
      dotGlob = dotGlobAfter(commandWords, assigned, dotGlob);
    }
    cdpathArray = cdpathArrayOf(commandWords, assigned);
    cdpath = cdpathAfter(commandWords.length === 0 ? assigned : [], VARIABLE_BUILTINS.has(commandWords[0] ?? "") ? commandWords.slice(1) : [], cdpath);
    gitVariableSet ||= setsGitVariable(commandWords, assigned);
    dotsWord = false;
    pipedFrom = null;
    words = [];
    redirects = [];
    globs = /* @__PURE__ */ new Map();
    scripts = [];
  };
  const readWord = (w, glob) => {
    if (glob !== void 0) globs.set(w, glob);
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
      openGroup(null);
    } else if (w === "}") {
      const group = groups.pop();
      if (group !== void 0) closedGroupStart = group.start;
    } else if (!KEYWORDS.has(w)) {
      words.push(w);
    }
  };
  for (let k = 0; k < tokens.length; k++) {
    tick();
    const token = tokens[k];
    if (token.kind !== "op" && token.scripts !== void 0) scripts.push(...token.scripts);
    if (dotsOf(token)) dotsWord = true;
    if (token.kind === "word") {
      const top = toplevel !== null && lost === null && !gitVariableSet && isToplevelWord(token) ? toplevel(dir) : null;
      readWord(top ?? token.value, globOf(token));
    } else if (token.kind === "redirect") {
      const body = heredocBodyOf(token);
      redirects.push({ op: token.op, target: token.target, ...body === void 0 ? {} : { body } });
      const glob = globOf(token);
      if (glob !== void 0) globs.set(token.target, glob);
    } else if (casePatterns || header === "case") {
      if (casePatterns && token.value === ")") casePatterns = false;
    } else if (token.value === "(" && isOp(tokens[k + 1], ")")) {
      words = [];
      k++;
    } else {
      if (header === "for") header = null;
      const before = segments.length;
      close(token.value);
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
  const { words, cwd, assignments, values, lost, terminal, writes, alternates } = unwrap(segment.words, segment.cwd, reading);
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
  const operandsWritten = [...operandWrites(name, args, segment.globs), ...scriptFacts?.writes ?? []];
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
    stdinScripts: stdinScriptsOf(segment, name, args, reading),
    lostDir: segment.lostDir ?? lost ?? gitDirLost,
    hosts: args.flatMap(hostOf),
    git,
    pipedOut: segment.exits.some((e) => isPipe(e.op)),
    orTrue: segment.exits.some((e) => e.op === "||" && isTrue(segments[e.following]?.words ?? [])),
    followedByAnd: segment.exits[0]?.op === "&&",
    dotGlob: segment.dotGlob,
    terminal
  };
  const settings = [
    ...settingParts(part, reading, depth),
    ...scriptCommandParts(scriptFacts, part, reading, depth),
    ...alternateParts(alternates, segment, segments, part, reading, depth)
  ];
  for (const target of part.writeTargets) reading.written.add(import_node_path3.default.resolve(target));
  const script = scriptOf(name, program === null ? null : import_node_path3.default.posix.basename(program), args) ?? stdinShellScript(name, args, part.stdinScripts) ?? expectSpawns(name, args, cwd, reading, stdinFed(segment));
  if (script === null) return [part, ...settings];
  if (DYNAMIC_SCRIPT.test(script) || script.includes(UNKNOWN)) {
    reading.unreadable ??= `${name} runs a script that is not literal`;
    return [part, ...settings];
  }
  if (depth >= MAX_NESTED_DEPTH) throw new ReadingLimit2(`scripts nested deeper than ${MAX_NESTED_DEPTH}`);
  const nested = readScript(script, cwd, reading, depth + 1, part.dotGlob || shellDots(name, args, part.assignments, part.assignmentValues));
  return [part, ...settings, ...nested.map((p) => ({
    ...p,
    assignments: [...part.assignments, ...p.assignments],
    pipedOut: p.pipedOut || part.pipedOut,
    orTrue: p.orTrue || part.orTrue,
    // an `expect` spawn runs with a terminal of its own
    terminal: p.terminal || part.terminal || name === "expect"
  }))];
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
var SAFE_GIT_VARIABLE = /^(?:GIT_(?:AUTHOR|COMMITTER)_(?:NAME|EMAIL|DATE)|GIT_TRACE[A-Za-z0-9_]*)$/;
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
  const alternates = [];
  const assignments = [];
  const values = [];
  let lost = null;
  let terminal = false;
  const writes = [];
  let dir = cwd;
  let rest = words;
  let unwrapped = 0;
  const wrapperOf = (word) => word === void 0 ? void 0 : WRAPPERS.get(programName(word, reading));
  rest = withEquals(rest);
  for (let spec = first ?? wrapperOf(rest[0]); spec !== void 0; spec = wrapperOf(rest[0])) {
    if (++unwrapped > MAX_WRAPPERS) throw new ReadingLimit2(`more than ${MAX_WRAPPERS} wrappers`);
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
      if (spec.assignments === true && ASSIGNMENT.test(w)) {
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
  return { words: rest, cwd: dir, assignments, values, lost, terminal, writes, alternates };
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
  const first = words.findIndex((w) => !ASSIGNMENT.test(w));
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
    if (index !== null || append && name === ZSH_CDPATH) {
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
  if (rest.length === 0) return { dir: home, lost: null };
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
function destination(args, values = []) {
  const t = args.indexOf("-t");
  if (t !== -1 && t + 1 < args.length) return [args[t + 1]];
  return operands(args, values).slice(-1);
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
function tarWrites(args) {
  if (!tarExtracts(args)) return [];
  const dirs = [];
  args.forEach((a, i) => {
    if ((a === "-C" || a === "--directory") && i + 1 < args.length) dirs.push(args[i + 1]);
    else if (a.startsWith("--directory=")) dirs.push(a.slice("--directory=".length));
    else if (/^-C./.test(a)) dirs.push(a.slice(2));
  });
  return dirs.length > 0 ? dirs : ["."];
}
var UNZIP_NO_WRITE = /^-[A-Za-z]*[ltpvZz]/;
function unzipWrites(args) {
  if (args.some((a) => UNZIP_NO_WRITE.test(a))) return [];
  const d = args.indexOf("-d");
  if (d !== -1 && d + 1 < args.length) return [args[d + 1]];
  const attached = args.find((a) => /^-d./.test(a));
  return attached === void 0 ? ["."] : [attached.slice(2)];
}
var CP_VALUES = ["-S", "--suffix", "-t", "--target-directory"];
var CP_TARGET = /^(?:-t(.+)|--target-directory=(.*))$/;
function cpOperands(args) {
  const named2 = operands(args, CP_VALUES);
  for (let i = 0; i < args.length && args[i] !== "--"; i++) {
    const a = args[i];
    const attached = CP_TARGET.exec(a);
    const target = attached === null ? a === "-t" || a === "--target-directory" ? args[i + 1] : void 0 : attached[1] ?? attached[2];
    if (target !== void 0) return { sources: named2, dest: target, targetDir: true };
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
  if (!BACKUP_PROGRAMS.has(name)) return false;
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
  switch (name) {
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
function operandWrites(name, args, globs) {
  switch (name) {
    case "ditto": {
      const named2 = operands(args, DITTO_VALUES);
      return named2.length > 1 ? named2.slice(-1) : [];
    }
    case "rsync":
      return rsyncWrites(args);
    case "tar":
    case "bsdtar":
    case "gtar":
      return tarWrites(args);
    case "unzip":
      return unzipWrites(args);
    case "rm":
    case "mv":
    case "tee":
    case "touch":
      return operands(args);
    case "cp":
      return cpWrites(args, globs);
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
    case "gsed":
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

// src/tool-gate/git-reader.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
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
      child = (0, import_node_child_process.spawn)(gitBin, [...HARDENING, ...args], { cwd, env: gitEnv(), detached: true, stdio: ["ignore", "pipe", "ignore"] });
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
  for (let at = dir; ; at = import_node_path4.default.dirname(at)) {
    const stat = import_node_fs.default.lstatSync(import_node_path4.default.join(at, ".git"), { throwIfNoEntry: false });
    if (stat !== void 0) return !stat.isDirectory() && at !== projectRoot;
    if (import_node_path4.default.dirname(at) === at) return false;
  }
}
function nearestFolder(dir) {
  const isFolder = (p) => {
    try {
      return import_node_fs.default.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
    } catch {
      return false;
    }
  };
  let at = dir;
  while (!isFolder(at) && import_node_path4.default.dirname(at) !== at) at = import_node_path4.default.dirname(at);
  return at;
}
function gitReaderFor(projectRoot, gitBin = "git") {
  return {
    async currentBranch(dir, timeoutMs = TIMEOUT_MS) {
      const out = await runner(gitBin, ["symbolic-ref", "--short", "-q", "HEAD"], nearestFolder(dir), timeoutMs, Infinity);
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
      const out = await runner(gitBin, args, dir, timeoutMs, MAX_DRY_RUN_LINES);
      if (out === null) return null;
      const removed = out.split("\n").filter((line) => line.startsWith(WOULD_REMOVE)).map((line) => line.slice(WOULD_REMOVE.length));
      return removed.some((p) => p.startsWith('"')) ? null : removed;
    }
  };
}
var realGitReader = gitReaderFor(null);

// src/tool-gate/path-resolver.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var MAX_LINKS = 40;
var NOTHING_BELOW = /* @__PURE__ */ new Set(["ENOENT", "ENAMETOOLONG", "ENOTDIR"]);
function namesReversed(p) {
  return p.split("/").filter((name) => name !== "" && name !== ".").reverse();
}
function parentOf(resolved) {
  const slash = resolved.lastIndexOf("/");
  return slash <= 0 ? "/" : resolved.slice(0, slash);
}
var NO_LIMITS = { maxLookups: Infinity, maxSteps: Infinity };
function resolve(absPath, lookup, step) {
  let resolved = "/";
  let links = 0;
  let missingDepth = 0;
  const todo = namesReversed(absPath);
  for (let name = todo.pop(); name !== void 0; name = todo.pop()) {
    step();
    if (name === "..") {
      resolved = parentOf(resolved);
      if (missingDepth > 0) missingDepth--;
      continue;
    }
    const next = resolved === "/" ? `/${name}` : `${resolved}/${name}`;
    if (missingDepth > 0) {
      resolved = next;
      missingDepth++;
      continue;
    }
    const { target, nothingBelow } = lookup(next);
    if (nothingBelow) missingDepth = 1;
    if (target === null) {
      resolved = next;
      continue;
    }
    if (++links > MAX_LINKS) return null;
    if (target.startsWith("/")) resolved = "/";
    todo.push(...namesReversed(target));
  }
  return resolved;
}
function createPathResolver(limits = NO_LIMITS, readlink = import_node_fs2.default.readlinkSync) {
  const lookups = /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  let steps = 0;
  const step = () => {
    tick();
    if (++steps > limits.maxSteps) throw new OverBudget(`it makes the gate walk more than ${limits.maxSteps} path names`);
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
      const resolved = resolve(absPath, lookup, step) ?? absPath;
      results.set(absPath, resolved);
      return resolved;
    }
  };
}

// src/tool-gate/regular-file.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
function readRegularFile(absPath, maxBytes, noFollow = false) {
  const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = import_node_fs3.default.constants;
  let fd;
  try {
    fd = import_node_fs3.default.openSync(absPath, O_RDONLY | O_NONBLOCK | (noFollow ? O_NOFOLLOW : 0));
  } catch (error) {
    return error.code === "ENOENT" ? "missing" : "not-regular";
  }
  try {
    const stat = import_node_fs3.default.fstatSync(fd);
    if (!stat.isFile() || stat.size >= maxBytes) return "not-regular";
    return { text: import_node_fs3.default.readFileSync(fd, "utf8") };
  } catch {
    return "not-regular";
  } finally {
    import_node_fs3.default.closeSync(fd);
  }
}

// src/tool-gate/repo-finder.ts
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var MAX_POINTER_BYTES = 4096;
var GITDIR_LINE = /^gitdir: (.+?)\r?\n?$/;
var HEAD_CONTENT = /^(?:ref:\s*refs\/.*|[0-9a-f]{40}|[0-9a-f]{64})\s*$/;
var WORKTREES = "worktrees";
var MODULES = "modules";
var GIT = ".git";
function isDir(p) {
  try {
    return import_node_fs4.default.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
function pointer(file) {
  const read = readRegularFile(file, MAX_POINTER_BYTES);
  return typeof read === "object" ? read.text : null;
}
function commonDirOf(gitDir) {
  const file = import_node_path5.default.join(gitDir, "commondir");
  if (import_node_fs4.default.lstatSync(file, { throwIfNoEntry: false }) === void 0) return gitDir;
  const text = pointer(file);
  return text === null ? null : import_node_path5.default.resolve(gitDir, text.trim());
}
function isGitDir(dir) {
  const head = import_node_path5.default.join(dir, "HEAD");
  const stat = import_node_fs4.default.lstatSync(head, { throwIfNoEntry: false });
  if (stat === void 0) return false;
  if (stat.isSymbolicLink()) {
    if (!import_node_fs4.default.readlinkSync(head).startsWith("refs/")) return false;
  } else {
    const text = pointer(head);
    if (text === null || !HEAD_CONTENT.test(text)) return false;
  }
  const common = commonDirOf(dir);
  return common !== null && isDir(import_node_path5.default.join(common, "objects")) && isDir(import_node_path5.default.join(common, "refs"));
}
function found(top, gitDir, viaFile) {
  const commonDir = commonDirOf(gitDir);
  if (commonDir === null) return { kind: "unsure", why: `${import_node_path5.default.join(gitDir, "commondir")} can't be read` };
  return { kind: "repo", top, gitDir, commonDir, viaFile };
}
function walk2(start) {
  for (let dir = start; ; dir = import_node_path5.default.dirname(dir)) {
    tick();
    const dotGit = import_node_path5.default.join(dir, GIT);
    const stat = import_node_fs4.default.lstatSync(dotGit, { throwIfNoEntry: false });
    if (stat?.isDirectory() === true) {
      if (isGitDir(dotGit)) return found(dir, dotGit, false);
    } else if (stat?.isFile() === true) {
      const match = GITDIR_LINE.exec(pointer(dotGit) ?? "");
      const gitDir = match === null ? null : import_node_path5.default.resolve(dir, match[1]);
      if (gitDir === null || !isGitDir(gitDir)) return { kind: "unsure", why: `${dotGit} points at no git folder` };
      return found(dir, gitDir, true);
    } else if (stat !== void 0) {
      return { kind: "unsure", why: `${dotGit} is neither a folder nor a file` };
    }
    if (isGitDir(dir)) return { kind: "unsure", why: `${dir} is itself a git folder` };
    if (import_node_path5.default.dirname(dir) === dir) return { kind: "none" };
  }
}
function findRepo(dir) {
  try {
    return walk2(import_node_fs4.default.realpathSync(dir));
  } catch (error) {
    if (error instanceof OverBudget) throw error;
    return { kind: "unsure", why: `${dir} can't be read` };
  }
}
function isDotGit(dir) {
  return import_node_path5.default.basename(dir) === GIT;
}
function ownGitFolder(gitDir, commonDir) {
  const parent = import_node_path5.default.dirname(gitDir);
  if (import_node_path5.default.basename(parent) === WORKTREES) {
    const main = import_node_path5.default.dirname(parent);
    return isDotGit(main) && import_node_fs4.default.realpathSync(commonDir) === import_node_fs4.default.realpathSync(main);
  }
  return commonDir === gitDir && gitDir.includes(`${import_node_path5.default.sep}${GIT}${import_node_path5.default.sep}${MODULES}${import_node_path5.default.sep}`);
}
function repoTrust(dir) {
  let at = dir;
  while (!isDir(at) && import_node_path5.default.dirname(at) !== at) {
    tick();
    at = import_node_path5.default.dirname(at);
  }
  const repo = findRepo(at);
  if (repo.kind === "none") return "none";
  if (repo.kind === "unsure") return { untrusted: repo.why };
  try {
    if (!repo.viaFile) {
      return repo.commonDir === repo.gitDir ? "trusted" : { untrusted: `${import_node_path5.default.join(repo.gitDir, "commondir")} sends git to another .git folder's settings` };
    }
    const gitDir = import_node_fs4.default.realpathSync(repo.gitDir);
    if (ownGitFolder(gitDir, repo.commonDir === repo.gitDir ? gitDir : repo.commonDir)) return "trusted";
  } catch {
  }
  return { untrusted: `${import_node_path5.default.join(repo.top, GIT)} points at a git folder outside a .git folder` };
}

// src/tool-gate/recorder.ts
var import_node_path8 = __toESM(require("node:path"), 1);

// src/tool-gate/state-store.ts
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);
var LOGGABLE_PROGRAM = /^[A-Za-z0-9._+-]{1,64}$/;
function programField(program) {
  const name = import_node_path6.default.basename(program ?? "");
  return LOGGABLE_PROGRAM.test(name) ? { program: name } : {};
}
var MAX_CYCLE_BYTES = 1024 * 1024;
function isCycleRecord(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return (v.startedAt === null || typeof v.startedAt === "string") && (v.lastResult === "red" || v.lastResult === "green") && Array.isArray(v.files) && v.files.every((f) => typeof f === "string") && (v.adoptedCommand === null || typeof v.adoptedCommand === "string");
}
function fileStateStore(repoRoot) {
  const ossDir = import_node_path6.default.join(repoRoot, ".oss");
  const stateDir = import_node_path6.default.join(ossDir, "tool-gates");
  const cycleFile = import_node_path6.default.join(stateDir, "cycle.json");
  const eventsFile = import_node_path6.default.join(stateDir, "events.ndjson");
  const { O_APPEND, O_CREAT, O_EXCL, O_NOFOLLOW, O_WRONLY } = import_node_fs5.default.constants;
  function refuseSymlinkedDirs() {
    for (const dir of [ossDir, stateDir]) {
      if (import_node_fs5.default.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`tool-gate state: ${dir} is a symlink`);
      }
    }
  }
  function safeStateDir() {
    refuseSymlinkedDirs();
    import_node_fs5.default.mkdirSync(stateDir, { recursive: true });
    const real = import_node_fs5.default.realpathSync(stateDir);
    if (!real.startsWith(import_node_fs5.default.realpathSync(repoRoot) + import_node_path6.default.sep)) {
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
      const fd = import_node_fs5.default.openSync(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW);
      try {
        import_node_fs5.default.writeFileSync(fd, JSON.stringify(cycle));
      } finally {
        import_node_fs5.default.closeSync(fd);
      }
      import_node_fs5.default.renameSync(temp, cycleFile);
    },
    appendEvent(event) {
      safeStateDir();
      const fd = import_node_fs5.default.openSync(eventsFile, O_APPEND | O_CREAT | O_WRONLY | O_NOFOLLOW);
      try {
        import_node_fs5.default.writeFileSync(fd, JSON.stringify(event) + "\n");
      } finally {
        import_node_fs5.default.closeSync(fd);
      }
    }
  };
}

// src/tool-gate/workflow-state.ts
var import_node_path7 = __toESM(require("node:path"), 1);
var BUILD_COMMAND = "build";
var MAX_STATE_BYTES = 1024 * 1024;
function fileWorkflowState(projectDir) {
  return {
    read() {
      const read = readRegularFile(import_node_path7.default.join(projectDir, ".oss", "workflow-state.json"), MAX_STATE_BYTES, true);
      if (read === "missing") return null;
      if (read === "not-regular") throw new Error("workflow state is not a regular file under 1 MB");
      const data = JSON.parse(read.text);
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
    (word) => word.toLowerCase().split(/[^a-z0-9]+/).some((piece) => TEST_WORDS.has(piece)) || matchAnyPath(settings.testFilePatterns, import_node_path8.default.resolve(part.cwd, word), { home, root })
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
    if (ctx.currentCommand !== BUILD_COMMAND || thisBuild.adoptedCommand !== null || !failedWithExitCode || call.isInterrupt === true || last === void 0 || NEVER_ADOPTED.has(import_node_path8.default.basename(last.program ?? "")) || facts.parts.some((part) => part.pipedOut || part.orTrue) || !isTestLike(last, ctx.settings, ctx.root ?? call.cwd, ctx.home)) {
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
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path9 = __toESM(require("node:path"), 1);
function* readEntries(dir) {
  const handle = import_node_fs6.default.opendirSync(dir);
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
          const full = import_node_path9.default.join(next, entry.name);
          if (wanted(entry.name)) found2.push(full);
          else if (entry.isDirectory()) todo.push(full);
        }
      }
      return found2;
    }
  };
}

// src/tool-gate/rule-file.ts
var import_node_path10 = __toESM(require("node:path"), 1);
var LIST_KEYS = [
  "protectedBranches",
  "testFilePatterns",
  "testCommandPatterns",
  "sourceExtensions",
  "protectedPaths",
  "productionHosts",
  "gateAgents"
];
var KNOWN_KEYS = /* @__PURE__ */ new Set(["version", "tagsAllowed", ...LIST_KEYS]);
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
    if (new Set(added.filter((value) => !base[key].includes(value))).size > MAX_REPO_ADDED) {
      return `${key} adds more than ${MAX_REPO_ADDED} values`;
    }
    if ((key === "testFilePatterns" || key === "testCommandPatterns") && !added.every((value) => base[key].includes(value))) {
      return `${key} is set by the plugin only`;
    }
    merged[key] = [.../* @__PURE__ */ new Set([...base[key], ...added])];
  }
  if (repo.tagsAllowed === true && !base.tagsAllowed) return "tagsAllowed true loosens the base false";
  if (repo.tagsAllowed === false) merged.tagsAllowed = false;
  return merged;
}
function loadSettings(readFile, pluginRoot, repoRoot) {
  if (!import_node_path10.default.isAbsolute(pluginRoot)) throw new Error("tool-gate plugin root is not an absolute path");
  const baseText = readFile(import_node_path10.default.join(pluginRoot, "config", "tool-gates.json"));
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
    repoText = readFile(import_node_path10.default.join(repoRoot, ".oss", "tool-gates.json"));
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

// src/tool-gate/calling-agent.ts
function callingAgentOf(record2) {
  const name = record2.agent_type;
  return typeof name === "string" && name !== "" ? name : void 0;
}
function isGateAgent(agent, gateAgents) {
  if (agent === void 0) return false;
  const bare = agent.startsWith("oss:") ? agent.slice("oss:".length) : agent;
  return gateAgents.includes(bare);
}

// src/tool-gate/rules/gate-agent-write.ts
var import_node_path12 = __toESM(require("node:path"), 1);

// src/tool-gate/rules/protected-path.ts
var import_node_path11 = __toESM(require("node:path"), 1);
var HOME_PREFIX = "~/";
var MAX_PATH_CHARS = 4096;
var MAX_PATH_SEGMENTS = 512;
function isTooLong(p) {
  return p.length > MAX_PATH_CHARS || p.split("/").length > MAX_PATH_SEGMENTS;
}
var TOO_LONG = {
  rule: "protected-path",
  reason: "Refused: writes a path too long for the gate to check (over 4096 characters or 512 folders)."
};
var WILDCARD = /[*?]/;
function placesOf(root, home, paths, caseInsensitive) {
  return [
    { home, root, caseInsensitive },
    { home: paths.realpath(home), root: paths.realpath(root), caseInsensitive }
  ];
}
function formsOf(absPath, paths) {
  return [import_node_path11.default.normalize(absPath), paths.realpath(absPath)];
}
function isProtected(absPath, settings, places, paths) {
  return formsOf(absPath, paths).some((p) => places.some((at) => matchAnyPath(settings.protectedPaths, p, at)));
}
function fixedFolder(glob, at) {
  let full;
  if (glob.startsWith(HOME_PREFIX)) full = import_node_path11.default.join(at.home, glob.slice(HOME_PREFIX.length));
  else if (import_node_path11.default.isAbsolute(glob)) full = import_node_path11.default.normalize(glob);
  else full = import_node_path11.default.join(at.root, glob);
  const segments = full.split(import_node_path11.default.sep);
  const first = segments.findIndex((segment) => WILDCARD.test(segment));
  return first === -1 ? full : segments.slice(0, first).join(import_node_path11.default.sep) || import_node_path11.default.sep;
}
function isSameOrAncestor(dir, of, caseInsensitive) {
  const relative = caseInsensitive ? import_node_path11.default.relative(dir.toLowerCase(), of.toLowerCase()) : import_node_path11.default.relative(dir, of);
  return relative !== ".." && !relative.startsWith(`..${import_node_path11.default.sep}`) && !import_node_path11.default.isAbsolute(relative);
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
    folders = globs.map((glob) => fixedFolder(glob, at));
    lists.set(globs, folders);
  }
  return folders;
}
function holdsProtected(absPath, settings, places, paths) {
  return formsOf(absPath, paths).some(
    (p) => places.some(
      (at) => fixedFoldersOf(settings.protectedPaths, at).some((folder) => isSameOrAncestor(p, folder, at.caseInsensitive === true))
    )
  );
}
function splitPattern(pattern) {
  const segments = pattern.split("/");
  const first = segments.findIndex((segment) => /(?:^|[^\\])[*?[]/.test(segment));
  if (first === -1) return null;
  return { prefix: segments.slice(0, first).join("/") || "/", rest: segments.slice(first).join("/") };
}
function patternReachesProtected(pattern, settings, places, paths, exemptAnchor = false, dots = false) {
  const forms = [pattern];
  const split2 = splitPattern(pattern);
  if (split2 !== null && !split2.prefix.includes("\\")) forms.push(`${escapeGlob(paths.realpath(split2.prefix))}/${split2.rest}`);
  return forms.some((form) => places.some((at) => shellGlobMayMatch(form, settings.protectedPaths, at, exemptAnchor, dots)));
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
  for (const target of part.writeTargets) {
    if (isTooLong(target)) return TOO_LONG;
    if (isProtected(target, settings, places, paths)) return refusal(target, "a protected file", root, home);
    if (holdsProtected(target, settings, places, paths)) {
      return refusal(target, "which holds protected files", root, home);
    }
  }
  for (const pattern of part.writeGlobs) {
    if (isTooLong(pattern)) return TOO_LONG;
    if (patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob)) {
      return refusal(pattern, "a wildcard the shell could expand to a protected path", root, home);
    }
  }
  const lost = part.lostDir === null ? null : lostPatternWrite(part, settings, places, paths, root, home) ?? lostTail(part, settings, places);
  return lost ?? nestedProtected(part, settings, paths, tree, caseInsensitive, root, home);
}
function lostPatternWrite(part, settings, places, paths, root, home) {
  const at = part.lostDir?.pattern ?? null;
  if (at === null) return null;
  const folder = `${part.cwd}/`;
  for (const target of part.writeTargets) {
    if (!target.startsWith(folder)) continue;
    const pattern = `${at}/${escapeGlob(target.slice(folder.length))}`;
    if (patternReachesProtected(pattern, settings, places, paths, false, part.dotGlob)) {
      return refusal(pattern, `after \`${part.lostDir?.why}\`, a path that could be protected`, root, home);
    }
  }
  return null;
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
function unreadableFolder(part) {
  return {
    rule: "protected-path",
    reason: `Refused: \`${import_node_path11.default.basename(part.program ?? "")}\` changes everything in a folder the gate can't read (a variable or command output). A recursive write must name its folder literally, so the gate can check it holds no .git or other protected file. Write the path out, for example \`/tmp/tmp.abc123\` instead of \`"$d"\`.`
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
  const lostIn = (p) => part.lostDir !== null && below(p, part.cwd) !== null;
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
function lostTail(part, settings, places) {
  const folder = `${part.cwd}/`;
  const patternFolder = escapeGlob(part.cwd);
  const relative = (paths, to) => paths.flatMap((p) => {
    const rel = below(p, to);
    return rel === null ? [] : [rel];
  });
  const tails = [
    ...part.writeTargets.filter((t) => t.startsWith(folder)).map((t) => [escapeGlob(t.slice(folder.length)), false, part.dotGlob]),
    // a wildcard, or a whole folder, could cover what any protected folder holds; rm -r and find reach dot entries
    ...relative(part.writeGlobs, patternFolder).map((g) => [g, true, part.dotGlob]),
    ...relative(part.recursiveTargets, part.cwd).map((t) => [everythingBelow(escapeGlob(t)), true, true]),
    ...relative(part.recursiveGlobs, patternFolder).map((g) => [everythingBelow(g), true, true])
  ];
  const tail = tails.find(([t, contents, dots]) => places.some((at) => tailMayBeProtected(t, settings.protectedPaths, at, dots, contents)))?.[0];
  if (tail === void 0) return null;
  return {
    rule: "protected-path",
    reason: `Refused: writes \`${tail}\` after \`${part.lostDir?.why}\`, in a folder the gate can't follow, where it could be a protected file. Run it after a \`cd\` to a plain path, or ask the user to run it with \`!\`.`
  };
}

// src/tool-gate/rules/gate-agent-write.ts
var WILDCARD_SEGMENT = /[*?[]/;
var REPORT_ONLY = "Review agents review and report only: report the problem and the fix, and the stack's builder agent (for example oss:typescript-pro) makes the change.";
function fixedPart(p) {
  const segments = p.split("/");
  const first = segments.findIndex((segment) => WILDCARD_SEGMENT.test(segment));
  return first === -1 ? p : segments.slice(0, first).join("/") || "/";
}
function touchesRepo(absPath, root, paths, caseInsensitive) {
  const fixed = fixedPart(absPath);
  const forms = [import_node_path12.default.normalize(fixed), paths.realpath(fixed)];
  const roots = [root, paths.realpath(root)];
  return forms.some(
    (p) => roots.some((r) => isSameOrAncestor(r, p, caseInsensitive) || isSameOrAncestor(p, r, caseInsensitive))
  );
}
function refusal2(what) {
  return { rule: "gate-agent-write", reason: `Refused by gate-agent-write: ${what}. ${REPORT_ONLY}` };
}
function checkGateAgentEdit(call, agent, settings, root, paths, caseInsensitive = false) {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  if (!touchesRepo(call.filePath, root, paths, caseInsensitive)) return null;
  return refusal2(`a review agent may not write \`${call.filePath}\`, inside the repo it reviews`);
}
function checkGateAgentBash(part, agent, settings, root, paths, caseInsensitive = false) {
  if (!isGateAgent(agent, settings.gateAgents)) return null;
  for (const target of [...part.writeTargets, ...part.writeGlobs]) {
    if (target.includes(UNKNOWN)) {
      return refusal2("a review agent may not write a path only known when the command runs; write the path out in full");
    }
    if (touchesRepo(target, root, paths, caseInsensitive)) {
      return refusal2(`a review agent may not write \`${target}\`, inside the repo it reviews`);
    }
  }
  return null;
}

// src/tool-gate/rules/focused-tests.ts
var import_node_path13 = __toESM(require("node:path"), 1);
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
  const relative = import_node_path13.default.relative(root, filePath);
  return relative === ".." || relative.startsWith(`..${import_node_path13.default.sep}`) || import_node_path13.default.isAbsolute(relative) ? filePath : relative;
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
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path14 = __toESM(require("node:path"), 1);
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
  let dryRun = false;
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
      if (isLong(a, DRY_RUN_LONG) || isLong(a, NO_DRY_RUN_LONG)) dryRun = isLong(a, DRY_RUN_LONG);
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
          dryRun = true;
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
  if (dryRun) return "dry-run";
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
    if (part.writeTargets.some((t) => IGNORE_FILES.has(import_node_path14.default.posix.basename(t)) || t.includes("/.git/"))) return part;
    if (part.writeGlobs.some((g) => g.includes("gitignore") || g.includes("/.git/"))) return part;
  }
  return null;
}
function onDiskFolder(p) {
  try {
    return import_node_fs7.default.lstatSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
function holdsRepo(dir) {
  try {
    return import_node_fs7.default.lstatSync(import_node_path14.default.join(dir, ".git"), { throwIfNoEntry: false }) !== void 0;
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

// src/tool-gate/rules/protected-branch.ts
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_path15 = __toESM(require("node:path"), 1);
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
var UPDATE_REF_VALUES = /* @__PURE__ */ new Set(["-m"]);
var BRANCH_MODE_LETTERS = /^-[A-Za-z]*[dDmMcCf]/;
var BRANCH_MODE_LONG = /* @__PURE__ */ new Set(["--delete", "--move", "--copy", "--force"]);
var BRANCH_VALUES = /* @__PURE__ */ new Set(["--contains", "--no-contains", "--merged", "--no-merged", "--points-at", "--sort", "--format", "-u", "--set-upstream-to"]);
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
    if (args.includes("--stdin")) {
      return { rule: "protected-branch", reason: "Refused: `git update-ref --stdin` reads the refs it changes from stdin, which the gate can't check. Change one ref per call instead." };
    }
    const [ref] = positionalsOf(args, UPDATE_REF_VALUES);
    if (ref === void 0) return null;
    if (ref === "HEAD") {
      if (args.includes("--no-deref")) return null;
      const current2 = await git.currentBranch(facts.dir);
      return current2 !== null && isProtected2(current2, branches) ? refChange("git update-ref HEAD", current2) : null;
    }
    return namesProtected(ref, branches) ? refChange(`git update-ref ${ref}`, ref) : null;
  }
  if (subcommand === "symbolic-ref") {
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
  if (subcommand === "fetch") {
    const target = positionalsOf(args, FETCH_VALUES).slice(1).filter((spec) => spec.includes(":")).map((spec) => protectedTarget(spec, branches)).find((dst) => dst !== void 0);
    return target === void 0 ? null : refChange(`git fetch ${args.join(" ")}`, target);
  }
  if (subcommand !== "branch") return null;
  const mode = args.find((a) => !a.startsWith("--") && BRANCH_MODE_LETTERS.test(a) || BRANCH_MODE_LONG.has(a));
  if (mode === void 0) return null;
  const named2 = positionalsOf(args, BRANCH_VALUES).find((w) => namesProtected(w, branches));
  return named2 === void 0 ? null : refChange(`git branch ${mode} \u2026 ${named2}`, named2);
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
  return import_node_fs8.default.lstatSync(absPath, { throwIfNoEntry: false }) !== void 0;
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
  return !PATHSPEC_ONLY.test(target) && !exists(import_node_path15.default.resolve(dir, target));
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
  if (sub === "branch" && args.some((a) => BRANCH_RENAME.test(a)) && positionalsOf(args, BRANCH_VALUES).length === 1) {
    return `git branch ${args.join(" ")}`;
  }
  return null;
}
var REWRITERS = /* @__PURE__ */ new Set(["filter-branch", "filter-repo", "fast-import", "replace"]);
var REFLOG_DROPS = /* @__PURE__ */ new Set(["delete", "expire"]);
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
  if (!REMOTE_NAME.test(repo) || exists(import_node_path15.default.resolve(git.dir, repo))) return false;
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

// src/tool-gate/rules/protected-path-mention.ts
var import_node_path16 = __toESM(require("node:path"), 1);
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
var INTERPRETERS = /* @__PURE__ */ new Set(["python", "python3", "node", "perl", "ruby", "sh", "bash", "zsh", "osascript", "deno", "bun"]);
var PYTHON2 = /^python[0-9.]*$/;
function isInterpreter(name) {
  return INTERPRETERS.has(name) || PYTHON2.test(name);
}
var SCRIPT_RUNNERS = /* @__PURE__ */ new Set(["source", "."]);
var SCRIPT_FLAG = /^(?:-[A-Za-z]*[ceE]|--eval|-p|--print)$/;
var QUOTES = /* @__PURE__ */ new Set(["'", '"', "`"]);
function foundPath(part, ctx, dir) {
  if (part.name !== "find") return null;
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
function isRootOrAbove(absPath, places) {
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
  return holds && !isRootOrAbove(import_node_path16.default.normalize(absPath), ctx.places) ? absPath : null;
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
  const interpreter = isInterpreter(name);
  if (!interpreter && !SCRIPT_RUNNERS.has(import_node_path16.default.posix.basename(part.program ?? ""))) return { words: args, scripts: [] };
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
  const literals = part.name === null || !isInterpreter(part.name) ? [] : scriptsOf(part, part.name).flatMap(stringLiterals);
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
  return glob.startsWith("~/") || glob.startsWith("**/") || import_node_path16.default.isAbsolute(glob);
}
function namedInScript(literals, dir, ctx) {
  const tails = ctx.settings.protectedPaths.filter(matchesOutsideRoot).map((glob) => `**/${glob.startsWith("~/") ? glob.slice(2) : glob}`);
  for (const literal2 of literals) {
    const named2 = namedPath(literal2, dir, ctx);
    if (named2 !== null) return named2;
    const tail = import_node_path16.default.posix.normalize(`/${literal2}`);
    if (ctx.places.some((at) => matchAnyPath(tails, tail, at))) return literal2;
  }
  return null;
}
var MAX_CALL_WORDS2 = 2048;
function stdinScriptChars(part) {
  return part.name === null || !isInterpreter(part.name) ? 0 : part.stdinScripts.reduce((n, script) => n + script.length, 0);
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
function lostTailNamed(part, words, ctx) {
  if (part.lostDir === null || part.name === null || safeInProtectedFolder(part, part.name)) return null;
  const relative = words.filter(
    (w) => /[./]/.test(w) && !w.startsWith("-") && !w.startsWith("~") && !import_node_path16.default.isAbsolute(w) && !w.includes(UNKNOWN)
  );
  const globOf2 = (w) => part.globs.get(w) ?? escapeGlob(w);
  return relative.find((w) => ctx.places.some((at) => tailMayBeProtected(globOf2(w), ctx.settings.protectedPaths, at, part.dotGlob))) ?? null;
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
  const named2 = words.flatMap(valuesOf).map((w) => namedPath(w, dir, ctx, !FOLDER_MAKERS.has(name))).find((p) => p !== null) ?? words.map((w) => namedPattern(part, w, dir, ctx)).find((p) => p !== null) ?? namedInScript(literals, dir, ctx) ?? lostTailNamed(part, [...words.flatMap(valuesOf), ...literals], ctx);
  if (named2 === null) return null;
  const shown2 = import_node_path16.default.isAbsolute(named2) ? displayPath(named2, root, home) : named2;
  return {
    rule: "protected-path-mention",
    reason: `Refused: \`${name}\` names \`${shown2}\`, a protected path, and only read-only programs may. To read it, use the Read tool or \`cat ${shown2} | ${name}\`. Ask the user to run it with \`!\`.`
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
var PUSH_SECTIONS = new Set(PUSH_KEYS.map((key) => key.split(".")[0]));
var CONFIG_FILE_OPTIONS = [
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
    ...CONFIG_FILE_OPTIONS,
    ...CONFIG_LEGACY_ACTIONS,
    ...CONFIG_DISPLAY_OPTIONS,
    ...CONFIG_TYPE_OPTIONS,
    negatableValue("default"),
    negatableValue("comment"),
    negatableFlag("fixed-value"),
    negatableFlag("includes")
  ]],
  ["get", [
    ...CONFIG_FILE_OPTIONS,
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
    ...CONFIG_FILE_OPTIONS,
    ...CONFIG_TYPE_OPTIONS,
    negatableFlag("all"),
    negatableValue("value"),
    negatableFlag("fixed-value"),
    negatableValue("comment"),
    negatableFlag("append")
  ]],
  ["unset", [...CONFIG_FILE_OPTIONS, negatableFlag("all"), negatableValue("value"), negatableFlag("fixed-value")]],
  ["list", [...CONFIG_FILE_OPTIONS, ...CONFIG_DISPLAY_OPTIONS, ...CONFIG_TYPE_OPTIONS, negatableFlag("includes")]],
  ["rename-section", CONFIG_FILE_OPTIONS],
  ["remove-section", CONFIG_FILE_OPTIONS],
  ["edit", CONFIG_FILE_OPTIONS]
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
var VARIABLE_SETTERS = /* @__PURE__ */ new Set(["export", "declare", "typeset", "readonly", "local"]);
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
  const key = positional[0];
  if (key === void 0 || read || !(write || section || positional.length >= 2)) return null;
  const lower = key.toLowerCase();
  if (section) return PUSH_SECTIONS.has(lower.split(".")[0]) ? key : null;
  if (keyMatches(CREDENTIAL_KEYS, lower)) return positional[1] !== void 0 && helperRuns(positional[1]) ? key : null;
  return PUSH_KEYS.some((pattern) => matchCommand(pattern, [lower])) ? key : null;
}
function variableChange(part) {
  const assigned = part.assignments.find((name) => GIT_REPO_VARIABLE.test(name) || part.program === null && setupVariable(name));
  if (assigned !== void 0) return part.assignments.join(" ");
  if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
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
function addsMirror(git) {
  return git.subcommand === "remote" && git.args[0] === "add" && git.args.some((a) => a === "--mirror" || a.startsWith("--mirror="));
}
function lostFolder(part) {
  if (part.lostDir === null) return null;
  return `\`${part.lostDir.why}\` moves it to a folder the gate can't follow`;
}
var TRACE_VARIABLE = /^GIT_TRACE[A-Za-z0-9_]*$/;
function unknownTrace(part, own) {
  const assigned = part.assignments.find((name, n) => TRACE_VARIABLE.test(name) && part.assignmentValues[n]?.includes(UNKNOWN) === true);
  if (assigned !== void 0 && (own || part.program === null)) return assigned;
  if (part.program === null || !VARIABLE_SETTERS.has(part.program)) return null;
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
  const planted = plantedConfig(part, earlier, count);
  if (planted !== null) {
    return {
      rule: "protected-branch",
      reason: `Refused: \`git ${part.git?.subcommand}\` with \`${planted}\` plants config or hooks in the new repository, which can change where pushes go or what git runs. Ask the user to run it with \`!\`.`
    };
  }
  const tty = fakeTtyPager(part, earlier, count);
  if (tty !== null) return runsRefusal(tty, `\`git ${part.git?.subcommand}\` (it has a terminal, so git starts its pager)`);
  const runs = runConfig(part, earlier, count) ?? uploadProgram(part);
  if (runs !== null) return runsRefusal(runs, `\`git ${part.git?.subcommand}\``);
  if (part.git?.subcommand === "config") {
    const key = pushKeyWritten(part.git.args);
    if (key === null) return null;
    if (typeof key !== "string") {
      return {
        rule: "protected-branch",
        reason: `Refused: the gate can't read \`git config\` option \`${key.unreadable}\` (one git doesn't have, or short for several), so it can't tell which key is written. Spell the options in full.`
      };
    }
    return {
      rule: "protected-branch",
      reason: `Refused: \`git config ${key}\` changes where pushes go or what git runs. Ask the user to change it with \`!\`.`
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
    if (part.program !== null && VARIABLE_SETTERS.has(part.program)) {
      const named2 = part.words.slice(1).map((w) => w.split("=")[0]).find((name) => NEW_REPO_VARIABLE.test(name));
      if (named2 !== void 0) return named2;
    }
  }
  return void 0;
}
function plantsKey(setting) {
  const key = (setting.includes("=") ? setting.slice(0, setting.indexOf("=")) : setting).toLowerCase();
  return key === TEMPLATE_KEY || PUSH_KEYS.some((pattern) => matchCommand(pattern, [key]));
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
var RUN_ANY_KEYS = ["core.hookspath", "alias.*", "include.path", "includeif.*.path", "protocol.allow", "protocol.ext.allow"];
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
function keyMatches(patterns, key) {
  return patterns.some((pattern) => matchCommand(pattern, [key.toLowerCase()]));
}
function runsProgram(key, value) {
  if (key.includes(UNKNOWN) || keyMatches(RUN_ANY_KEYS, key)) return true;
  if (keyMatches(CREDENTIAL_KEYS, key)) return value === void 0 || helperRuns(value);
  if (keyMatches(SSH_KEYS, key)) return value === void 0 || !harmlessSsh(value);
  const program = REMOTE_PROGRAM_KEYS.find(([pattern]) => keyMatches([pattern], key));
  if (program !== void 0) return value !== program[1];
  return keyMatches(RUN_COMMAND_KEYS, key) && (value === void 0 || !NO_PROGRAM_VALUES.has(value));
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
var SSH_VALUE_LETTERS = /* @__PURE__ */ new Set([..."plicmb"]);
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
].map((key) => key.toLowerCase()));
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
      if (letter !== SSH_OPTION_LETTER && !SSH_VALUE_LETTERS.has(letter)) return false;
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
    if (earlier[i].program === null || VARIABLE_SETTERS.has(earlier[i].program ?? "")) settings.push(...settingsOf(earlier[i]));
  }
  return settings;
}
function settingsOf(part) {
  const own = part.assignments.map((name, n) => [name, part.assignmentValues[n] ?? ""]);
  if (part.program === null || !VARIABLE_SETTERS.has(part.program)) return own;
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
var import_node_path17 = __toESM(require("node:path"), 1);
var NO_RUN = "Refused: No failing test recorded in this build. Write a failing test and run it on its own with a test command, unpiped (for example `npx vitest run <file>` or `pytest <file>`). Another command that names a test file or has the word test, spec or check in it, and fails, is taken as this build's test command.";
var DEV_DOCS = ".oss/dev/**";
function isSourceFile(filePath, settings, root, home) {
  return (
    // Any case: `foo.TS` is the same kind of file. Test-file patterns and the dev-docs folder stay
    // case-sensitive here, since matching them more widely would exempt more files from the rule.
    settings.sourceExtensions.some((ext) => ext.toLowerCase() === import_node_path17.default.extname(filePath).toLowerCase()) && !matchPath(DEV_DOCS, filePath, { home, root }) && !matchAnyPath(settings.testFilePatterns, filePath, { home, root })
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
      reason: `Refused: \`${import_node_path17.default.relative(root, call.filePath)}\` is not in this cycle and the last test run was green. Write a failing test and run it before editing a new source file.`
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
var import_node_path18 = __toESM(require("node:path"), 1);
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
var INTERPRETERS2 = /* @__PURE__ */ new Set([
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
var PYTHON3 = /^python[0-9.]*$/;
var TEXT_ONLY = { realpath: (p) => import_node_path18.default.normalize(p) };
function tooComplex(reason) {
  return {
    rule: "unreadable",
    reason: `Refused: this command is too complex for the gate to check (${reason}); split it into simpler commands.`
  };
}
function riskIn(part, settings, places, home) {
  const { name } = part;
  if (name === "git" && part.git !== null && GIT_WRITES.has(part.git.subcommand)) return `runs \`git ${part.git.subcommand}\``;
  if (name !== null && (INTERPRETERS2.has(name) || PYTHON3.test(name))) return `runs \`${name}\``;
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
var CASE_INSENSITIVE_PLATFORMS = /* @__PURE__ */ new Set(["darwin", "win32"]);
var GIT_LIMITS = { maxRuns: 8, timeMs: 1200 };
var PATH_LIMITS = { maxLookups: 2e4, maxSteps: 2e5 };
var TREE_LIMITS = { maxDirs: 1e4, maxEntries: 2e5, timeMs: 1e3 };
var DECISION_MS = 1e3;
var TELL = "tool-gate failed, rules not checked.";
var TIMEOUT_MS2 = 2e3;
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
    isInterrupt: record2.is_interrupt === true,
    agent: callingAgentOf(record2)
  };
}
function repoRootOf(cwd) {
  for (let dir = cwd; ; dir = import_node_path19.default.dirname(dir)) {
    if (import_node_fs9.default.existsSync(import_node_path19.default.join(dir, ".git"))) return dir;
    if (import_node_path19.default.dirname(dir) === dir) return cwd;
  }
}
function toplevelOf(dir) {
  const repo = findRepo(dir);
  return repo.kind === "repo" ? repo.top : null;
}
function projectRootOf(projectDir, cwd) {
  const usable = projectDir !== void 0 && import_node_path19.default.isAbsolute(projectDir) && import_node_fs9.default.statSync(projectDir, { throwIfNoEntry: false })?.isDirectory() === true;
  return usable ? projectDir : repoRootOf(cwd);
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
async function checkBash(ctx, command) {
  const { hook, root, home, settings } = ctx;
  const facts = readCommand(command, hook.cwd, home, ctx.caseInsensitive, toplevelOf, readScriptFile, ctx.cdpath);
  if ("unreadable" in facts && facts.limit) return { refusal: tooComplex(facts.reason) };
  const tooLarge = checkCallSize(facts.parts);
  if (tooLarge !== null) return { refusal: tooLarge };
  const { paths } = ctx;
  const places = placesOf(root, home, paths, ctx.caseInsensitive);
  const trustOf = trustForCall(repoTrust);
  for (const [index, part] of facts.parts.entries()) {
    const refusal3 = checkUnknownGitOption(part) ?? checkPushSetup(part, facts.parts, index) ?? checkRepoTrust(part, trustOf) ?? checkBranchSwitch(part, facts.parts, index, settings, void 0, ctx.caseInsensitive) ?? await checkBranchRefs(part, settings, ctx.git, ctx.caseInsensitive) ?? await checkProtectedBranch(part, settings, ctx.git, branchCreatedBefore(facts.parts, index), ctx.caseInsensitive) ?? await checkHistoryMove(part, settings, ctx.git, branchCreatedBefore(facts.parts, index), void 0, ctx.caseInsensitive) ?? checkForcePush(part, settings) ?? checkTags(part, settings) ?? checkProductionHost(part, settings) ?? checkProtectedPathBash(part, settings, root, home, paths, ctx.caseInsensitive, places, ctx.tree) ?? checkGateAgentBash(part, hook.agent, settings, root, paths, ctx.caseInsensitive) ?? await checkGitClean(part, settings, root, home, paths, ctx.git, ctx.caseInsensitive, places, { earlier: facts.parts, count: index, tree: ctx.tree }) ?? checkProtectedPathMention(part, settings, root, home, paths, ctx.caseInsensitive, places);
    if (refusal3 !== null) return { refusal: refusal3, program: part.program };
  }
  if ("unreadable" in facts) {
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
  const reviewed = checkGateAgentEdit(target, hook.agent, settings, root, ctx.paths, ctx.caseInsensitive);
  if (reviewed !== null) return { refusal: reviewed };
  const call = readEditCall(hook.toolName, hook.toolInput, hook.cwd, home, readRegularFileOrNull);
  if (call === null) return null;
  const refusal3 = checkFocusedTests(call, settings, root, home, ctx.caseInsensitive) ?? checkRedCycle(call, settings, root, home, fileWorkflowState(root), ctx.store);
  return refusal3 === null ? null : { refusal: refusal3 };
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
  const loaded = loadSettings(readRuleFile, req.env.CLAUDE_PLUGIN_ROOT, call.root);
  const ctx = { ...call, settings: loaded.settings };
  const { hook } = ctx;
  const command = hook.toolName === "Bash" ? bashCommand(hook.toolInput) : null;
  let refused = null;
  if (req.mode === "post") {
    if (command !== null) record(ctx, command);
  } else {
    try {
      refused = command !== null ? await checkBash(ctx, command) : checkEdit(ctx);
    } catch (error) {
      if (!(error instanceof OverBudget)) throw error;
      refused = { refusal: tooComplex(error.what) };
    }
  }
  const refusal3 = refused?.refusal ?? null;
  if (refused !== null) {
    logDecision(ctx.store, {
      ts: ctx.ts,
      tool: hook.toolName,
      kind: "refusal",
      rule: refused.refusal.rule,
      ...programField(refused.program),
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
  return allow(hook.hookEventName, loaded.rejected);
}
function failed(req, hook, store) {
  try {
    store?.appendEvent({
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      tool: hook?.toolName ?? "unknown",
      kind: "gate-error",
      result: "allowed"
    });
  } catch {
  }
  return allow(tellEvent(hook, req.mode), TELL);
}
function gateErrorResult(req) {
  let hook = null;
  let store = null;
  try {
    hook = readHook(req.input);
    store = fileStateStore(projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd));
  } catch {
  }
  return failed(req, hook, store);
}
async function runToolGate(req, deps = {}) {
  let hook = null;
  let store = null;
  let timer;
  const timedOut = new Promise((resolve2) => {
    timer = setTimeout(() => resolve2(null), TIMEOUT_MS2);
  });
  try {
    hook = readHook(req.input);
    const root = projectRootOf(req.env.CLAUDE_PROJECT_DIR, hook.cwd);
    store = fileStateStore(root);
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
      cdpath: req.env.CDPATH === "" ? void 0 : req.env.CDPATH
    };
    const now = deps.clock ?? (() => performance.now());
    const result = await Promise.race([withDeadline(DECISION_MS, now, () => decide(req, call)), timedOut]);
    if (result === null) throw new Error("tool-gate timed out");
    return result;
  } catch {
    return failed(req, hook, store);
  } finally {
    clearTimeout(timer);
  }
}

// src/cli/tool-gate.ts
var USAGE = "Usage: tool-gate pre|post < hook.json\n";
var HARD_LIMIT_MS = 2500;
function ownPluginRoot() {
  return typeof __dirname === "string" ? import_node_path20.default.resolve(__dirname, "..", "..", "..") : "";
}
function modeOf(argv) {
  const mode = argv[0];
  return mode === "pre" || mode === "post" ? mode : null;
}
function gateEnv(env) {
  const { HOME = "", CLAUDE_PROJECT_DIR, CDPATH: CDPATH2 } = env;
  return { HOME, CLAUDE_PLUGIN_ROOT: env.CLAUDE_PLUGIN_ROOT || ownPluginRoot(), CLAUDE_PROJECT_DIR, CDPATH: CDPATH2 };
}
async function runCli(argv, input, env) {
  const mode = modeOf(argv);
  if (mode === null) return { exitCode: 1, stdout: "", stderr: USAGE };
  return runToolGate({ mode, input, env: gateEnv(env) });
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
function decideInWorker(script, argv, input, env, limitMs = HARD_LIMIT_MS) {
  const mode = modeOf(argv);
  if (mode === null) return Promise.resolve({ exitCode: 1, stdout: "", stderr: USAGE });
  const request2 = { argv: [...argv], input, env };
  return new Promise((resolve2) => {
    const worker = new import_node_worker_threads.Worker(script, { workerData: { toolGate: request2 } });
    let done = false;
    const running = /* @__PURE__ */ new Set();
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.removeAllListeners("message");
      void worker.terminate();
      for (const pid of running) killGroup(pid);
      resolve2(result ?? gateErrorResult({ mode, input, env: gateEnv(env) }));
    };
    const timer = setTimeout(() => finish(null), limitMs);
    const tracker = { started: (pid) => running.add(pid), ended: (pid) => running.delete(pid) };
    worker.on("message", (message) => {
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
  const script = import_node_path20.default.resolve(process.argv[1]);
  readStdin().then((input) => decideInWorker(script, process.argv.slice(2), input, process.env)).then(answer, () => answer({ exitCode: 1, stdout: "", stderr: "tool-gate: could not read the hook input\n" }));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HARD_LIMIT_MS,
  decideInWorker,
  runCli
});
