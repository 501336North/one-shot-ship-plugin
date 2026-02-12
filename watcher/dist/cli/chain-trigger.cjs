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
  MAX_CHAIN_COMMANDS: () => MAX_CHAIN_COMMANDS,
  executeChainForWorkflow: () => executeChainForWorkflow,
  readApiCredentials: () => readApiCredentials
});
module.exports = __toCommonJS(chain_trigger_exports);
var fs2 = __toESM(require("fs"), 1);
var path2 = __toESM(require("path"), 1);
var os2 = __toESM(require("os"), 1);

// src/api/workflow-config.ts
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
var os = __toESM(require("os"), 1);
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
    agents: [
      { agent: "code-simplifier", always: true },
      { agent: "frontend-design", condition: "has_ui_work" }
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

// src/api/workflow-config.ts
var DEFAULT_API_URL = "https://one-shot-ship-api.onrender.com";
var PBKDF2_ITERATIONS = 1e5;
var KEY_LENGTH = 32;
var configCache = /* @__PURE__ */ new Map();
function getConfigDir() {
  return process.env.OSS_CONFIG_DIR || path.join(os.homedir(), ".oss");
}
function readConfig() {
  const configPath = path.join(getConfigDir(), "config.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
function getMachineKey() {
  const machineId = [
    process.env.USER || "user",
    os.homedir(),
    process.platform,
    process.arch
  ].join(":");
  return crypto.createHash("sha256").update(machineId).digest();
}
function retrieveCredentials() {
  const credentialsPath = path.join(getConfigDir(), "credentials.enc");
  if (!fs.existsSync(credentialsPath)) {
    return null;
  }
  try {
    const stored = fs.readFileSync(credentialsPath, "utf8");
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
async function fetchWorkflowConfig(workflowName) {
  const config = readConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("No API key configured");
  }
  const apiUrl = config.apiUrl || DEFAULT_API_URL;
  const endpoint = `${apiUrl}/api/v1/workflows/${workflowName}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });
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
async function getCachedOrFetch(workflowName) {
  const cached = configCache.get(workflowName);
  if (cached) {
    return cached;
  }
  const config = readConfig();
  if (!config.apiKey) {
    const defaultConfig = DEFAULT_WORKFLOW_CONFIGS[workflowName] || {};
    configCache.set(workflowName, defaultConfig);
    return defaultConfig;
  }
  try {
    const encrypted = await fetchWorkflowConfig(workflowName);
    const credentials = retrieveCredentials();
    if (!credentials) {
      const defaultConfig = DEFAULT_WORKFLOW_CONFIGS[workflowName] || {};
      configCache.set(workflowName, defaultConfig);
      return defaultConfig;
    }
    const decrypted = decryptWorkflowConfig(encrypted, credentials);
    const merged = {
      ...DEFAULT_WORKFLOW_CONFIGS[workflowName],
      ...decrypted
    };
    configCache.set(workflowName, merged);
    return merged;
  } catch {
    const defaultConfig = DEFAULT_WORKFLOW_CONFIGS[workflowName] || {};
    configCache.set(workflowName, defaultConfig);
    return defaultConfig;
  }
}

// src/cli/chain-trigger.ts
var DEFAULT_API_URL2 = "https://one-shot-ship-api.onrender.com";
var MAX_CHAIN_COMMANDS = 10;
function readApiCredentials(configDir) {
  const dir = configDir || path2.join(os2.homedir(), ".oss");
  const configPath = path2.join(dir, "config.json");
  if (!fs2.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs2.readFileSync(configPath, "utf8");
    const config = JSON.parse(content);
    if (!config.apiKey) {
      return null;
    }
    const apiUrl = config.apiUrl || DEFAULT_API_URL2;
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
async function executeChainForWorkflow(workflowName, _credentials) {
  try {
    const config = await getCachedOrFetch(workflowName);
    if (!config.chains_to || config.chains_to.length === 0) {
      return { executed: 0, skipped: 0, errors: [] };
    }
    let executed = 0;
    const lines = [];
    for (const step of config.chains_to) {
      if (executed >= MAX_CHAIN_COMMANDS) {
        break;
      }
      const condition = step.always ? "always" : step.condition ? `condition: ${step.condition}` : "always";
      if (step.command.startsWith("team:")) {
        const cmdName = step.command.substring(5);
        lines.push(`CHAIN: /oss:oss-custom ${cmdName} (${condition})`);
      } else {
        lines.push(`CHAIN: /oss:${step.command} (${condition})`);
      }
      executed++;
    }
    if (lines.length > 0) {
      console.log("---CHAIN_COMMANDS---");
      for (const line of lines) {
        console.log(line);
      }
      console.log("---END_CHAIN_COMMANDS---");
    }
    return { executed, skipped: 0, errors: [] };
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
  MAX_CHAIN_COMMANDS,
  executeChainForWorkflow,
  readApiCredentials
});
