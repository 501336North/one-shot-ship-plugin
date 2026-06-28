const __ossImportMetaUrl = require('url').pathToFileURL(__filename).href;
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

// src/cli/oss-launch.ts
var oss_launch_exports = {};
__export(oss_launch_exports, {
  DEFAULT_PROXY_PORT: () => DEFAULT_PROXY_PORT,
  ensureProxy: () => ensureProxy,
  isVersionRequest: () => isVersionRequest,
  main: () => main2,
  proxySpawnArgs: () => proxySpawnArgs,
  resolveClaudeBin: () => resolveClaudeBin,
  resolveEntry: () => resolveEntry,
  resolveLaunch: () => resolveLaunch,
  runLaunch: () => runLaunch
});
module.exports = __toCommonJS(oss_launch_exports);
var fs4 = __toESM(require("fs"), 1);
var path4 = __toESM(require("path"), 1);
var os3 = __toESM(require("os"), 1);
var http3 = __toESM(require("http"), 1);
var import_child_process2 = require("child_process");
var import_url2 = require("url");

// src/services/node-guard.ts
function checkNode(version, minMajor = 20) {
  if (!version) {
    return {
      ok: false,
      message: "Node.js was not found. Local model routing requires Node >= " + minMajor + ". Install Node and retry (e.g. via your version manager)."
    };
  }
  const m = version.match(/v?(\d+)\./);
  const major = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(major) || major < minMajor) {
    return {
      ok: false,
      major: Number.isFinite(major) ? major : void 0,
      message: `Node.js ${version} is too old; local model routing requires Node >= ${minMajor}.`
    };
  }
  return { ok: true, major };
}
function decidePreflight(input) {
  if (!input.routingConfigured) return { route: true };
  if (input.nodeCheck.ok) return { route: true };
  const reason = input.nodeCheck.message ?? "Node is unavailable.";
  return {
    route: false,
    banner: `\u26A0\uFE0F  OSS: local model routing DISABLED \u2014 running ALL-CLOUD. ${reason} Install/upgrade Node (or unset models.agents) to route agents locally.`
  };
}

// src/cli/start-proxy.ts
var fs3 = __toESM(require("fs"), 1);
var path3 = __toESM(require("path"), 1);
var os2 = __toESM(require("os"), 1);
var import_child_process = require("child_process");
var import_url = require("url");

// src/services/model-proxy.ts
var http2 = __toESM(require("http"), 1);
var fs2 = __toESM(require("fs"), 1);
var path2 = __toESM(require("path"), 1);
var os = __toESM(require("os"), 1);
var import_stream = require("stream");

// src/services/handlers/ollama-handler.ts
var http = __toESM(require("http"), 1);
var https = __toESM(require("https"), 1);

