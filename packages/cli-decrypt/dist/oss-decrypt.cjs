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

// src/index.ts
var VERSION = "1.1.0";

// src/commands/setup.ts
var import_fs3 = require("fs");
var import_path4 = require("path");
var import_os4 = require("os");

// src/api-client.ts
var import_path2 = require("path");
var import_os = require("os");

// src/cache.ts
var import_crypto = require("crypto");
var import_fs = require("fs");
var import_path = require("path");
var DEFAULT_TTL_MS = 60 * 60 * 1e3;
var ALLOWED_TYPES = ["commands", "workflows", "skills", "agents", "hooks", "custom"];
function validateType(type) {
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`Invalid prompt type: ${type}. Allowed: ${ALLOWED_TYPES.join(", ")}`);
  }
}
function validateName(name) {
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    throw new Error(`Invalid prompt name: contains path traversal characters`);
  }
  if (name.length === 0 || name.length > 100) {
    throw new Error(`Invalid prompt name: must be 1-100 characters`);
  }
}
function getCacheKey(type, name, userId) {
  validateType(type);
  validateName(name);
  const input = `${type}:${name}:${userId}`;
  return (0, import_crypto.createHash)("sha256").update(input).digest("hex");
}
var CacheService = class {
  cacheDir;
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
  }
  /**
   * Get the path to a cache file
   */
  getCachePath(key) {
    return (0, import_path.join)(this.cacheDir, `${key}.json`);
  }
  /**
   * Ensure the cache directory exists with secure permissions (0o700)
   */
  ensureCacheDir() {
    if (!(0, import_fs.existsSync)(this.cacheDir)) {
      (0, import_fs.mkdirSync)(this.cacheDir, { recursive: true, mode: 448 });
    }
  }
  /**
   * Check if a cache entry is expired
   */
  isExpired(entry) {
    const now = Date.now();
    return now - entry.timestamp > entry.ttl;
  }
  /**
   * Store a prompt in the cache
   */
  async set(type, name, userId, content, ttl = DEFAULT_TTL_MS) {
    this.ensureCacheDir();
    const key = getCacheKey(type, name, userId);
    const entry = {
      content,
      timestamp: Date.now(),
      ttl
    };
    const cachePath = this.getCachePath(key);
    (0, import_fs.writeFileSync)(cachePath, JSON.stringify(entry), { encoding: "utf8", mode: 384 });
  }
  /**
   * Retrieve a prompt from the cache
   * Returns null if not found or expired
   */
  async get(type, name, userId) {
    const key = getCacheKey(type, name, userId);
    const cachePath = this.getCachePath(key);
    if (!(0, import_fs.existsSync)(cachePath)) {
      return null;
    }
    try {
      const data = (0, import_fs.readFileSync)(cachePath, "utf8");
      const entry = JSON.parse(data);
      if (this.isExpired(entry)) {
        (0, import_fs.unlinkSync)(cachePath);
        return null;
      }
      return entry.content;
    } catch {
      return null;
    }
  }
  /**
   * Check if a valid cache entry exists
   */
  async has(type, name, userId) {
    const result = await this.get(type, name, userId);
    return result !== null;
  }
  /**
   * Remove a specific cache entry
   */
  async clear(type, name, userId) {
    const key = getCacheKey(type, name, userId);
    const cachePath = this.getCachePath(key);
    if ((0, import_fs.existsSync)(cachePath)) {
      (0, import_fs.unlinkSync)(cachePath);
    }
  }
  /**
   * Remove all cached prompts
   */
  async clearAll() {
    if (!(0, import_fs.existsSync)(this.cacheDir)) {
      return;
    }
    const files = (0, import_fs.readdirSync)(this.cacheDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        (0, import_fs.unlinkSync)((0, import_path.join)(this.cacheDir, file));
      }
    }
  }
  /**
   * Get cache statistics
   */
  async getStats() {
    if (!(0, import_fs.existsSync)(this.cacheDir)) {
      return { entries: 0, totalBytes: 0 };
    }
    const files = (0, import_fs.readdirSync)(this.cacheDir);
    let totalBytes = 0;
    let entries = 0;
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = (0, import_path.join)(this.cacheDir, file);
        try {
          const content = (0, import_fs.readFileSync)(filePath, "utf8");
          totalBytes += Buffer.byteLength(content, "utf8");
          entries++;
        } catch {
        }
      }
    }
    return { entries, totalBytes };
  }
};

