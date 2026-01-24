# Testing Strategy: Configurable Workflow Orchestration

## Unit Tests (~30 tests)

### Config Schema (6 tests)
- `should validate minimal valid config`
- `should reject config with unknown workflow`
- `should reject config with invalid chain reference`
- `should provide defaults for missing optional fields`
- `should validate condition strings`
- `should validate agent references`

### Config Loader (5 tests)
- `should load config from ~/.oss/config.json`
- `should load config from project oss.config.json`
- `should merge project config over user config`
- `should apply defaults when no config exists`
- `should handle missing config files gracefully`

### Default Config (4 tests)
- `default config should have ideate workflow with 4 chains`
- `default config should have plan workflow chaining to acceptance`
- `default config should have build workflow with TDD loop`
- `default config should have ship workflow with 4 parallel agents`

### Condition Evaluator (5 tests)
- `should evaluate has_api_work condition based on design content`
- `should evaluate has_db_work condition based on design content`
- `should evaluate has_ui_work condition based on files changed`
- `should return false for unmet conditions`
- `should handle custom condition expressions`

### Chain Executor (5 tests)
- `should invoke Skill tool for command chains`
- `should skip optional chains when condition is false`
- `should execute chains in order`
- `should stop at human checkpoint`
- `should auto-proceed at auto checkpoint`

### Agent Spawner (5 tests)
- `should spawn single agent with Task tool`
- `should spawn parallel agents in single message`
- `should skip conditional agents when condition false`
- `should aggregate results from multiple agents`
- `should fail fast when required agent fails`

## Integration Tests (~10 tests)

### Workflow Orchestrator (3 tests)
- `should load config at workflow start`
- `should pass workflow name to executor`
- `should inject chain instructions into prompt context`

### Prompt Integration (4 tests)
- `ideate with default config should chain to 4 commands`
- `plan with default config should chain to acceptance`
- `build with default config should spawn refinement agents`
- `ship with default config should spawn 4 quality agents`

### CLI Commands (3 tests)
- `oss config validate should pass for valid config`
- `oss config validate should fail with helpful errors`
- `oss config init should create default config file`

## End-to-End Tests (~5 tests)

- `full ideate workflow with custom config`
- `full plan workflow with custom config`
- `full build workflow with custom agents`
- `full ship workflow with custom quality gates`
- `workflow with all steps customized`

## Test Coverage Requirements

| Module | Target Coverage |
|--------|-----------------|
| config/schema.ts | 100% |
| config/loader.ts | 100% |
| config/defaults.ts | 100% |
| engine/conditions.ts | 100% |
| engine/executor.ts | 100% |
| engine/agents.ts | 100% |

## Mocking Strategy (London TDD)

| Dependency | Mock Type |
|------------|-----------|
| File system (fs) | Stub |
| Skill tool | Mock with verification |
| Task tool | Mock with verification |
| WorkflowContext | Fake object |
| Config file content | Test fixtures |

## Test Fixtures

```
test/fixtures/
├── valid-config.json       # Valid complete config
├── minimal-config.json     # Minimal valid config
├── invalid-config.json     # Various invalid configs
├── custom-ideate.json      # Custom ideate workflow
└── custom-ship.json        # Custom ship quality gates
```