// src/services/api-transformer.ts
function flattenAnthropicContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}
function transformToOpenAI(request2) {
  const messages = [];
  if (request2.system) {
    messages.push({
      role: "system",
      content: flattenAnthropicContent(request2.system)
    });
  }
  for (const msg of request2.messages) {
    const transformed = transformMessageToOpenAI(msg);
    messages.push(...transformed);
  }
  const result = {
    messages,
    max_tokens: request2.max_tokens
  };
  if (request2.temperature !== void 0) {
    result.temperature = request2.temperature;
  }
  if (request2.top_p !== void 0) {
    result.top_p = request2.top_p;
  }
  if (request2.stream !== void 0) {
    result.stream = request2.stream;
  }
  if (request2.tools && request2.tools.length > 0) {
    result.tools = request2.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }));
  }
  return result;
}
function transformMessageToOpenAI(msg) {
  if (typeof msg.content === "string") {
    return [
      {
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content
      }
    ];
  }
  const results = [];
  const textParts = [];
  const toolCalls = [];
  for (const block of msg.content) {
    switch (block.type) {
      case "text":
        textParts.push(block.text);
        break;
      case "tool_use":
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
        break;
      case "tool_result":
        results.push({
          role: "tool",
          content: block.content,
          tool_call_id: block.tool_use_id
        });
        break;
    }
  }
  if (results.length > 0) {
    return results;
  }
  const role = msg.role === "user" ? "user" : "assistant";
  const message = {
    role,
    content: textParts.length > 0 ? textParts.join("") : null
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  return [message];
}
function transformFromOpenAI(response) {
  const choice = response.choices[0];
  const content = [];
  if (choice.message.content) {
    content.push({
      type: "text",
      text: choice.message.content
    });
  }
  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments)
      });
    }
  }
  let stopReason = null;
  switch (choice.finish_reason) {
    case "stop":
      stopReason = "end_turn";
      break;
    case "length":
      stopReason = "max_tokens";
      break;
    case "tool_calls":
      stopReason = "tool_use";
      break;
  }
  return {
    id: `msg_${generateId()}`,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: stopReason,
    usage: {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens
    }
  };
}
function generateId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// src/services/handlers/ollama-handler.ts
var OllamaHandler = class {
  baseUrl;
  constructor(config) {
    this.baseUrl = config.baseUrl || "http://localhost:11434";
  }
  /**
   * Get the base URL for the Ollama server
   */
  getBaseUrl() {
    return this.baseUrl;
  }
  /**
   * Get the Ollama chat endpoint
   */
  getEndpoint() {
    return `${this.baseUrl}/api/chat`;
  }
  /**
   * Handle a request by forwarding to Ollama
   */
  async handle(request2) {
    const ollamaRequest = this.transformToOllama(request2);
    const ollamaResponse = await this.makeRequest("/api/chat", ollamaRequest);
    return this.transformFromOllama(ollamaResponse);
  }
  /**
   * Check if Ollama server is running
   */
  async checkHealth() {
    try {
      await this.makeRequest("/", null, "GET");
      return true;
    } catch {
      return false;
    }
  }
  /**
   * List available models
   */
  async listModels() {
    const response = await this.makeRequest(
      "/api/tags",
      null,
      "GET"
    );
    return (response?.models ?? []).map((m) => m.name);
  }
  /**
   * Transform Anthropic request to Ollama format
   */
  transformToOllama(request2) {
    const messages = [];
    if (request2.system) {
      messages.push({
        role: "system",
        content: flattenAnthropicContent(request2.system)
      });
    }
    for (const msg of request2.messages) {
      if (typeof msg.content === "string") {
        messages.push({ role: msg.role, content: msg.content });
        continue;
      }
      const textParts = [];
      const toolUses = [];
      const toolResults = [];
      for (const block of msg.content) {
        if (block.type === "text") textParts.push(block.text);
        else if (block.type === "tool_use") toolUses.push(block);
        else if (block.type === "tool_result") toolResults.push(block);
      }
      if (msg.role === "assistant" && toolUses.length > 0) {
        messages.push({
          role: "assistant",
          content: textParts.join(""),
          tool_calls: toolUses.map((tu) => ({
            function: {
              name: tu.name,
              arguments: tu.input
            }
          }))
        });
      } else if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const c = tr.content;
          messages.push({ role: "tool", content: typeof c === "string" ? c : JSON.stringify(c) });
        }
        const text = textParts.join("");
        if (text.length > 0) messages.push({ role: msg.role, content: text });
      } else {
        messages.push({ role: msg.role, content: textParts.join("") });
      }
    }
    const ollamaRequest = {
      // Ollama expects the bare model name; strip the "ollama/" provider prefix that the
      // OSS config/agents use (e.g. "ollama/gpt-oss:120b" → "gpt-oss:120b").
      model: request2.model.replace(/^ollama\//, ""),
      messages,
      stream: false,
      options: {
        num_predict: request2.max_tokens,
        temperature: request2.temperature,
        top_p: request2.top_p
      }
    };
    if (request2.tools && request2.tools.length > 0) {
      ollamaRequest.tools = request2.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }
      }));
    }
    return ollamaRequest;
  }
  /**
   * Transform Ollama response to Anthropic format
   */
  transformFromOllama(response) {
    const content = [];
    if (response.message.content && response.message.content.length > 0) {
      content.push({ type: "text", text: response.message.content });
    }
    const toolCalls = response.message.tool_calls ?? [];
    for (const call of toolCalls) {
      const rawArgs = call.function.arguments;
      let input = {};
      if (typeof rawArgs === "string") {
        try {
          input = JSON.parse(rawArgs);
        } catch {
          input = {};
        }
      } else if (rawArgs && typeof rawArgs === "object") {
        input = rawArgs;
      }
      content.push({
        type: "tool_use",
        id: `toolu_${generateId2()}`,
        name: call.function.name,
        input
      });
    }
    const stopReason = toolCalls.length > 0 ? "tool_use" : response.done ? "end_turn" : null;
    if (content.length === 0) {
      content.push({ type: "text", text: "" });
    }
    return {
      id: `msg_${generateId2()}`,
      type: "message",
      role: "assistant",
      model: response.model,
      content,
      stop_reason: stopReason,
      usage: {
        input_tokens: response.prompt_eval_count || 0,
        output_tokens: response.eval_count || 0
      }
    };
  }
  /**
   * Make HTTP request to Ollama server
   */
  makeRequest(path5, body, method = "POST") {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl);
      const isHttps = url.protocol === "https:";
      const data = body ? JSON.stringify(body) : "";
      const options = {
        hostname: url.hostname,
        port: parseInt(url.port) || (isHttps ? 443 : 11434),
        path: path5,
        method,
        headers: body ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        } : {}
      };
      const transport = isHttps ? https : http;
      const req = transport.request(options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            let errorMessage = `Ollama error: ${res.statusCode}`;
            try {
              const errorBody = JSON.parse(responseData);
              if (errorBody.error) {
                errorMessage = `Ollama error: ${errorBody.error}`;
              }
            } catch {
            }
            reject(new Error(errorMessage));
            return;
          }
          try {
            if (!responseData.trim()) {
              resolve({});
              return;
            }
            const parsed = JSON.parse(responseData);
            resolve(parsed);
          } catch (err) {
            resolve({ text: responseData });
          }
        });
      });
      req.on("error", (err) => {
        if (err.code === "ECONNREFUSED") {
          reject(new Error("Ollama is not running. Start Ollama with: ollama serve"));
        } else {
          reject(err);
        }
      });
      if (body) {
        req.write(data);
      }
      req.end();
    });
  }
};
function generateId2() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// src/services/handlers/openrouter-handler.ts
var https2 = __toESM(require("https"), 1);
var OpenRouterHandler = class {
  config;
  constructor(config) {
    if (!config.apiKey || config.apiKey.length === 0) {
      throw new Error("API key is required for OpenRouter");
    }
    this.config = config;
  }
  /**
   * Get headers for OpenRouter API requests
   */
  getHeaders() {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://oneshotship.com",
      "X-Title": "OSS Dev Workflow"
    };
  }
  /**
   * Get the OpenRouter API endpoint
   */
  getEndpoint() {
    return "https://openrouter.ai/api/v1/chat/completions";
  }
  /**
   * Handle a request by forwarding to OpenRouter
   */
  async handle(request2) {
    const openaiRequest = transformToOpenAI(request2);
    const openaiResponse = await this.makeRequest(openaiRequest);
    return transformFromOpenAI(openaiResponse);
  }
  /**
   * Make HTTPS request to OpenRouter
   */
  makeRequest(body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const headers = this.getHeaders();
      const req = https2.request(
        {
          hostname: "openrouter.ai",
          path: "/api/v1/chat/completions",
          method: "POST",
          headers: {
            ...headers,
            "Content-Length": Buffer.byteLength(data)
          }
        },
        (res) => {
          let responseData = "";
          res.on("data", (chunk) => {
            responseData += chunk;
          });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 400) {
              let errorMessage = `OpenRouter API error: ${res.statusCode}`;
              try {
                const errorBody = JSON.parse(responseData);
                if (errorBody.error?.message) {
                  errorMessage = `OpenRouter API error: ${errorBody.error.message}`;
                }
              } catch {
              }
              reject(new Error(errorMessage));
              return;
            }
            try {
              const parsed = JSON.parse(responseData);
              resolve(parsed);
            } catch (err) {
              reject(new Error(`Failed to parse OpenRouter response: ${err}`));
            }
          });
        }
      );
      req.on("error", (err) => {
        reject(err);
      });
      req.write(data);
      req.end();
    });
  }
};

