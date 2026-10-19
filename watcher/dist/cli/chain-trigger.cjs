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

// src/cli/chain-trigger.ts
var chain_trigger_exports = {};
__export(chain_trigger_exports, {
  CHAIN_LINE_PATTERN: () => CHAIN_LINE_PATTERN,
  MAX_CHAIN_COMMANDS: () => MAX_CHAIN_COMMANDS,
  executeChainForWorkflow: () => executeChainForWorkflow,
  readApiCredentials: () => readApiCredentials
});
module.exports = __toCommonJS(chain_trigger_exports);

// src/api/workflow-config.ts
var fs2 = __toESM(require("fs"), 1);
var path2 = __toESM(require("path"), 1);
var os2 = __toESM(require("os"), 1);
var crypto = __toESM(require("crypto"), 1);

// src/engine/types.ts
var DEFAULT_WORKFLOW_CONFIGS = {
  ideate: {
    chains_to: [
      { command: "requirements", always: true },
      { command: "api-design", condition: "has_api_work" },
      { command: "data-model", condition: "has_db_work" },
      { command: "adr", always: true }
    ],
    checkpoint: "human"
  },
  plan: {
    chains_to: [
      { command: "acceptance", always: true }
    ],
    checkpoint: "human"
  },
  build: {
    task_loop: ["red", "green", "refactor"],
    chains_to: [
      { command: "context-report", always: true }
    ],
    agents: [
      { agent: "code-simplifier", always: true },
      { agent: "ui-review", condition: "has_ui_work" }
    ],
    checkpoint: "auto"
  },
  ship: {
    quality_gates: {
      parallel: true,
      agents: ["code-reviewer", "performance-engineer", "security-auditor"],
      all_must_pass: true
    },
    checkpoint: "human"
  }
};

// src/api/api-credentials.ts
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var os = __toESM(require("os"), 1);
var DEFAULT_API_URL = "https://one-shot-ship-api.onrender.com";
function getConfigDir() {
  return process.env.OSS_CONFIG_DIR || path.join(os.homedir(), ".oss");
}
function readApiCredentials(configDir) {
  const configPath = path.join(configDir || getConfigDir(), "config.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(content);
    if (!config.apiKey) {
      return null;
    }
    const apiUrl = config.apiUrl || DEFAULT_API_URL;
    try {
      const parsed = new URL(apiUrl);
      if (parsed.protocol !== "https:") {
        return null;
      }
    } catch {
      return null;
    }
    return {
      apiKey: config.apiKey,
      apiUrl
    };
  } catch {
    return null;
  }
}

// src/utils/workflow-name.ts
var WORKFLOW_NAME_PATTERN = /^[a-z][a-z0-9-]{0,40}$/;
function isValidWorkflowName(name) {
  return WORKFLOW_NAME_PATTERN.test(name);
}
function assertValidWorkflowName(name) {
  if (!isValidWorkflowName(name)) {
    throw new Error("Invalid workflow name");
  }
}