// src/api-client.ts
function getCacheDir() {
  const configDir = process.env.OSS_CONFIG_DIR || (0, import_path2.join)((0, import_os.homedir)(), ".oss");
  return (0, import_path2.join)(configDir, "prompt-cache");
}
async function handleCacheClearDirective(response) {
  const clearCache = response.headers.get("X-OSS-Clear-Cache");
  if (clearCache === "true") {
    try {
      const cache = new CacheService(getCacheDir());
      await cache.clearAll();
      console.error("[SECURITY] Local prompt cache cleared by server directive.");
    } catch {
    }
  }
}
async function fetchCredentials(apiKey, apiUrl, hardwareId) {
  const url = `${apiUrl}/api/v1/auth/credentials?hardwareId=${encodeURIComponent(hardwareId)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    await handleCacheClearDirective(response);
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}
async function fetchEncryptedPrompt(apiKey, apiUrl, type, name) {
  let endpoint;
  if (type === "workflows") {
    endpoint = `${apiUrl}/api/v1/prompts/workflows/${name}`;
  } else if (type === "commands") {
    endpoint = `${apiUrl}/api/v1/prompts/${name}`;
  } else {
    endpoint = `${apiUrl}/api/v1/prompts/${type}/${name}`;
  }
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    await handleCacheClearDirective(response);
    if (response.status === 404) {
      throw new Error("Prompt not found");
    }
    if (response.status === 401) {
      throw new Error("Unauthorized");
    }
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}
async function fetchCustomPrompt(apiKey, apiUrl, name) {
  const endpoint = `${apiUrl}/api/v1/prompts/custom/${name}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    await handleCacheClearDirective(response);
    if (response.status === 404) {
      throw new Error("Prompt not found");
    }
    if (response.status === 401) {
      throw new Error("Unauthorized");
    }
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}

// src/storage.ts
var import_fs2 = require("fs");
var import_path3 = require("path");
var import_os2 = require("os");
var import_crypto2 = __toESM(require("crypto"), 1);
function getConfigDir() {
  return process.env.OSS_CONFIG_DIR || (0, import_path3.join)((0, import_os2.homedir)(), ".oss");
}
function getCredentialsPath() {
  return (0, import_path3.join)(getConfigDir(), "credentials.enc");
}
function getMachineKey() {
  const machineId = [
    process.env.USER || "user",
    (0, import_os2.homedir)(),
    process.platform,
    process.arch
  ].join(":");
  return import_crypto2.default.createHash("sha256").update(machineId).digest();
}
function encryptCredentials(credentials) {
  const key = getMachineKey();
  const iv = import_crypto2.default.randomBytes(16);
  const cipher = import_crypto2.default.createCipheriv("aes-256-gcm", key, iv);
  const data = JSON.stringify(credentials);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted
  ].join(":");
}
function decryptCredentials(stored) {
  const [ivBase64, authTagBase64, encrypted] = stored.split(":");
  if (!ivBase64 || !authTagBase64 || !encrypted) {
    throw new Error("Invalid credentials format");
  }
  const key = getMachineKey();
  const iv = Buffer.from(ivBase64, "base64");
  const authTag = Buffer.from(authTagBase64, "base64");
  const decipher = import_crypto2.default.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return JSON.parse(decrypted);
}
async function storeCredentials(credentials) {
  const configDir = getConfigDir();
  if (!(0, import_fs2.existsSync)(configDir)) {
    (0, import_fs2.mkdirSync)(configDir, { recursive: true, mode: 448 });
  }
  const encrypted = encryptCredentials(credentials);
  const credentialsPath = getCredentialsPath();
  (0, import_fs2.writeFileSync)(credentialsPath, encrypted, { mode: 384 });
}
async function retrieveCredentials() {
  const credentialsPath = getCredentialsPath();
  if (!(0, import_fs2.existsSync)(credentialsPath)) {
    return null;
  }
  try {
    const stored = (0, import_fs2.readFileSync)(credentialsPath, "utf8");
    return decryptCredentials(stored);
  } catch {
    return null;
  }
}