// src/services/handler-registry.ts
var SUPPORTED_PROVIDERS = ["ollama", "openrouter"];
function createHandler(config) {
  switch (config.provider) {
    case "ollama":
      return new OllamaHandler({
        baseUrl: config.baseUrl
      });
    case "openrouter":
      if (!config.apiKey) {
        throw new Error("API key is required for OpenRouter");
      }
      return new OpenRouterHandler({
        apiKey: config.apiKey
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// src/services/agent-route-resolver.ts
var MARKER_RE = /OSS-ROUTE-AGENT:\s*([A-Za-z0-9:_-]+)/;
var OLLAMA_PREFIX = "ollama/";
function extractSystemText(system) {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map(
      (block) => block && typeof block === "object" && typeof block.text === "string" ? block.text : ""
    ).join("\n");
  }
  return "";
}
function resolveRoute(requestBody, config) {
  const agents = config?.models?.agents;
  if (!agents || Object.keys(agents).length === 0) {
    return { route: "anthropic" };
  }
  const systemText = extractSystemText(requestBody?.system);
  const match = systemText.match(MARKER_RE);
  if (!match) {
    return { route: "anthropic" };
  }
  const agent = match[1];
  const mapped = agents[agent];
  if (!mapped) {
    return { route: "anthropic", agent };
  }
  if (mapped.startsWith(OLLAMA_PREFIX)) {
    return {
      route: "ollama",
      provider: "ollama",
      model: mapped.slice(OLLAMA_PREFIX.length),
      agent
    };
  }
  return { route: "anthropic", agent };
}

// src/services/proxy-router.ts
function fallbackEnabled(config) {
  return config?.models?.fallbackEnabled !== false;
}
async function routeMessages(requestBody, config, deps) {
  const decision = resolveRoute(requestBody, config);
  if (decision.route === "ollama" && decision.model) {
    try {
      const result2 = await deps.ollamaHandle(decision.model, requestBody);
      deps.log({ agent: decision.agent, model: decision.model, route: "ollama" });
      return { route: "ollama", result: result2 };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!fallbackEnabled(config)) {
        deps.log({ agent: decision.agent, model: decision.model, route: "ollama", reason: `error (no fallback): ${reason}` });
        throw err;
      }
      const result2 = await deps.passthrough(requestBody);
      deps.log({ agent: decision.agent, model: decision.model, route: "anthropic", fallback: true, reason });
      return { route: "anthropic", fellBack: true, result: result2 };
    }
  }
  const result = await deps.passthrough(requestBody);
  deps.log({ agent: decision.agent, route: "anthropic" });
  return { route: "anthropic", result };
}

// src/services/anthropic-passthrough.ts
var ANTHROPIC_BASE = "https://api.anthropic.com";
var FORWARD_HEADERS = [
  "authorization",
  "x-api-key",
  "anthropic-version",
  "anthropic-beta",
  "anthropic-dangerous-direct-browser-access",
  "content-type",
  "accept",
  "user-agent"
];
function forwardToAnthropic(opts, fetchImpl = globalThis.fetch) {
  const url = `${ANTHROPIC_BASE}${opts.path}`;
  const headers = {};
  for (const name of FORWARD_HEADERS) {
    const v = opts.headers[name];
    if (v === void 0) continue;
    headers[name] = Array.isArray(v) ? v.join(", ") : v;
  }
  const init = {
    method: opts.method,
    headers
  };
  if (opts.body !== void 0 && opts.method !== "GET" && opts.method !== "HEAD") {
    init.body = opts.body;
  }
  return fetchImpl(url, init);
}

// src/services/routing-log.ts
var fs = __toESM(require("fs"), 1);
var path = __toESM(require("path"), 1);
function createRoutingLogger(logPath) {
  return (entry) => {
    try {
      const line = JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), ...entry }) + "\n";
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, line);
    } catch {
    }
  };
}

