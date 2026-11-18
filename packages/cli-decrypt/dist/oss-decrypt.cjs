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
var VERSION = "1.2.5";

// src/commands/setup.ts
var import_fs4 = require("fs");
var import_path5 = require("path");

// src/api-client.ts
var import_path3 = require("path");

// src/config.ts
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var DEFAULT_API_URL = "https://one-shot-ship-api.onrender.com";
var HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;
var LOOPBACK_HTTP_URL = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;
var REFUSAL = "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment.";
function getConfigDir() {
  return process.env.OSS_CONFIG_DIR || (0, import_path.join)((0, import_os.homedir)(), ".oss");
}
function readConfiguredApiUrl() {
  const configPath = (0, import_path.join)(getConfigDir(), "config.json");
  if ((0, import_fs.existsSync)(configPath)) {
    try {
      const config = JSON.parse((0, import_fs.readFileSync)(configPath, "utf8"));
      return config.apiUrl;
    } catch {
    }
  }
  return void 0;
}
function parses(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
function getApiUrl() {
  const apiUrl = readConfiguredApiUrl();
  if (apiUrl === void 0 || apiUrl === null || apiUrl === "") return DEFAULT_API_URL;
  if (typeof apiUrl !== "string" || !(HTTPS_URL.test(apiUrl) || LOOPBACK_HTTP_URL.test(apiUrl)) || !parses(apiUrl)) {
    throw new Error(REFUSAL);
  }
  return apiUrl;
}

// src/cache.ts
var import_crypto = require("crypto");
var import_fs2 = require("fs");
var import_path2 = require("path");
var DEFAULT_TTL_MS = 60 * 60 * 1e3;
var ALLOWED_TYPES = ["commands", "workflows", "skills", "agents", "hooks", "custom"];
function validateType(type) {
  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error(`Invalid prompt type: ${type}. Allowed: ${ALLOWED_TYPES.join(", ")}`);
  }
}
function validateName(name) {
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0") || name === ".") {
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
    return (0, import_path2.join)(this.cacheDir, `${key}.json`);
  }
  /**
   * Ensure the cache directory exists with secure permissions (0o700)
   */
  ensureCacheDir() {
    if (!(0, import_fs2.existsSync)(this.cacheDir)) {
      (0, import_fs2.mkdirSync)(this.cacheDir, { recursive: true, mode: 448 });
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
    (0, import_fs2.writeFileSync)(cachePath, JSON.stringify(entry), { encoding: "utf8", mode: 384 });
  }
  /**
   * Retrieve a prompt from the cache
   * Returns null if not found or expired
   */
  async get(type, name, userId) {
    const key = getCacheKey(type, name, userId);
    const cachePath = this.getCachePath(key);
    if (!(0, import_fs2.existsSync)(cachePath)) {
      return null;
    }
    try {
      const data = (0, import_fs2.readFileSync)(cachePath, "utf8");
      const entry = JSON.parse(data);
      if (this.isExpired(entry)) {
        (0, import_fs2.unlinkSync)(cachePath);
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
    if ((0, import_fs2.existsSync)(cachePath)) {
      (0, import_fs2.unlinkSync)(cachePath);
    }
  }
  /**
   * Remove all cached prompts
   */
  async clearAll() {
    if (!(0, import_fs2.existsSync)(this.cacheDir)) {
      return;
    }
    const files = (0, import_fs2.readdirSync)(this.cacheDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        (0, import_fs2.unlinkSync)((0, import_path2.join)(this.cacheDir, file));
      }
    }
  }
  /**
   * Get cache statistics
   */
  async getStats() {
    if (!(0, import_fs2.existsSync)(this.cacheDir)) {
      return { entries: 0, totalBytes: 0 };
    }
    const files = (0, import_fs2.readdirSync)(this.cacheDir);
    let totalBytes = 0;
    let entries = 0;
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = (0, import_path2.join)(this.cacheDir, file);
        try {
          const content = (0, import_fs2.readFileSync)(filePath, "utf8");
          totalBytes += Buffer.byteLength(content, "utf8");
          entries++;
        } catch {
        }
      }
    }
    return { entries, totalBytes };
  }
};

