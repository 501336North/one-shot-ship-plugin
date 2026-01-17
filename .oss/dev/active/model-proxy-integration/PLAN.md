# TDD Implementation Plan: Model Proxy Integration

Complete the per-prompt model routing by connecting the proxy server to handlers and creating the start-proxy CLI.

## Overview

**Feature:** Model Proxy Integration (Option B)
**Goal:** Enable agents to route requests through Ollama/OpenRouter instead of Claude
**Status:** Planning

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Agent Execution Flow                                            │
│                                                                  │
│  1. Agent checks model config (agent-model-check.js)            │
│     ↓                                                            │
│  2. If useProxy=true, start proxy (start-proxy.js)              │
│     ↓                                                            │
│  3. Proxy starts on localhost:3456                               │
│     ↓                                                            │
│  4. Agent sends Anthropic-format request to proxy               │
│     ↓                                                            │
│  5. Proxy routes to handler (OllamaHandler/OpenRouterHandler)   │
│     ↓                                                            │
│  6. Handler transforms & forwards to provider                    │
│     ↓                                                            │
│  7. Response flows back: Provider → Handler → Proxy → Agent     │
└─────────────────────────────────────────────────────────────────┘
```

## Existing Code (Already Built)

| Component | File | Status |
|-----------|------|--------|
| OllamaHandler | `src/services/handlers/ollama-handler.ts` | ✅ Complete |
| OpenRouterHandler | `src/services/handlers/openrouter-handler.ts` | ✅ Complete |
| ApiTransformer | `src/services/api-transformer.ts` | ✅ Complete |
| ModelProxy (shell) | `src/services/model-proxy.ts` | ⚠️ Placeholder only |
| agent-model-check | `src/cli/agent-model-check.ts` | ✅ Complete |
| Config loading | `src/config/model-config.ts` | ✅ Complete |

## What Needs Building

| Component | File | Status |
|-----------|------|--------|
| ModelProxy (real) | `src/services/model-proxy.ts` | 🔴 Wire to handlers |
| start-proxy CLI | `src/cli/start-proxy.ts` | 🔴 Not implemented |
| Handler registry | `src/services/handler-registry.ts` | 🔴 Not implemented |
| Proxy health check | (endpoint) | 🔴 Not implemented |

---

## Phase 1: Handler Registry (4 tasks, ~16 tests)

Create a registry that maps provider names to handler instances.

### Task 1.1: Define HandlerRegistry Types
**Tests:** 4
```typescript
// test/services/handler-registry.test.ts
describe('HandlerRegistry types', () => {
  it('should define Handler interface with handle() method');
  it('should define HandlerConfig with provider and apiKey');
  it('should define supported providers: ollama, openrouter');
  it('should export createHandler factory function');
});
```

### Task 1.2: Implement createHandler Factory
**Tests:** 6
```typescript
describe('createHandler', () => {
  it('should create OllamaHandler for provider "ollama"');
  it('should create OpenRouterHandler for provider "openrouter"');
  it('should throw for unknown provider');
  it('should pass apiKey to OpenRouterHandler');
  it('should pass baseUrl to OllamaHandler');
  it('should not require apiKey for Ollama');
});
```

### Task 1.3: Implement HandlerRegistry Class
**Tests:** 6
```typescript
describe('HandlerRegistry', () => {
  it('should register handler for provider');
  it('should get handler by provider');
  it('should throw if handler not registered');
  it('should support multiple handlers');
  it('should have getOrCreate() for lazy initialization');
  it('should cache created handlers');
});
```

---

## Phase 2: Wire ModelProxy to Handlers (4 tasks, ~20 tests)

Connect the existing ModelProxy to actually route requests through handlers.

### Task 2.1: Update ModelProxy Constructor
**Tests:** 4
```typescript
describe('ModelProxy constructor', () => {
  it('should accept model string (e.g., "ollama/codellama")');
  it('should parse provider from model string');
  it('should accept optional apiKey');
  it('should accept optional port (default 3456)');
});
```

### Task 2.2: Implement Handler Selection
**Tests:** 4
```typescript
describe('ModelProxy handler selection', () => {
  it('should select OllamaHandler for ollama/* models');
  it('should select OpenRouterHandler for openrouter/* models');
  it('should extract model name from model string');
  it('should throw for unsupported provider');
});
```

### Task 2.3: Implement Request Forwarding
**Tests:** 6
```typescript
describe('ModelProxy request forwarding', () => {
  it('should parse incoming Anthropic request');
  it('should forward to handler.handle()');
  it('should return handler response as JSON');
  it('should handle handler errors gracefully');
  it('should set correct Content-Type header');
  it('should return 500 on handler failure');
});
```

### Task 2.4: Add Health Check Endpoint
**Tests:** 6
```typescript
describe('ModelProxy /health endpoint', () => {
  it('should respond to GET /health');
  it('should return 200 when proxy is running');
  it('should include provider in health response');
  it('should include model in health response');
  it('should check handler connectivity (Ollama)');
  it('should return 503 if handler unhealthy');
});
```

---

## Phase 3: Start-Proxy CLI (4 tasks, ~18 tests)

Create the CLI that agents use to start the proxy server.

### Task 3.1: Define CLI Arguments
**Tests:** 5
```typescript
// test/cli/start-proxy.test.ts
describe('start-proxy CLI arguments', () => {
  it('should require --model argument');
  it('should accept --port argument (default 3456)');
  it('should accept --api-key argument');
  it('should accept --background flag');
  it('should show help with --help');
});
```

### Task 3.2: Implement Proxy Startup
**Tests:** 5
```typescript
describe('start-proxy startup', () => {
  it('should start ModelProxy on specified port');
  it('should output JSON with port and pid');
  it('should handle port already in use');
  it('should validate model format');
  it('should load apiKey from config if not provided');
});
```

### Task 3.3: Implement Background Mode
**Tests:** 4
```typescript
describe('start-proxy background mode', () => {
  it('should detach when --background flag set');
  it('should write pid file to .oss/proxy.pid');
  it('should allow multiple proxies on different ports');
  it('should output JSON with background: true');
});
```

### Task 3.4: Implement Proxy Shutdown
**Tests:** 4
```typescript
describe('start-proxy shutdown', () => {
  it('should handle SIGTERM gracefully');
  it('should handle SIGINT gracefully');
  it('should clean up pid file on shutdown');
  it('should close all connections before exit');
});
```

---

## Phase 4: Integration Testing (3 tasks, ~15 tests)

End-to-end tests with real Ollama (when available).

### Task 4.1: Proxy + OllamaHandler Integration
**Tests:** 5
```typescript
describe('Proxy + Ollama integration', () => {
  it('should forward request to Ollama and get response');
  it('should handle large responses');
  it('should transform tool_use requests correctly');
  it('should handle Ollama timeout');
  it('should handle Ollama not running');
});
```

### Task 4.2: Proxy + OpenRouterHandler Integration
**Tests:** 5
```typescript
describe('Proxy + OpenRouter integration', () => {
  it('should forward request to OpenRouter and get response');
  it('should include proper headers');
  it('should handle API key errors');
  it('should handle rate limiting');
  it('should transform response correctly');
});
```

### Task 4.3: Agent-to-Proxy Integration
**Tests:** 5
```typescript
describe('Agent to Proxy flow', () => {
  it('should check model config and start proxy');
  it('should make request to proxy and get response');
  it('should stop proxy after agent completes');
  it('should fallback to Claude if proxy fails');
  it('should log cost tracking data');
});
```

---

## Phase 5: Agent Integration (2 tasks, ~8 tests)

Update agents to actually use the proxy when configured.

### Task 5.1: Update _shared/model-routing.md
**Tests:** 4
```typescript
describe('Agent model routing', () => {
  it('should include proxy start command in routing logic');
  it('should use WebFetch to call proxy');
  it('should parse proxy response correctly');
  it('should handle proxy errors gracefully');
});
```

### Task 5.2: Test Agent with Custom Model
**Tests:** 4
```typescript
describe('Agent with custom model', () => {
  it('should detect custom model config');
  it('should start proxy and make request');
  it('should return formatted response');
  it('should stop proxy on completion');
});
```

---

## Summary

| Phase | Tasks | Estimated Tests |
|-------|-------|-----------------|
| Phase 1: Handler Registry | 3 | 16 |
| Phase 2: Wire ModelProxy | 4 | 20 |
| Phase 3: Start-Proxy CLI | 4 | 18 |
| Phase 4: Integration | 3 | 15 |
| Phase 5: Agent Integration | 2 | 8 |
| **Total** | **16** | **~77** |

## Dependencies

- Ollama running locally for integration tests (optional - can mock)
- OpenRouter API key for OpenRouter integration tests (optional - can mock)

## Files to Create/Modify

**New Files:**
- `watcher/src/services/handler-registry.ts`
- `watcher/src/cli/start-proxy.ts`
- `watcher/test/services/handler-registry.test.ts`
- `watcher/test/cli/start-proxy.test.ts`
- `watcher/test/integration/proxy-integration.test.ts`

**Modified Files:**
- `watcher/src/services/model-proxy.ts` (wire to handlers)
- `agents/_shared/model-routing.md` (update with proxy usage)

## Acceptance Criteria

1. `/oss:models set oss:code-reviewer ollama/codellama` configures the model
2. When code-reviewer agent runs, it:
   - Detects custom model config
   - Starts proxy on port 3456
   - Makes Anthropic-format request to proxy
   - Proxy forwards to Ollama
   - Response returns through proxy to agent
3. Cost tracking shows $0 for Ollama models
4. Fallback to Claude if proxy/Ollama fails (when enabled)

## Last Updated: 2026-01-17 by /oss:plan