// src/hardware.ts
var import_os3 = require("os");
var import_crypto3 = __toESM(require("crypto"), 1);
function getMacAddress() {
  const interfaces = (0, import_os3.networkInterfaces)();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;
    for (const info of iface) {
      if (!info.internal && info.mac && info.mac !== "00:00:00:00:00:00") {
        return info.mac;
      }
    }
  }
  return "";
}
function getHardwareId() {
  const components = [
    getMacAddress(),
    (0, import_os3.hostname)(),
    (0, import_os3.homedir)(),
    process.platform,
    process.arch
  ].join(":");
  const hash = import_crypto3.default.createHash("sha256").update(components).digest("hex");
  return hash.substring(0, 32);
}

// src/commands/setup.ts
var DEFAULT_API_URL = "https://one-shot-ship-api.onrender.com";
function getConfigDir2() {
  return process.env.OSS_CONFIG_DIR || (0, import_path4.join)((0, import_os4.homedir)(), ".oss");
}
function getCacheDir2() {
  return (0, import_path4.join)(getConfigDir2(), "prompt-cache");
}
function readConfig() {
  const configPath = (0, import_path4.join)(getConfigDir2(), "config.json");
  if (!(0, import_fs3.existsSync)(configPath)) {
    return {};
  }
  try {
    const content = (0, import_fs3.readFileSync)(configPath, "utf8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
async function setupCommand() {
  const config = readConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("No API key configured. Run /oss:login first.");
  }
  const apiUrl = config.apiUrl || DEFAULT_API_URL;
  const hardwareId = getHardwareId();
  const cache = new CacheService(getCacheDir2());
  await cache.clearAll();
  const response = await fetchCredentials(apiKey, apiUrl, hardwareId);
  await storeCredentials({
    apiKey,
    userId: response.userId,
    hardwareId: response.hardwareId,
    salt: response.salt
  });
  console.log("Setup complete. Credentials stored securely.");
  console.log("Note: Any previously cached prompts have been cleared for security.");
}

// src/commands/decrypt.ts
var import_fs4 = require("fs");
var import_path5 = require("path");
var import_os5 = require("os");

// src/encryption.ts
var import_crypto4 = __toESM(require("crypto"), 1);
var PBKDF2_ITERATIONS = 1e5;
var KEY_LENGTH = 32;
function deriveKey(apiKey, licenseId, hardwareId, salt) {
  const combined = `${apiKey}:${licenseId}:${hardwareId}`;
  return import_crypto4.default.pbkdf2Sync(
    combined,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    "sha256"
  );
}
function userIdToLicenseId(userId) {
  return `lic_${import_crypto4.default.createHash("sha256").update(userId).digest("hex").substring(0, 24)}`;
}
function decrypt(encrypted, iv, authTag, key) {
  const decipher = import_crypto4.default.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// src/debug.ts
function formatTimestamp() {
  const now = /* @__PURE__ */ new Date();
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
function formatDebugOutput(step, message) {
  return `[${formatTimestamp()}] [${step}] ${message}`;
}
function redactSensitiveData(obj) {
  const sensitiveKeys = ["apiKey", "salt", "password", "secret", "token"];
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (sensitiveKeys.includes(key)) {
      if (key === "apiKey" && typeof value === "string") {
        result[key] = "ak_***";
      } else {
        result[key] = "***";
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactSensitiveData(
        value
      );
    }
  }
  return result;
}
var DebugLogger = class {
  enabled;
  constructor(enabled) {
    this.enabled = enabled;
  }
  log(step, message) {
    if (!this.enabled) {
      return;
    }
    console.error(formatDebugOutput(step, message));
  }
  logObject(step, label, obj) {
    if (!this.enabled) {
      return;
    }
    const redacted = redactSensitiveData(obj);
    console.error(formatDebugOutput(step, `${label}: ${JSON.stringify(redacted)}`));
  }
};

// src/manifest-verifier.ts
var import_crypto5 = __toESM(require("crypto"), 1);
function verifyManifestSignature(manifest, publicKey) {
  try {
    const sortedKeys = Object.keys(manifest.prompts).sort();
    const sortedPrompts = {};
    for (const key of sortedKeys) {
      sortedPrompts[key] = manifest.prompts[key];
    }
    const data = JSON.stringify({
      version: manifest.version,
      algorithm: manifest.algorithm,
      signing: manifest.signing,
      prompts: sortedPrompts
    });
    const keyObj = import_crypto5.default.createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki"
    });
    return import_crypto5.default.verify(
      null,
      Buffer.from(data, "utf8"),
      keyObj,
      Buffer.from(manifest.signature, "base64")
    );
  } catch {
    return false;
  }
}
async function fetchManifest(apiUrl, signal) {
  try {
    const response = await fetch(`${apiUrl}/api/v1/prompts/manifest`, {
      method: "GET",
      signal
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

// src/watermark.ts
var HOMOGLYPH_MAP = {
  "\u03BF": "o",
  // Greek small letter omicron → ASCII 'o'
  "\u0455": "s",
  // Cyrillic small letter dze → ASCII 's'
  "\u0435": "e"
  // Cyrillic small letter ie → ASCII 'e'
};
function stripWatermark(content) {
  let result = content;
  for (const [homoglyph, ascii] of Object.entries(HOMOGLYPH_MAP)) {
    result = result.replaceAll(homoglyph, ascii);
  }
  return result;
}

// src/prompt-integrity.ts
var import_crypto6 = __toESM(require("crypto"), 1);
function hashContent(content) {
  return import_crypto6.default.createHash("sha256").update(content).digest("hex");
}
function verifyPromptHash(strippedContent, type, name, manifest) {
  const key = `${type}/${name}`;
  const entry = manifest.prompts[key];
  if (!entry) {
    return { valid: true, status: "not_in_manifest" };
  }
  const hash = hashContent(strippedContent);
  if (hash === entry.hash) {
    return { valid: true, status: "match" };
  }
  return { valid: false, status: "mismatch" };
}

// src/integrity-pipeline.ts
async function verifyDecryptedPrompt(watermarkedContent, type, name, manifest) {
  if (!manifest) {
    return { verified: true, skipped: true };
  }
  const stripped = stripWatermark(watermarkedContent);
  const result = verifyPromptHash(stripped, type, name, manifest);
  if (result.status === "not_in_manifest") {
    return { verified: true, skipped: true };
  }
  return { verified: result.valid, skipped: false };
}

// src/commands/decrypt.ts
var DEFAULT_API_URL2 = "https://one-shot-ship-api.onrender.com";
var MANIFEST_PUBLIC_KEY = "MCowBQYDK2VwAyEAAwFG32b8TuiVTxrDnXzNrb2v68YN5U9epLnZ3O7pQaI=";
function getConfigDir3() {
  return process.env.OSS_CONFIG_DIR || (0, import_path5.join)((0, import_os5.homedir)(), ".oss");
}
function getCacheDir3() {
  return (0, import_path5.join)(getConfigDir3(), "prompt-cache");
}
function getApiUrl() {
  const configPath = (0, import_path5.join)(getConfigDir3(), "config.json");
  if ((0, import_fs4.existsSync)(configPath)) {
    try {
      const content = (0, import_fs4.readFileSync)(configPath, "utf8");
      const config = JSON.parse(content);
      return config.apiUrl || DEFAULT_API_URL2;
    } catch {
    }
  }
  return DEFAULT_API_URL2;
}
async function decryptCommand(type, name, debug = false, options = {}) {
  const logger = new DebugLogger(debug);
  if (options.clearCache) {
    logger.log("CACHE", "Clearing all cached prompts");
    const cache = new CacheService(getCacheDir3());
    await cache.clearAll();
    console.log("Cache cleared. All locally cached prompts have been removed.");
    console.log("Note: Disk caching is now disabled by default for security.");
    return;
  }
  logger.log("FETCH", "Loading credentials from storage");
  const credentials = await retrieveCredentials();
  if (!credentials) {
    throw new Error("Credentials not found. Run setup first.");
  }
  logger.log("SECURITY", "Disk caching disabled - fetching fresh from API");
  const apiUrl = getApiUrl();
  logger.log("FETCH", `API URL: ${apiUrl}`);
  if (type === "custom") {
    logger.log("FETCH", `Fetching custom command: ${name}`);
    const startFetch2 = Date.now();
    const customPrompt = await fetchCustomPrompt(credentials.apiKey, apiUrl, name);
    logger.log("FETCH", `Custom command fetched in ${Date.now() - startFetch2}ms`);
    console.log(customPrompt.prompt);
    return;
  }
  logger.log("FETCH", `Fetching prompt: ${type}/${name}`);
  const startFetch = Date.now();
  const encryptedPrompt = await fetchEncryptedPrompt(
    credentials.apiKey,
    apiUrl,
    type,
    name
  );
  logger.log("FETCH", `Fetch completed in ${Date.now() - startFetch}ms`);
  const licenseId = userIdToLicenseId(credentials.userId);
  logger.log("DERIVE", "Deriving decryption key");
  const startDerive = Date.now();
  const key = deriveKey(
    credentials.apiKey,
    licenseId,
    credentials.hardwareId,
    credentials.salt
  );
  logger.log("DERIVE", `Key derivation completed in ${Date.now() - startDerive}ms`);
  logger.log("DECRYPT", "Decrypting prompt content");
  const startDecrypt = Date.now();
  const plaintext = decrypt(
    encryptedPrompt.encrypted,
    encryptedPrompt.iv,
    encryptedPrompt.authTag,
    key
  );
  logger.log("DECRYPT", `Decryption completed in ${Date.now() - startDecrypt}ms`);
  console.error("[verify] Checking prompt integrity...");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3e3);
  let manifest = null;
  try {
    manifest = await fetchManifest(apiUrl, controller.signal);
  } catch {
  } finally {
    clearTimeout(timeout);
  }
  if (manifest) {
    if (!verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY)) {
      console.error("[verify] Manifest signature: FAILED \u2014 prompt blocked");
      throw new Error("[SECURITY] Manifest signature verification FAILED. Prompt delivery blocked.");
    }
    console.error("[verify] Manifest signature: valid");
    const integrity = await verifyDecryptedPrompt(plaintext, type, name, manifest);
    if (!integrity.verified && !integrity.skipped) {
      console.error("[verify] Prompt hash: FAILED \u2014 prompt blocked");
      throw new Error("[SECURITY] Prompt integrity check FAILED. Content may have been tampered with.");
    }
    if (!integrity.skipped) {
      console.error("[verify] Prompt hash: verified");
    }
  } else {
    console.error("[verify] Manifest unavailable \u2014 skipping verification");
  }
  console.log(plaintext);
}

// src/cli-entry.ts
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--version":
      case "-v":
        result.version = true;
        break;
      case "--setup":
        result.setup = true;
        break;
      case "--debug":
      case "-d":
        result.debug = true;
        break;
      case "--no-cache":
        result.noCache = true;
        break;
      case "--clear-cache":
        result.clearCache = true;
        break;
      case "--type":
      case "-t":
        result.type = args[++i];
        break;
      case "--name":
      case "-n":
        result.name = args[++i];
        break;
    }
  }
  return result;
}
function showHelp() {
  console.log(`
OSS Decrypt CLI v${VERSION}

Usage:
  oss-decrypt --setup              Fetch and store credentials
  oss-decrypt --type <type> --name <name>  Decrypt a prompt

Options:
  --setup              Run initial setup (fetch credentials)
  --type, -t <type>    Prompt type: commands, workflows, skills, agents, hooks, custom
  --name, -n <name>    Prompt name
  --debug, -d          Enable verbose debug output
  --no-cache           Bypass cache, always fetch from API
  --clear-cache        Clear all cached prompts
  --help, -h           Show this help
  --version, -v        Show version

Examples:
  oss-decrypt --setup
  oss-decrypt --type commands --name plan
  oss-decrypt --type workflows --name build
  oss-decrypt --debug --type commands --name plan
  oss-decrypt --no-cache --type commands --name plan
  oss-decrypt --clear-cache
`);
}
function showVersion() {
  console.log(`oss-decrypt v${VERSION}`);
}
async function runCli(args) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    showHelp();
    return;
  }
  if (parsed.version) {
    showVersion();
    return;
  }
  if (parsed.setup) {
    await setupCommand();
    return;
  }
  if (parsed.clearCache) {
    await decryptCommand("commands", "any", parsed.debug ?? false, { clearCache: true });
    return;
  }
  if (parsed.type && parsed.name) {
    await decryptCommand(parsed.type, parsed.name, parsed.debug ?? false, {
      noCache: parsed.noCache
    });
    return;
  }
  showHelp();
  process.exitCode = 1;
}

// src/cli.ts
runCli(process.argv.slice(2)).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