// src/api/workflow-config.ts
var PBKDF2_ITERATIONS = 1e5;
var KEY_LENGTH = 32;
var WORKFLOW_FETCH_TIMEOUT_MS = 8e3;
var configCache = /* @__PURE__ */ new Map();
function getMachineKey() {
  const machineId = [
    process.env.USER || "user",
    os2.homedir(),
    process.platform,
    process.arch
  ].join(":");
  return crypto.createHash("sha256").update(machineId).digest();
}
function retrieveCredentials() {
  const credentialsPath = path2.join(getConfigDir(), "credentials.enc");
  if (!fs2.existsSync(credentialsPath)) {
    return null;
  }
  try {
    const stored = fs2.readFileSync(credentialsPath, "utf8");
    const [ivBase64, authTagBase64, encrypted] = stored.split(":");
    if (!ivBase64 || !authTagBase64 || !encrypted) {
      return null;
    }
    const key = getMachineKey();
    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}
function deriveKey(apiKey, licenseId, hardwareId, salt) {
  const combined = `${apiKey}:${licenseId}:${hardwareId}`;
  return crypto.pbkdf2Sync(combined, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}
function userIdToLicenseId(userId) {
  return `lic_${crypto.createHash("sha256").update(userId).digest("hex").substring(0, 24)}`;
}
async function fetchWorkflowConfig(workflowName, timeoutMs = WORKFLOW_FETCH_TIMEOUT_MS) {
  assertValidWorkflowName(workflowName);
  const credentials = readApiCredentials();
  if (!credentials) {
    throw new Error("No API key configured or apiUrl is not https");
  }
  const endpoint = `${credentials.apiUrl}/api/v1/workflows/${encodeURIComponent(workflowName)}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs),
      // G5: never replay the Bearer key to a redirect target
      redirect: "error"
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      console.error("workflow-config: API timeout, using defaults");
    }
    throw error;
  }
  if (!response.ok) {
    const errorResponse = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errorResponse.error || `HTTP ${response.status}`);
  }
  return response.json();
}
function decryptWorkflowConfig(encrypted, credentials) {
  try {
    const licenseId = userIdToLicenseId(credentials.userId);
    const key = deriveKey(credentials.apiKey, licenseId, credentials.hardwareId, credentials.salt);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encrypted.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    let decrypted = decipher.update(encrypted.encrypted, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}
function defaultConfigFor(workflowName) {
  return Object.hasOwn(DEFAULT_WORKFLOW_CONFIGS, workflowName) ? DEFAULT_WORKFLOW_CONFIGS[workflowName] : {};
}
async function getCachedOrFetch(workflowName) {
  const cached = configCache.get(workflowName);
  if (cached) {
    return cached;
  }
  if (!readApiCredentials()) {
    const defaultConfig = defaultConfigFor(workflowName);
    configCache.set(workflowName, defaultConfig);
    return defaultConfig;
  }
  try {
    const encrypted = await fetchWorkflowConfig(workflowName);
    const credentials = retrieveCredentials();
    if (!credentials) {
      const defaultConfig = defaultConfigFor(workflowName);
      configCache.set(workflowName, defaultConfig);
      return defaultConfig;
    }
    const decrypted = decryptWorkflowConfig(encrypted, credentials);
    const merged = {
      ...defaultConfigFor(workflowName),
      ...decrypted
    };
    configCache.set(workflowName, merged);
    return merged;
  } catch {
    const defaultConfig = defaultConfigFor(workflowName);
    configCache.set(workflowName, defaultConfig);
    return defaultConfig;
  }
}

// src/utils/safe-chain-name.ts
function isSafeTeamCommandName(name) {
  return /^[a-z0-9-]{1,100}$/.test(name);
}

// src/cli/chain-trigger.ts
var MAX_CHAIN_COMMANDS = 10;
var MAX_STEPS_ITERATED = MAX_CHAIN_COMMANDS * 10;
var MAX_SKIP_LOG_LINES = 5;
var SAFE_CONDITION = /^[a-z0-9_-]{1,64}$/;
var CHAIN_LINE_PATTERN = new RegExp(
  `^CHAIN: \\/oss:(${WORKFLOW_NAME_PATTERN.source.slice(1, -1)}|oss-custom [a-z0-9-]{1,100}) \\((always|condition: [a-z0-9_-]{1,64})\\)$`
);
function safeForLog(value) {
  return value.replace(/[^\x20-\x7e]/g, "?").slice(0, 60);
}
function isChainItemShape(value) {
  if (typeof value !== "object" || value === null) return false;
  const { command, condition } = value;
  return typeof command === "string" && (condition === void 0 || typeof condition === "string");
}
async function executeChainForWorkflow(workflowName, _credentials) {
  try {
    const config = await getCachedOrFetch(workflowName);
    const rawSteps = config.chains_to;
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
      return { executed: 0, skipped: 0, errors: [] };
    }
    const steps = rawSteps;
    let executed = 0;
    let skipped = 0;
    const lines = [];
    const skip = (message) => {
      skipped++;
      if (skipped <= MAX_SKIP_LOG_LINES) {
        console.error(message);
      }
    };
    const stepCount = Math.min(steps.length, MAX_STEPS_ITERATED);
    for (let i = 0; i < stepCount; i++) {
      if (executed >= MAX_CHAIN_COMMANDS) {
        break;
      }
      const step = steps[i];
      if (!isChainItemShape(step)) {
        skip("chain-trigger: skipping malformed chains_to step");
        continue;
      }
      if (step.condition === "never") {
        continue;
      }
      const isTeam = step.command.startsWith("team:");
      const cmdName = isTeam ? step.command.substring(5) : step.command;
      const nameIsSafe = isTeam ? isSafeTeamCommandName(cmdName) : isValidWorkflowName(cmdName);
      const conditionIsSafe = step.condition === void 0 || SAFE_CONDITION.test(step.condition);
      if (!nameIsSafe || !conditionIsSafe) {
        skip(`chain-trigger: skipping invalid chains_to step "${safeForLog(step.command)}"`);
        continue;
      }
      const condition = step.always === true ? "always" : step.condition ? `condition: ${step.condition}` : "always";
      if (isTeam) {
        lines.push(`CHAIN: /oss:oss-custom ${cmdName} (${condition})`);
      } else {
        lines.push(`CHAIN: /oss:${cmdName} (${condition})`);
      }
      executed++;
    }
    if (skipped > MAX_SKIP_LOG_LINES) {
      console.error(`chain-trigger: ${skipped - MAX_SKIP_LOG_LINES} more invalid steps skipped`);
    }
    if (steps.length > MAX_STEPS_ITERATED) {
      console.error(
        `chain-trigger: ${steps.length - MAX_STEPS_ITERATED} steps beyond the ${MAX_STEPS_ITERATED}-step read limit ignored`
      );
    }
    if (lines.length > 0) {
      console.log("---CHAIN_COMMANDS---");
      for (const line of lines) {
        console.log(line);
      }
      console.log("---END_CHAIN_COMMANDS---");
    }
    return { executed, skipped, errors: [] };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { executed: 0, skipped: 0, errors: [], error: msg };
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: chain-trigger.js --workflow <cmd>");
    process.exit(1);
  }
  const credentials = readApiCredentials();
  if (!credentials) {
    console.error("No API key configured. Run /oss:login");
    process.exit(1);
  }
  const flagIndex = args.indexOf("--workflow");
  if (flagIndex !== -1 && args[flagIndex + 1]) {
    const workflowName = args[flagIndex + 1];
    const result = await executeChainForWorkflow(workflowName, credentials);
    if (result.error) {
      console.error(`Chain trigger error: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  }
  console.error("Usage: chain-trigger.js --workflow <cmd>");
  process.exit(1);
}
var isDirectExecution = /chain-trigger\.(js|cjs)$/.test(process.argv[1] || "");
if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Chain trigger fatal error: ${error}`);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CHAIN_LINE_PATTERN,
  MAX_CHAIN_COMMANDS,
  executeChainForWorkflow,
  readApiCredentials
});