// src/strip-control.ts
function stripControl(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\p{Cf}\ufe00-\ufe0f\u{e0000}-\u{e0fff}\u034f\u115f\u1160\u3164\uffa0\u2800\u17b4\u17b5\u180b-\u180d\u180f\u2065\ufff0-\ufff8\p{Default_Ignorable_Code_Point}]/gu, "");
}

// src/capped-body.ts
async function readCapped(response, maxBytes) {
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
    await response.body?.cancel().catch(() => void 0);
    return null;
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => void 0);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// src/api-client.ts
function getCacheDir() {
  return (0, import_path3.join)(getConfigDir(), "prompt-cache");
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
async function fetchNoRedirect(url, init) {
  if (Object.values(init.headers).some((value) => /[\r\n\0]/.test(value))) {
    throw new Error("Your stored API key contains invalid characters. Run /oss:login again.");
  }
  try {
    return await fetch(url, { ...init, redirect: "error" });
  } catch (err) {
    const cause = err instanceof Error ? err.cause : void 0;
    if (cause instanceof Error && cause.message === "unexpected redirect") {
      throw new Error(
        "The API answered with a redirect; refusing to send your API key. Check apiUrl in your OSS config."
      );
    }
    throw err;
  }
}
var PROMPT_FETCH_TIMEOUT_MS = 3e4;
var PROMPT_MAX_BYTES = 2 * 1024 * 1024;
async function readJsonCapped(response) {
  if (!response.body) return response.json();
  const text = await readCapped(response, PROMPT_MAX_BYTES);
  if (text === null) {
    throw new Error(`The API answer was larger than ${PROMPT_MAX_BYTES / (1024 * 1024)} MiB; refusing it.`);
  }
  return JSON.parse(text);
}
async function withinTimeout(timeoutMs, call) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await call(signal);
  } catch (err) {
    if (signal.aborted) {
      throw new Error(
        `The API did not answer within ${Math.round(timeoutMs / 1e3)} s; check your connection and run the command again.`
      );
    }
    throw err;
  }
}
async function fetchCredentials(apiKey, apiUrl, hardwareId, timeoutMs = PROMPT_FETCH_TIMEOUT_MS) {
  const url = `${apiUrl}/api/v1/auth/credentials?hardwareId=${encodeURIComponent(hardwareId)}`;
  return withinTimeout(timeoutMs, async (signal) => {
    const response = await fetchNoRedirect(url, {
      method: "GET",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });
    if (!response.ok) {
      await handleCacheClearDirective(response);
      const error = await readJsonCapped(response).catch(() => ({ error: "Request failed" }));
      throw new Error(stripControl(error.error || "Request failed"));
    }
    return await readJsonCapped(response);
  });
}
async function fetchEncryptedPrompt(apiKey, apiUrl, type, name, timeoutMs = PROMPT_FETCH_TIMEOUT_MS) {
  return withinTimeout(timeoutMs, (signal) => fetchEncryptedPromptWithin(apiKey, apiUrl, type, name, signal));
}
async function fetchEncryptedPromptWithin(apiKey, apiUrl, type, name, signal) {
  validateType(type);
  validateName(name);
  const encodedName = encodeURIComponent(name);
  let endpoint;
  if (type === "workflows") {
    endpoint = `${apiUrl}/api/v1/prompts/workflows/${encodedName}`;
  } else if (type === "commands") {
    endpoint = `${apiUrl}/api/v1/prompts/${encodedName}`;
  } else {
    endpoint = `${apiUrl}/api/v1/prompts/${type}/${encodedName}`;
  }
  const response = await fetchNoRedirect(endpoint, {
    method: "GET",
    signal,
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
    const error = await readJsonCapped(response).catch(() => ({ error: "Request failed" }));
    throw new Error(stripControl(error.error || "Request failed"));
  }
  return await readJsonCapped(response);
}
async function fetchCustomPrompt(apiKey, apiUrl, name, timeoutMs = PROMPT_FETCH_TIMEOUT_MS) {
  validateName(name);
  const endpoint = `${apiUrl}/api/v1/prompts/custom/${encodeURIComponent(name)}`;
  return withinTimeout(timeoutMs, async (signal) => {
    const response = await fetchNoRedirect(endpoint, {
      method: "GET",
      signal,
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
      const error = await readJsonCapped(response).catch(() => ({ error: "Request failed" }));
      throw new Error(stripControl(error.error || "Request failed"));
    }
    return await readJsonCapped(response);
  });
}

// src/storage.ts
var import_fs3 = require("fs");
var import_path4 = require("path");
var import_os2 = require("os");
var import_crypto2 = __toESM(require("crypto"), 1);
function getCredentialsPath() {
  return (0, import_path4.join)(getConfigDir(), "credentials.enc");
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
  if (!(0, import_fs3.existsSync)(configDir)) {
    (0, import_fs3.mkdirSync)(configDir, { recursive: true, mode: 448 });
  }
  const encrypted = encryptCredentials(credentials);
  const credentialsPath = getCredentialsPath();
  (0, import_fs3.writeFileSync)(credentialsPath, encrypted, { mode: 384 });
}
async function retrieveCredentials() {
  const credentialsPath = getCredentialsPath();
  if (!(0, import_fs3.existsSync)(credentialsPath)) {
    return null;
  }
  try {
    const stored = (0, import_fs3.readFileSync)(credentialsPath, "utf8");
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
function getCacheDir2() {
  return (0, import_path5.join)(getConfigDir(), "prompt-cache");
}
function readConfig() {
  const configPath = (0, import_path5.join)(getConfigDir(), "config.json");
  if (!(0, import_fs4.existsSync)(configPath)) {
    return {};
  }
  try {
    const content = (0, import_fs4.readFileSync)(configPath, "utf8");
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
  const apiUrl = getApiUrl();
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

// src/cli-entry.ts
var import_crypto8 = require("crypto");

// src/commands/decrypt.ts
var import_path8 = require("path");

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
    console.error(formatDebugOutput(step, stripControl(message)));
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
    if (Object.hasOwn(manifest.prompts, "__proto__")) {
      return false;
    }
    const sortedKeys = Object.keys(manifest.prompts).sort();
    const sortedPrompts = /* @__PURE__ */ Object.create(null);
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
var MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
async function fetchManifest(apiUrl, signal) {
  try {
    const response = await fetch(`${apiUrl}/api/v1/prompts/manifest`, {
      method: "GET",
      redirect: "error",
      signal
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => void 0);
      return null;
    }
    const text = await readCapped(response, MANIFEST_MAX_BYTES);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

// src/prompt-integrity.ts
var import_crypto6 = __toESM(require("crypto"), 1);
function hashContent(content) {
  return import_crypto6.default.createHash("sha256").update(content).digest("hex");
}

// src/integrity-pipeline.ts
async function verifyDecryptedPrompt(plaintext, type, name, manifest) {
  if (!manifest) {
    return { verified: false, skipped: false };
  }
  const key = `${type}/${name}`;
  if (!Object.hasOwn(manifest.prompts, key)) {
    return { verified: false, skipped: false, reason: "not_in_manifest" };
  }
  const servedHash = manifest.prompts[key].servedHash;
  if (!servedHash) {
    return { verified: false, skipped: false };
  }
  return { verified: hashContent(plaintext) === servedHash, skipped: false };
}

// src/manifest-floor.ts
var import_fs5 = require("fs");
var import_path6 = require("path");
var import_crypto7 = require("crypto");
var MIN_MANIFEST_VERSION = 1794940034;
var NOT_RECORDED = "[verify] Could not record the manifest version floor; this run is not affected";
var REPAIRED = "[verify] Your config folder was writable by other users; it is now owner-only (0700) so the manifest floor can be kept there";
var UNTRUSTED = "[verify] The manifest floor folder or your config folder is not a private folder of yours \u2014 using the built-in floor, not updating it";
var VERSION_NAME = /^[0-9]{1,15}$/;
function floorKey(apiUrl) {
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return apiUrl;
  }
}
function floorDirs(apiUrl) {
  const config = (0, import_path6.resolve)(getConfigDir());
  const store = (0, import_path6.join)(config, "manifest-floor.d");
  return [config, store, (0, import_path6.join)(store, (0, import_crypto7.createHash)("sha256").update(floorKey(apiUrl)).digest("hex"))];
}
function errCode(err) {
  return err?.code;
}
function isPrivate(stats) {
  const uid = process.getuid?.();
  return (uid === void 0 || stats.uid === uid) && (stats.mode & 18) === 0;
}
var DIR_FLAGS = import_fs5.constants.O_RDONLY | import_fs5.constants.O_NOFOLLOW | import_fs5.constants.O_DIRECTORY | (import_fs5.constants.O_NONBLOCK ?? 0);
function openPrivateDirs(dirs, write) {
  const seen = [];
  for (const [i, dir] of dirs.entries()) {
    if (write) {
      try {
        (0, import_fs5.mkdirSync)(dir, { recursive: i === 0, mode: 448 });
      } catch (err) {
        if (errCode(err) !== "EEXIST") throw err;
      }
    }
    const fd = (0, import_fs5.openSync)(dir, DIR_FLAGS);
    let keep = false;
    try {
      const stats = (0, import_fs5.fstatSync)(fd);
      if (!write && i === 0 && stats.isDirectory() && stats.uid === process.getuid?.() && (stats.mode & 18) !== 0) {
        (0, import_fs5.fchmodSync)(fd, 448);
        console.error(REPAIRED);
        return null;
      }
      if (!stats.isDirectory() || !isPrivate(stats)) return null;
      seen.push(stats);
      keep = i === dirs.length - 1;
      if (keep) return { seen, fd };
    } finally {
      if (!keep) (0, import_fs5.closeSync)(fd);
    }
  }
  return null;
}
function sameDirs(dirs, seen) {
  return dirs.every((dir, i) => {
    const now = (0, import_fs5.lstatSync)(dir);
    return now.dev === seen[i].dev && now.ino === seen[i].ino;
  });
}
function readRecorded(apiUrl) {
  const dirs = floorDirs(apiUrl);
  let checked = false;
  try {
    const opened = openPrivateDirs(dirs, false);
    if (opened === null) return null;
    checked = true;
    (0, import_fs5.closeSync)(opened.fd);
    const names = (0, import_fs5.readdirSync)(dirs[2]);
    if (!sameDirs(dirs, opened.seen)) return null;
    let max = 0;
    for (const name of names) if (VERSION_NAME.test(name)) max = Math.max(max, Number(name));
    return max;
  } catch (err) {
    return !checked && errCode(err) === "ENOENT" ? 0 : null;
  }
}
function recordVersion(apiUrl, v) {
  try {
    const dirs = floorDirs(apiUrl);
    const opened = openPrivateDirs(dirs, true);
    if (opened === null) {
      console.error(UNTRUSTED);
      return;
    }
    try {
      if (!sameDirs(dirs, opened.seen)) {
        console.error(UNTRUSTED);
        return;
      }
      try {
        (0, import_fs5.closeSync)((0, import_fs5.openSync)((0, import_path6.join)(dirs[2], String(v)), import_fs5.constants.O_WRONLY | import_fs5.constants.O_CREAT | import_fs5.constants.O_EXCL | import_fs5.constants.O_NOFOLLOW, 384));
      } catch (err) {
        if (errCode(err) !== "EEXIST") throw err;
      }
      try {
        (0, import_fs5.fsyncSync)(opened.fd);
      } catch {
      }
      if (!sameDirs(dirs, opened.seen)) console.error(UNTRUSTED);
    } finally {
      (0, import_fs5.closeSync)(opened.fd);
    }
  } catch {
    console.error(NOT_RECORDED);
  }
}
function checkAndRecordManifestVersion(apiUrl, version) {
  if (typeof version !== "number" || !VERSION_NAME.test(String(version))) return "invalid";
  const v = version;
  const recorded = readRecorded(apiUrl);
  if (recorded === null) console.error(UNTRUSTED);
  const floor = Math.max(MIN_MANIFEST_VERSION, recorded ?? 0);
  if (v < floor) return "older";
  if (v > floor && recorded !== null) recordVersion(apiUrl, v);
  return "accepted";
}

// src/update-state.ts
var import_fs6 = require("fs");
var import_path7 = require("path");
function defaultState() {
  return {
    lastPluginVersion: "",
    lastCheckedAt: "",
    manifestVersion: 0,
    manifestHashes: {},
    promptSignatures: {}
  };
}
function readUpdateState(filePath) {
  if (!(0, import_fs6.existsSync)(filePath)) {
    return defaultState();
  }
  try {
    const content = (0, import_fs6.readFileSync)(filePath, "utf8");
    const parsed = JSON.parse(content);
    return {
      lastPluginVersion: parsed.lastPluginVersion ?? "",
      lastCheckedAt: parsed.lastCheckedAt ?? "",
      manifestVersion: parsed.manifestVersion ?? 0,
      manifestHashes: parsed.manifestHashes ?? {},
      promptSignatures: parsed.promptSignatures ?? {}
    };
  } catch {
    return defaultState();
  }
}
function writeUpdateState(filePath, state) {
  const dir = (0, import_path7.dirname)(filePath);
  if (!(0, import_fs6.existsSync)(dir)) {
    (0, import_fs6.mkdirSync)(dir, { recursive: true });
  }
  (0, import_fs6.writeFileSync)(filePath, JSON.stringify(state, null, 2), { mode: 384 });
}

// src/change-detection.ts
function detectPromptChange(state, type, name, currentHash) {
  const promptKey = `${type}/${name}`;
  if (currentHash === null) {
    return { changed: false, firstRun: false, promptKey, updatedSignatures: {} };
  }
  const cachedHash = state.promptSignatures[promptKey];
  const firstRun = cachedHash === void 0;
  const changed = !firstRun && cachedHash !== currentHash;
  return {
    changed,
    firstRun,
    promptKey,
    updatedSignatures: { [promptKey]: currentHash }
  };
}

// src/commands/decrypt.ts
var MANIFEST_PUBLIC_KEY = "MCowBQYDK2VwAyEAAwFG32b8TuiVTxrDnXzNrb2v68YN5U9epLnZ3O7pQaI=";
function getCacheDir3() {
  return (0, import_path8.join)(getConfigDir(), "prompt-cache");
}
var MANIFEST_UNREACHABLE = "[SECURITY] Could not verify prompt: manifest unreachable \u2014 check your connection and run the command again";
async function fetchManifestOnce(apiUrl, ms, cancel) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  cancel?.addEventListener("abort", abort, { once: true });
  try {
    return await fetchManifest(apiUrl, controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener("abort", abort);
  }
}
function pause(ms, cancel) {
  if (ms <= 0 || cancel?.aborted) return Promise.resolve();
  return new Promise((done) => {
    const finish = () => {
      clearTimeout(timer);
      cancel?.removeEventListener("abort", finish);
      done();
    };
    const timer = setTimeout(finish, ms);
    cancel?.addEventListener("abort", finish, { once: true });
  });
}
var FIRST_ATTEMPT_MS = 3e3;
var RETRY_MS = 1e4;
async function fetchManifestQuietly(apiUrl, cancel) {
  const started = Date.now();
  const first = await fetchManifestOnce(apiUrl, FIRST_ATTEMPT_MS, cancel);
  if (first !== null || cancel?.aborted) return first;
  await pause(started + FIRST_ATTEMPT_MS - Date.now(), cancel);
  return cancel?.aborted ? null : fetchManifestOnce(apiUrl, RETRY_MS, cancel);
}
async function fetchAndDecrypt(credentials, apiUrl, type, name, logger) {
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
  return plaintext;
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
    const startFetch = Date.now();
    const customPrompt = await fetchCustomPrompt(credentials.apiKey, apiUrl, name);
    logger.log("FETCH", `Custom command fetched in ${Date.now() - startFetch}ms`);
    console.error("[verify] Team custom prompt \u2014 not covered by the OSS manifest");
    console.log(customPrompt.prompt);
    return;
  }
  const cancelManifest = new AbortController();
  const manifestRequest = fetchManifestQuietly(apiUrl, cancelManifest.signal);
  let plaintext;
  try {
    plaintext = await fetchAndDecrypt(credentials, apiUrl, type, name, logger);
  } catch (err) {
    cancelManifest.abort();
    throw err;
  }
  console.error("[verify] Checking prompt integrity...");
  const manifest = await manifestRequest;
  if (manifest === null) {
    console.error(MANIFEST_UNREACHABLE);
    throw new Error(MANIFEST_UNREACHABLE);
  }
  if (!verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY)) {
    console.error("[verify] Manifest signature: FAILED \u2014 prompt blocked");
    throw new Error("[SECURITY] Manifest signature verification FAILED. Prompt delivery blocked.");
  }
  console.error("[verify] Manifest signature: valid");
  const floorVerdict = checkAndRecordManifestVersion(apiUrl, manifest.version);
  if (floorVerdict !== "accepted") {
    const message = floorVerdict === "older" ? "[SECURITY] Manifest is older than one already seen \u2014 prompt blocked" : "[SECURITY] Manifest has no valid version \u2014 prompt blocked";
    console.error(message);
    throw new Error(message);
  }
  const manifestKey = `${type}/${name}`;
  const integrity = await verifyDecryptedPrompt(plaintext, type, name, manifest);
  if (integrity.verified !== true) {
    if (integrity.reason === "not_in_manifest") {
      console.error(`[verify] No manifest entry for ${stripControl(manifestKey)} \u2014 prompt blocked`);
    }
    console.error("[verify] Prompt hash: FAILED \u2014 prompt blocked");
    throw new Error("[SECURITY] Prompt integrity check FAILED. Content may have been tampered with.");
  }
  console.error("[verify] Prompt hash: verified");
  const entry = Object.hasOwn(manifest.prompts, manifestKey) ? manifest.prompts[manifestKey] : void 0;
  const currentHash = entry?.hash ?? null;
  const statePath = (0, import_path8.join)(getConfigDir(), "update-state.json");
  const updateState = readUpdateState(statePath);
  const detection = detectPromptChange(updateState, type, name, currentHash);
  if (detection.changed) {
    console.error(`[update] /oss:${name} prompt updated`);
  }
  if (Object.keys(detection.updatedSignatures).length > 0) {
    writeUpdateState(statePath, {
      ...updateState,
      promptSignatures: {
        ...updateState.promptSignatures,
        ...detection.updatedSignatures
      }
    });
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
      case "--verify-manifest":
        result.verifyManifest = true;
        break;
      case "--list-prompts":
        result.listPrompts = true;
        break;
      case "--verify-body":
        result.verifyBody = args[++i] ?? "";
        break;
      case "--category":
        result.category = args[++i];
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
  oss-decrypt --verify-manifest    Verify prompt manifest signature
  oss-decrypt --list-prompts       List all prompts in the manifest
  oss-decrypt --list-prompts --category <cat>  List prompts filtered by category
  oss-decrypt --verify-body <key> < body  Check a fetched body against the signed manifest

Options:
  --setup              Run initial setup (fetch credentials)
  --type, -t <type>    Prompt type: commands, workflows, skills, agents, hooks, custom
  --name, -n <name>    Prompt name
  --debug, -d          Enable verbose debug output
  --no-cache           Bypass cache, always fetch from API
  --clear-cache        Clear all cached prompts
  --verify-manifest    Fetch and verify the signed prompt manifest
  --list-prompts       List all prompts from the manifest
  --category <cat>     Filter --list-prompts by category
  --verify-body <key>  Exit 0 only if stdin's sha256 equals the signed servedHash of <key>
                       (shared/iron-laws or templates/claude-md); needs no credentials
  --help, -h           Show this help
  --version, -v        Show version

Examples:
  oss-decrypt --setup
  oss-decrypt --type commands --name plan
  oss-decrypt --type workflows --name build
  oss-decrypt --debug --type commands --name plan
  oss-decrypt --no-cache --type commands --name plan
  oss-decrypt --clear-cache
  oss-decrypt --verify-manifest
  oss-decrypt --list-prompts
  oss-decrypt --list-prompts --category commands
`);
}
function showVersion() {
  console.log(`oss-decrypt v${VERSION}`);
}
var MANIFEST_PUBLIC_KEY2 = "MCowBQYDK2VwAyEAAwFG32b8TuiVTxrDnXzNrb2v68YN5U9epLnZ3O7pQaI=";
var MANIFEST_UNREACHABLE2 = "[SECURITY] Manifest unreachable \u2014 check your connection and run the command again";
async function fetchManifestBounded(apiUrl) {
  const manifest = await fetchManifestQuietly(apiUrl);
  if (manifest === null) console.error(MANIFEST_UNREACHABLE2);
  return manifest;
}
function floorRefusal(verdict) {
  if (verdict === "accepted") return null;
  return verdict === "older" ? "Manifest is older than one already seen" : "Manifest has no valid version";
}
async function verifyManifestCommand() {
  const apiUrl = getApiUrl();
  const manifest = await fetchManifestBounded(apiUrl);
  if (manifest === null) {
    console.log(JSON.stringify({ signatureValid: false, trusted: false, error: "Failed to fetch manifest" }));
    process.exitCode = 1;
    return;
  }
  const prompts = manifest.prompts;
  const signatureValid = prompts !== null && typeof prompts === "object" && !Array.isArray(prompts) && verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY2);
  if (!signatureValid) {
    console.log(JSON.stringify({ signatureValid: false, trusted: false, error: "Manifest signature does not verify" }));
    process.exitCode = 1;
    return;
  }
  const refusal = floorRefusal(checkAndRecordManifestVersion(apiUrl, manifest.version));
  const categories = {};
  for (const key of Object.keys(manifest.prompts)) {
    const category = key.split("/")[0];
    categories[category] = (categories[category] ?? 0) + 1;
  }
  const report = {
    signatureValid,
    trusted: refusal === null,
    promptCount: Object.keys(manifest.prompts).length,
    generatedAt: manifest.generatedAt,
    categories,
    ...refusal === null ? {} : { error: refusal }
  };
  console.log(stripControl(JSON.stringify(report)));
  if (refusal !== null) console.error(`[SECURITY] ${refusal} \u2014 manifest not trusted`);
  if (refusal !== null) {
    process.exitCode = 1;
  }
}
async function listPromptsCommand(category) {
  const apiUrl = getApiUrl();
  const manifest = await fetchManifestBounded(apiUrl);
  if (manifest === null || !verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY2)) {
    console.log(JSON.stringify([]));
    process.exitCode = 1;
    return;
  }
  const refusal = floorRefusal(checkAndRecordManifestVersion(apiUrl, manifest.version));
  if (refusal !== null) {
    console.error(`[SECURITY] ${refusal} \u2014 manifest not trusted`);
    console.log(JSON.stringify([]));
    process.exitCode = 1;
    return;
  }
  let entries = Object.entries(manifest.prompts).map(([key, value]) => ({
    name: key,
    category: key.split("/")[0],
    hash: value.hash,
    size: value.size
  }));
  if (category) {
    entries = entries.filter((entry) => entry.category === category);
  }
  console.log(stripControl(JSON.stringify(entries)));
}
var VERIFIABLE_BODIES = /* @__PURE__ */ new Set(["shared/iron-laws", "templates/claude-md"]);
var OSS_BODY_MAX = 1024 * 1024;
var VERIFY_BODY_STDIN_TIMEOUT_MS = 3e4;
async function readStdinCapped() {
  const stdin = process.stdin;
  const readAll = async () => {
    const chunks = [];
    let total = 0;
    for await (const chunk of stdin) {
      total += chunk.length;
      if (total > OSS_BODY_MAX) return "too-large";
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  let timer;
  const deadline = new Promise((done) => {
    timer = setTimeout(() => done("timed-out"), VERIFY_BODY_STDIN_TIMEOUT_MS);
  });
  const reading = readAll();
  reading.catch(() => void 0);
  try {
    const result = await Promise.race([reading, deadline]);
    if (result === "timed-out") stdin.destroy();
    return result;
  } finally {
    clearTimeout(timer);
  }
}
async function verifyBodyReason(key) {
  if (!VERIFIABLE_BODIES.has(key)) return "[SECURITY] --verify-body: key is not a verifiable body";
  if (process.stdin.isTTY) return "[SECURITY] --verify-body: the body must be piped on stdin, not typed at a terminal";
  const apiUrl = getApiUrl();
  const cancel = new AbortController();
  const manifestRequest = fetchManifestQuietly(apiUrl, cancel.signal);
  const body = await readStdinCapped();
  if (body === "too-large" || body === "timed-out") {
    cancel.abort();
    return body === "too-large" ? `[SECURITY] --verify-body: body is larger than ${OSS_BODY_MAX} bytes` : `[SECURITY] --verify-body: stdin did not end within ${VERIFY_BODY_STDIN_TIMEOUT_MS / 1e3} s`;
  }
  const manifest = await manifestRequest;
  if (manifest === null) return MANIFEST_UNREACHABLE2;
  if (!verifyManifestSignature(manifest, MANIFEST_PUBLIC_KEY2)) {
    return "[SECURITY] Manifest signature verification FAILED \u2014 body not verified";
  }
  const floorVerdict = checkAndRecordManifestVersion(apiUrl, manifest.version);
  if (floorVerdict !== "accepted") {
    return floorVerdict === "older" ? "[SECURITY] Manifest is older than one already seen \u2014 body not verified" : "[SECURITY] Manifest has no valid version \u2014 body not verified";
  }
  const entry = Object.hasOwn(manifest.prompts, key) ? manifest.prompts[key] : void 0;
  if (typeof entry?.servedHash !== "string") {
    return `[SECURITY] No servedHash in the manifest for ${key} \u2014 body not verified`;
  }
  if ((0, import_crypto8.createHash)("sha256").update(body).digest("hex") !== entry.servedHash) {
    return `[SECURITY] Body hash does not match the signed manifest for ${key} \u2014 body not verified`;
  }
  return null;
}
async function verifyBodyCommand(key) {
  const reason = await verifyBodyReason(key);
  if (reason === null) return;
  console.error(reason);
  process.exitCode = 1;
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
  if (parsed.verifyManifest) {
    await verifyManifestCommand();
    return;
  }
  if (parsed.verifyBody !== void 0) {
    await verifyBodyCommand(parsed.verifyBody);
    return;
  }
  if (parsed.listPrompts) {
    await listPromptsCommand(parsed.category);
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
var originalEmit = process.emit.bind(process);
process.emit = function(event, ...args) {
  if (event === "warning" && typeof args[0] === "object" && args[0] !== null && args[0].name === "ExperimentalWarning") {
    return false;
  }
  return originalEmit(event, ...args);
};
runCli(process.argv.slice(2)).catch((err) => {
  console.error("Error:", stripControl(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