// src/services/model-proxy.ts
function isNewConfig(config) {
  return "model" in config;
}
function isRouterConfig(config) {
  return "router" in config && config.router === true;
}
function parseProviderFromModel(modelString) {
  const slashIndex = modelString.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }
  const provider = modelString.substring(0, slashIndex);
  if (SUPPORTED_PROVIDERS.includes(provider)) {
    return provider;
  }
  return null;
}
function extractModelName(modelString) {
  const slashIndex = modelString.indexOf("/");
  if (slashIndex <= 0) {
    return modelString;
  }
  return modelString.substring(slashIndex + 1);
}
function generateId3() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
var ModelProxy = class {
  config;
  server = null;
  port = 0;
  address = "127.0.0.1";
  connections = /* @__PURE__ */ new Set();
  // Parsed values from model string
  parsedProvider = null;
  parsedModel = "";
  handler = null;
  // Router-mode state (per-agent dispatch). Left null/undefined for non-router configs.
  routerConfig = null;
  testRouteDeps = void 0;
  constructor(config) {
    this.config = config;
    if (isRouterConfig(config)) {
      this.routerConfig = config.routerConfig;
      this.testRouteDeps = config._testRouteDeps;
    } else if (isNewConfig(config)) {
      this.parsedProvider = parseProviderFromModel(config.model);
      this.parsedModel = extractModelName(config.model);
      if (!this.parsedProvider) {
        throw new Error(`Unsupported provider in model string: ${config.model}`);
      }
      if (config._testHandler) {
        this.handler = config._testHandler;
      } else {
        this.handler = createHandler({
          provider: this.parsedProvider,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl
        });
      }
    }
  }
  /**
   * Get the model name (extracted from model string)
   */
  getModel() {
    return this.parsedModel;
  }
  /**
   * Get the provider (extracted from model string)
   */
  getProvider() {
    return this.parsedProvider;
  }
  /**
   * Get the handler type (provider name)
   */
  getHandlerType() {
    return this.parsedProvider;
  }
  /**
   * Start the proxy server on an available port
   */
  async start() {
    if (this.server) {
      throw new Error("Proxy server is already running");
    }
    return new Promise((resolve, reject) => {
      this.server = http2.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      this.server.on("connection", (socket) => {
        this.connections.add(socket);
        socket.on("close", () => {
          this.connections.delete(socket);
        });
      });
      const listenPort = isRouterConfig(this.config) ? this.config.port ?? 0 : isNewConfig(this.config) && this.config.port ? this.config.port : 0;
      this.server.listen(listenPort, this.address, () => {
        const addr = this.server.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
        }
        resolve();
      });
      this.server.on("error", reject);
    });
  }
  /**
   * Shutdown the proxy server
   */
  async shutdown() {
    if (!this.server) {
      return;
    }
    return new Promise((resolve) => {
      for (const socket of this.connections) {
        socket.destroy();
      }
      this.connections.clear();
      this.server.close(() => {
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }
  /**
   * Get the port the server is listening on
   */
  getPort() {
    return this.port;
  }
  /**
   * Get the address the server is bound to
   */
  getAddress() {
    return this.address;
  }
  /**
   * Check if the server is running
   */
  isRunning() {
    return this.server !== null;
  }
  /**
   * Handle incoming HTTP request
   */
  handleRequest(req, res) {
    const url = req.url || "/";
    const method = req.method || "GET";
    const pathname = url.split("?")[0];
    if (pathname === "/" && (method === "HEAD" || method === "GET")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(method === "HEAD" ? void 0 : JSON.stringify({ ok: true }));
      return;
    }
    if (pathname === "/health" && method === "GET") {
      this.handleHealthRequest(res);
      return;
    }
    if (isRouterConfig(this.config)) {
      if (pathname === "/v1/messages" && method === "POST") {
        this.handleRouterMessages(req, res);
      } else {
        this.forwardRequest(req, res);
      }
      return;
    }
    if (pathname === "/v1/messages") {
      if (method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      this.handleMessagesRequest(req, res);
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
  /**
   * Handle GET /health request
   */
  async handleHealthRequest(res) {
    let healthy = true;
    if (this.handler && typeof this.handler.checkHealth === "function") {
      healthy = await this.handler.checkHealth();
    }
    const statusCode = healthy ? 200 : 503;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        healthy,
        provider: this.parsedProvider,
        model: this.parsedModel
      })
    );
  }
  /**
   * Handle POST /v1/messages request
   */
  /**
   * Append a one-line JSON record of a forwarded request to the file named by OSS_PROXY_LOG.
   * Opt-in only: when OSS_PROXY_LOG is unset this is a no-op (no default file, no disk growth).
   * Lets the eval prove a routed agent actually hit a given provider/model. Best-effort: any
   * failure is swallowed so logging never breaks routing.
   */
  logRequest(model) {
    const logPath = process.env.OSS_PROXY_LOG;
    if (!logPath) return;
    try {
      const provider = isNewConfig(this.config) ? this.parsedProvider : this.config.provider;
      const baseUrl = isNewConfig(this.config) ? this.config.baseUrl : void 0;
      const line = JSON.stringify({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        provider,
        model: model ?? this.parsedModel,
        baseUrl
      }) + "\n";
      fs2.mkdirSync(path2.dirname(logPath), { recursive: true });
      fs2.appendFileSync(logPath, line);
    } catch {
    }
  }
  /**
   * Stream an Anthropic SSE response. The Claude CLI always sends stream:true and will time out
   * (then retry in a loop) if it sees no bytes while the backend thinks. So we flush the opening
   * events IMMEDIATELY and emit keepalive pings during inference, then stream the result as a
   * single text_delta once the backend returns. Handles its own errors mid-stream (status 200
   * is already committed once streaming begins).
   */
  async streamSseResponse(res, requestBody) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const send = (event, data) => {
      res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
    };
    const id = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    send("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: requestBody.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      }
    });
    const ping = setInterval(() => {
      try {
        send("ping", { type: "ping" });
      } catch {
      }
    }, 5e3);
    try {
      const response = await this.handler.handle(requestBody);
      clearInterval(ping);
      this.emitResponseBlocks(send, response);
      res.end();
    } catch (error) {
      clearInterval(ping);
      const message = error instanceof Error ? error.message : "Unknown error";
      try {
        send("error", { type: "error", error: { type: "api_error", message } });
      } catch {
      }
      res.end();
    }
  }
  /**
   * Emit the content blocks + closing events for a resolved Anthropic response over an SSE
   * `send`. Shared by the streaming path (after the slow backend returns) and the router path
   * (which already has a resolved backend result). Text → text_delta, tool_use → input_json_delta,
   * so the Claude CLI can render text AND execute tool calls.
   */
  emitResponseBlocks(send, response) {
    const blocks = response.content.length > 0 ? response.content : [{ type: "text", text: "" }];
    blocks.forEach((block, index) => {
      if (block.type === "tool_use") {
        send("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: block.id, name: block.name, input: {} }
        });
        send("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) }
        });
      } else {
        send("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" }
        });
        send("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: block.text ?? "" }
        });
      }
      send("content_block_stop", { type: "content_block_stop", index });
    });
    send("message_delta", {
      type: "message_delta",
      delta: { stop_reason: response.stop_reason ?? "end_turn", stop_sequence: null },
      usage: { output_tokens: response.usage?.output_tokens ?? 0 }
    });
    send("message_stop", { type: "message_stop" });
  }
  /**
   * Emit a fully-resolved Anthropic response as an SSE event stream in one pass. Unlike
   * streamSseResponse (which flushes early + pings while a slow backend thinks), the router's
   * Ollama result is already resolved, so there is nothing to wait for — emit message_start,
   * the content blocks, then message_stop directly.
   */
  emitResolvedSse(res, response, requestModel) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    const send = (event, data) => {
      res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
    };
    const id = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    send("message_start", {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        // Mirror streamSseResponse: prefer the request's model for client consistency, fall back
        // to the backend-reported model.
        model: requestModel ?? response.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: 0 }
      }
    });
    this.emitResponseBlocks(send, response);
    res.end();
  }
  /**
   * Pipe an upstream fetch Response back to the client verbatim (status + content-type + body).
   * Used by both the router fallback/pass-through path and the faithful reverse-proxy forward.
   */
  pipeUpstream(res, upstream) {
    const contentType = upstream.headers.get("content-type") || "application/json";
    res.writeHead(upstream.status, { "Content-Type": contentType });
    if (upstream.body) {
      import_stream.Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  }
  /**
   * Forward any non-/v1/messages request straight to Anthropic and pipe the bytes back — a
   * faithful reverse proxy. Buffers the body first so POST payloads (e.g. count_tokens) survive.
   */
  forwardRequest(req, res) {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks);
      try {
        const upstream = this.testRouteDeps ? await this.testRouteDeps.passthrough(rawBody) : await forwardToAnthropic({
          path: req.url || "/",
          method: req.method || "POST",
          headers: req.headers,
          body: rawBody
        });
        this.pipeUpstream(res, upstream);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    });
    req.on("error", () => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request error" }));
    });
  }
  /**
   * Router mode: dispatch POST /v1/messages per-agent via routeMessages. We write NOTHING to
   * `res` until routeMessages resolves — that's what lets the Ollama-throw case silently fall
   * back to Anthropic. Then render by route: 'ollama' result is a resolved AnthropicResponse
   * (emit as SSE); 'anthropic' result is a fetch Response (pipe it back verbatim).
   */
  handleRouterMessages(req, res) {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks);
      const routerConfig = this.routerConfig;
      let parsedBody;
      try {
        parsedBody = JSON.parse(rawBody.toString());
      } catch {
        try {
          const upstream = await forwardToAnthropic({
            path: req.url || "/",
            method: req.method || "POST",
            headers: req.headers,
            body: rawBody
          });
          this.pipeUpstream(res, upstream);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
        return;
      }
      const deps = this.testRouteDeps ?? {
        ollamaHandle: async (model, body) => createHandler({
          provider: "ollama",
          baseUrl: routerConfig.models?.apiKeys?.ollama
        }).handle({ ...body, model }),
        passthrough: async () => forwardToAnthropic({
          path: req.url || "/",
          method: req.method || "POST",
          headers: req.headers,
          body: rawBody
        }),
        log: createRoutingLogger(
          path2.join(os.homedir(), ".oss", "logs", "model-routing.log")
        )
      };
      try {
        const outcome = await routeMessages(parsedBody, routerConfig, deps);
        if (outcome.route === "ollama") {
          this.emitResolvedSse(
            res,
            outcome.result,
            parsedBody.model
          );
        } else {
          this.pipeUpstream(res, outcome.result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    });
    req.on("error", () => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request error" }));
    });
  }
  handleMessagesRequest(req, res) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      let requestBody;
      try {
        requestBody = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
      if (isNewConfig(this.config) && this.config.model) {
        requestBody.model = this.config.model;
      }
      this.logRequest(requestBody?.model);
      if (this.handler) {
        if (requestBody.stream) {
          await this.streamSseResponse(res, requestBody);
        } else {
          try {
            const response = await this.handler.handle(requestBody);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(response));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: errorMessage }));
          }
        }
        return;
      }
      const providerName = isNewConfig(this.config) ? this.parsedProvider : isRouterConfig(this.config) ? null : this.config.provider;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `msg_${generateId3()}`,
          type: "message",
          role: "assistant",
          model: providerName,
          content: [
            {
              type: "text",
              text: `Proxy received request for provider: ${providerName}`
            }
          ],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 0,
            output_tokens: 0
          }
        })
      );
    });
    req.on("error", () => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Request error" }));
    });
  }
};

// src/cli/start-proxy.ts
var DEFAULT_PORT = 8473;
var SUPPORTED_PROVIDERS2 = ["ollama", "openrouter"];
function parseCliArgs(args) {
  const result = {
    model: void 0,
    port: DEFAULT_PORT,
    apiKey: void 0,
    background: false,
    showHelp: false,
    router: false,
    errors: []
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      result.showHelp = true;
      return result;
    }
    if (arg === "--model" && args[i + 1]) {
      result.model = args[++i];
    } else if (arg === "--port" && args[i + 1]) {
      const portStr = args[++i];
      const port = parseInt(portStr, 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        result.port = port;
      } else {
        result.errors.push(`Invalid port: ${portStr}`);
      }
    } else if (arg === "--api-key" && args[i + 1]) {
      result.apiKey = args[++i];
    } else if (arg === "--base-url" && args[i + 1]) {
      result.baseUrl = args[++i];
    } else if (arg === "--background") {
      result.background = true;
    } else if (arg === "--router") {
      result.router = true;
    }
  }
  if (!result.model && !result.showHelp && !result.router) {
    result.errors.push("--model is required");
  }
  return result;
}
function validateModel(model) {
  const slashIndex = model.indexOf("/");
  if (slashIndex <= 0) {
    return {
      valid: false,
      error: "Invalid model format. Expected: provider/model-name"
    };
  }
  const provider = model.substring(0, slashIndex);
  if (!SUPPORTED_PROVIDERS2.includes(provider)) {
    return {
      valid: false,
      error: `Unsupported provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS2.join(", ")}`
    };
  }
  return { valid: true };
}
function getUserConfigDir() {
  return path3.join(os2.homedir(), ".oss");
}
function loadApiKeyFromConfig(provider) {
  const configPath = path3.join(getUserConfigDir(), "config.json");
  try {
    if (fs3.existsSync(configPath)) {
      const content = fs3.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      const keyMap = {
        openrouter: "openrouterApiKey"
      };
      const configKey = keyMap[provider];
      if (configKey && config[configKey]) {
        return config[configKey];
      }
    }
  } catch {
  }
  return void 0;
}
function loadOllamaBaseUrlFromConfig() {
  const configPath = path3.join(getUserConfigDir(), "config.json");
  try {
    if (fs3.existsSync(configPath)) {
      const content = fs3.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      const url = config?.models?.apiKeys?.ollama ?? config?.apiKeys?.ollama;
      if (typeof url === "string" && url.length > 0) {
        return url;
      }
    }
  } catch {
  }
  return void 0;
}
function getPidFilePath(port) {
  const ossDir = getUserConfigDir();
  if (port && port !== DEFAULT_PORT) {
    return path3.join(ossDir, `proxy-${port}.pid`);
  }
  return path3.join(ossDir, "proxy.pid");
}
function writePidFile(pid, port) {
  const ossDir = getUserConfigDir();
  fs3.mkdirSync(ossDir, { recursive: true });
  fs3.writeFileSync(getPidFilePath(port), String(pid));
}
function cleanupPidFile(port) {
  const pidPath = getPidFilePath(port);
  try {
    if (fs3.existsSync(pidPath)) {
      fs3.unlinkSync(pidPath);
    }
  } catch {
  }
}
async function startProxy(options) {
  const { model, port, apiKey, baseUrl, background, _testProxy } = options;
  const proxy = _testProxy || new ModelProxy({
    model,
    port,
    apiKey,
    baseUrl
  });
  try {
    await proxy.start();
    const actualPort = proxy.getPort();
    const pid = process.pid;
    return {
      port: actualPort,
      pid,
      model,
      background,
      // Return proxy instance for shutdown handling (not for background mode)
      proxy: background ? void 0 : proxy
    };
  } catch (error) {
    const err = error;
    if (err.code === "EADDRINUSE") {
      return {
        port,
        pid: 0,
        model,
        background,
        error: `Port ${port} is already in use`
      };
    }
    return {
      port,
      pid: 0,
      model,
      background,
      error: err.message
    };
  }
}
function buildRouterConfig(raw) {
  const r = raw ?? {};
  const models = r.models ?? {};
  return {
    models: {
      default: models.default,
      agents: models.agents ?? {},
      fallbackEnabled: models.fallbackEnabled !== false,
      apiKeys: { ollama: models.apiKeys?.ollama ?? r.apiKeys?.ollama }
    }
  };
}
function loadRouterConfigFromFile() {
  const configPath = path3.join(getUserConfigDir(), "config.json");
  try {
    if (fs3.existsSync(configPath)) {
      const content = fs3.readFileSync(configPath, "utf-8");
      return buildRouterConfig(JSON.parse(content));
    }
  } catch {
  }
  return buildRouterConfig({});
}
async function startRouterProxy(options) {
  const { port, background, routerConfig, _testProxy } = options;
  const proxy = _testProxy || new ModelProxy({ router: true, routerConfig, port });
  try {
    await proxy.start();
    return {
      port: proxy.getPort(),
      pid: process.pid,
      model: "router",
      background,
      proxy: background ? void 0 : proxy
    };
  } catch (error) {
    const err = error;
    if (err.code === "EADDRINUSE") {
      return { port, pid: 0, model: "router", background, error: `Port ${port} is already in use` };
    }
    return { port, pid: 0, model: "router", background, error: err.message };
  }
}
async function startProxyBackground(options) {
  const { model, port, apiKey, baseUrl, router, _testSpawn } = options;
  const spawnFn = _testSpawn || import_child_process.spawn;
  const args = router ? ["--router", "--port", String(port)] : ["--model", model, "--port", String(port)];
  if (!router && apiKey) {
    args.push("--api-key", apiKey);
  }
  if (!router && baseUrl) {
    args.push("--base-url", baseUrl);
  }
  const selfPath = (0, import_url.fileURLToPath)(__ossImportMetaUrl);
  const child = spawnFn(process.execPath, [selfPath, ...args], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  const pid = child.pid || 0;
  if (pid) {
    writePidFile(pid, port);
  }
  return {
    port,
    pid,
    model: router ? "router" : model,
    background: true
  };
}
function createShutdownHandler(proxy, cleanup) {
  return async (signal) => {
    if (proxy.isRunning()) {
      await proxy.shutdown();
    }
    if (cleanup) {
      cleanup();
    }
  };
}
function formatOutput(result) {
  return JSON.stringify(result);
}
function showHelp() {
  console.log(`
start-proxy - Start ModelProxy server for agent model routing

USAGE:
  npx tsx src/cli/start-proxy.ts --model <provider/model> [options]

OPTIONS:
  --model <provider/model>  Model to use (required)
                           Examples: ollama/codellama, openrouter/anthropic/claude-3-haiku
  --port <number>          Port to listen on (default: ${DEFAULT_PORT})
  --api-key <key>          API key for the provider (loaded from config if not provided)
  --router                 Router mode: per-agent dispatch from the merged config (no --model)
  --background             Run in background (detached) mode
  --help, -h               Show this help message

EXAMPLES:
  npx tsx src/cli/start-proxy.ts --model ollama/codellama
  npx tsx src/cli/start-proxy.ts --model ollama/codellama --port 3457
  npx tsx src/cli/start-proxy.ts --model openrouter/anthropic/claude-3-haiku --api-key sk-or-xxx
  npx tsx src/cli/start-proxy.ts --model ollama/codellama --background

OUTPUT:
  JSON object with: { port, pid, model, background, error? }
`);
}
async function main(args = process.argv.slice(2)) {
  const parsedArgs = parseCliArgs(args);
  if (parsedArgs.showHelp) {
    showHelp();
    process.exit(0);
  }
  if (parsedArgs.errors.length > 0) {
    console.error(JSON.stringify({ error: parsedArgs.errors.join(", ") }));
    process.exit(1);
  }
  if (parsedArgs.router) {
    try {
      if (parsedArgs.background) {
        const result = await startProxyBackground({ router: true, port: parsedArgs.port });
        console.log(formatOutput(result));
      } else {
        const result = await startRouterProxy({
          port: parsedArgs.port,
          background: false,
          routerConfig: loadRouterConfigFromFile()
        });
        if (result.error) {
          console.error(formatOutput(result));
          process.exit(1);
        }
        if (result.proxy) {
          const shutdownHandler = createShutdownHandler(result.proxy, () => {
            cleanupPidFile(parsedArgs.port);
          });
          process.on("SIGTERM", () => {
            shutdownHandler("SIGTERM").then(() => process.exit(0));
          });
          process.on("SIGINT", () => {
            shutdownHandler("SIGINT").then(() => process.exit(0));
          });
        }
        writePidFile(process.pid, parsedArgs.port);
        console.log(formatOutput(result));
      }
    } catch (err) {
      console.error(JSON.stringify({ error: err.message }));
      process.exit(1);
    }
    return;
  }
  const validation = validateModel(parsedArgs.model);
  if (!validation.valid) {
    console.error(JSON.stringify({ error: validation.error }));
    process.exit(1);
  }
  const provider = parsedArgs.model.split("/")[0];
  let apiKey = parsedArgs.apiKey;
  if (!apiKey && provider !== "ollama") {
    apiKey = loadApiKeyFromConfig(provider);
  }
  let baseUrl = parsedArgs.baseUrl;
  if (!baseUrl && provider === "ollama") {
    baseUrl = loadOllamaBaseUrlFromConfig();
  }
  try {
    let result;
    if (parsedArgs.background) {
      result = await startProxyBackground({
        model: parsedArgs.model,
        port: parsedArgs.port,
        apiKey,
        baseUrl
      });
    } else {
      result = await startProxy({
        model: parsedArgs.model,
        port: parsedArgs.port,
        apiKey,
        baseUrl,
        background: false
      });
      if (result.error) {
        console.error(formatOutput(result));
        process.exit(1);
      }
      if (result.proxy) {
        const shutdownHandler = createShutdownHandler(result.proxy, () => {
          cleanupPidFile(parsedArgs.port);
        });
        process.on("SIGTERM", () => {
          shutdownHandler("SIGTERM").then(() => process.exit(0));
        });
        process.on("SIGINT", () => {
          shutdownHandler("SIGINT").then(() => process.exit(0));
        });
      }
      writePidFile(process.pid, parsedArgs.port);
    }
    console.log(formatOutput(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}
var isMainModule = process.argv[1]?.endsWith("start-proxy.js") || process.argv[1]?.endsWith("start-proxy.cjs") || process.argv[1]?.endsWith("start-proxy.ts");
if (isMainModule) {
  main().catch((err) => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
}

// src/cli/oss-launch.ts
var DEFAULT_PROXY_PORT = 8473;
function resolveLaunch(config, baseEnv) {
  const agents = config?.models?.agents;
  const hasAgents = !!agents && Object.keys(agents).length > 0;
  if (!hasAgents) {
    return { useProxy: false, env: baseEnv };
  }
  const envPort = baseEnv.OSS_PROXY_PORT ? Number(baseEnv.OSS_PROXY_PORT) : void 0;
  const port = (envPort && Number.isFinite(envPort) ? envPort : void 0) ?? config?.models?.proxyPort ?? DEFAULT_PROXY_PORT;
  const env = {
    ...baseEnv,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    OSS_PROXY_ROUTING: "1"
  };
  return { useProxy: true, port, env };
}
function resolveEntry(argv) {
  return argv[0] === "start-proxy" ? "start-proxy" : "launch";
}
function isVersionRequest(argv) {
  return argv.includes("--version") || argv.includes("-v");
}
function proxySpawnArgs(opts) {
  const head = opts.bundled ? ["start-proxy"] : [opts.startProxyJs];
  return [...head, "--router", "--background", "--port", String(opts.port)];
}
async function runLaunch(argv, deps) {
  const decision = resolveLaunch(deps.loadConfig(), deps.baseEnv);
  const nodeCheck = (deps.nodeCheck ?? (() => ({ ok: true })))();
  const preflight = decidePreflight({ nodeCheck, routingConfigured: decision.useProxy });
  let env = decision.env;
  if (decision.useProxy && preflight.route && decision.port !== void 0) {
    await deps.ensureProxy(decision.port);
  } else if (decision.useProxy && !preflight.route) {
    (deps.warn ?? ((m) => console.error(m)))(preflight.banner ?? "");
    env = deps.baseEnv;
  }
  const bin = deps.resolveClaudeBin();
  const child = deps.spawn(bin, argv, { env, stdio: "inherit" });
  return new Promise((resolve) => {
    child.on("close", (code) => resolve(typeof code === "number" ? code : 0));
    child.on("error", () => resolve(1));
  });
}
function resolveClaudeBin(deps) {
  const delimiter2 = deps.delimiter ?? ":";
  const sep2 = deps.sep ?? "/";
  const realpath = deps.realpath ?? ((p) => p);
  const selfReal = realpath(deps.selfPath);
  for (const dir of deps.pathEnv.split(delimiter2)) {
    if (!dir) continue;
    const candidate = `${dir}${sep2}claude`;
    if (!deps.isExecutable(candidate)) continue;
    if (realpath(candidate) === selfReal) continue;
    return candidate;
  }
  throw new Error("Could not find the real `claude` binary on PATH (only the launcher itself).");
}
async function ensureProxy(port, deps) {
  if (await deps.healthCheck(port)) return;
  deps.startProxy();
  const maxAttempts = deps.maxAttempts ?? 40;
  const intervalMs = deps.intervalMs ?? 250;
  for (let i = 0; i < maxAttempts; i++) {
    await deps.sleep(intervalMs);
    if (await deps.healthCheck(port)) return;
  }
  throw new Error(`OSS proxy did not become healthy on port ${port} after ${maxAttempts} attempts.`);
}
function loadMergedConfig(fsImpl, pathImpl, osImpl) {
  const read = (file) => {
    try {
      if (fsImpl.existsSync(file)) return JSON.parse(fsImpl.readFileSync(file, "utf-8"));
    } catch {
    }
    return null;
  };
  const userCfg = read(pathImpl.join(osImpl.homedir(), ".oss", "config.json"));
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  const projectCfg = projectDir ? read(pathImpl.join(projectDir, ".oss", "config.json")) : null;
  const merged = { ...userCfg ?? {}, ...projectCfg ?? {} };
  return { models: merged.models };
}
async function main2(argv) {
  const selfPath = (() => {
    try {
      return fs4.realpathSync(process.argv[1] ?? (0, import_url2.fileURLToPath)(__ossImportMetaUrl));
    } catch {
      return process.argv[1] ?? "";
    }
  })();
  const startProxyJs = path4.join(path4.dirname((0, import_url2.fileURLToPath)(__ossImportMetaUrl)), "start-proxy.js");
  const bundled = true;
  if (resolveEntry(argv) === "start-proxy") {
    await main(argv.slice(1));
    return void 0;
  }
  if (isVersionRequest(argv)) {
    let version = "2.0.78" ? "2.0.78" : "unknown";
    if (version === "unknown") {
      try {
        const manifest = path4.join(path4.dirname((0, import_url2.fileURLToPath)(__ossImportMetaUrl)), "..", "..", "..", ".claude-plugin", "plugin.json");
        version = JSON.parse(fs4.readFileSync(manifest, "utf-8")).version ?? version;
      } catch {
      }
    }
    console.log(`oss-launch ${version}`);
    return 0;
  }
  const healthCheck = (port) => new Promise((resolve) => {
    const req = http3.get({ hostname: "127.0.0.1", port, path: "/health", timeout: 1e3 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
  const deps = {
    loadConfig: () => loadMergedConfig(fs4, path4, os3),
    ensureProxy: (port) => ensureProxy(port, {
      healthCheck,
      startProxy: () => {
        const child = (0, import_child_process2.spawn)(
          process.execPath,
          proxySpawnArgs({ bundled, startProxyJs, port }),
          { detached: true, stdio: "ignore" }
        );
        child.unref();
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    }),
    resolveClaudeBin: () => resolveClaudeBin({
      pathEnv: process.env.PATH ?? "",
      selfPath,
      isExecutable: (p) => {
        try {
          fs4.accessSync(p, fs4.constants.X_OK);
          return fs4.statSync(p).isFile();
        } catch {
          return false;
        }
      },
      realpath: (p) => {
        try {
          return fs4.realpathSync(p);
        } catch {
          return p;
        }
      },
      delimiter: path4.delimiter,
      sep: path4.sep
    }),
    spawn: (bin, args, opts) => (0, import_child_process2.spawn)(bin, args, opts),
    baseEnv: process.env,
    // The bundled binary ships its OWN runtime — trust it (the floor check exists only to catch a
    // bad SYSTEM node on the fallback path). Only probe process.version when running via system node.
    nodeCheck: () => bundled ? { ok: true } : checkNode(process.version),
    warn: (msg) => console.error(msg)
  };
  return runLaunch(argv, deps);
}
var isMainModule2 = __ossImportMetaUrl === `file://${process.argv[1]}` || process.argv[1]?.endsWith("oss-launch.js") || process.argv[1]?.endsWith("oss-launch.cjs") || process.argv[1]?.endsWith("oss-launch.ts") || // Bundled self-contained binary: argv[1] is undefined and the entry IS process.execPath.
process.argv[1] === void 0 && /oss-launch/.test(process.execPath);
if (isMainModule2) {
  main2(process.argv.slice(2)).then((code) => {
    if (typeof code === "number") process.exit(code);
  }).catch((err) => {
    console.error(`[oss-launch] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_PROXY_PORT,
  ensureProxy,
  isVersionRequest,
  main,
  proxySpawnArgs,
  resolveClaudeBin,
  resolveEntry,
  resolveLaunch,
  runLaunch
});
