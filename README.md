# One Shot Ship - Claude Code Plugin

World-class development workflows for Claude Code. Ship software with confidence using London-style TDD.

## Installation

```bash
# In Claude Code
/plugin marketplace add 501336north/one-shot-ship-plugin
/plugin install oss@501336north-one-shot-ship-plugin
```

## Getting Started

1. **Register** at [oneshotship.com](https://www.oneshotship.com)
2. **Login** in Claude Code: `/oss:login`
3. **Start building**: `/oss:ideate "your idea"`

## Core Workflow

```
/oss:ideate → /oss:plan → /oss:build → /oss:ship
```

| Command | Description |
|---------|-------------|
| `/oss:ideate` | Transform ideas into actionable designs |
| `/oss:plan` | Create TDD implementation plans |
| `/oss:build` | Execute plans with strict TDD |
| `/oss:ship` | Quality check, commit, PR, merge |

## London TDD Cycle

```
/oss:red → /oss:green → /oss:refactor
```

| Command | Description |
|---------|-------------|
| `/oss:red` | Write failing test, design interfaces through mocks |
| `/oss:green` | Write minimal code to pass tests |
| `/oss:refactor` | Clean up while keeping tests green |
| `/oss:mock` | Generate type-safe mocks for collaborators |

## Design Commands (Outside-In)

| Command | Description |
|---------|-------------|
| `/oss:api-design` | Design API contracts before implementation |
| `/oss:acceptance` | Write acceptance tests at system boundaries |
| `/oss:adr` | Create Architecture Decision Records |
| `/oss:requirements` | Extract user stories and acceptance criteria |
| `/oss:data-model` | Design data schemas and relationships |

## Testing & Quality

| Command | Description |
|---------|-------------|
| `/oss:test` | Run E2E tests |
| `/oss:review` | Multi-perspective code review |
| `/oss:integration` | Validate mocked interactions work in reality |
| `/oss:contract` | Consumer-driven contract testing (Pact) |
| `/oss:tech-debt` | Identify and prioritize technical debt |
| `/oss:bench` | Performance benchmarking |
| `/oss:load` | Load testing at scale with k6 |
| `/oss:audit` | Security scanning |

## Deployment

| Command | Description |
|---------|-------------|
| `/oss:deploy` | Deploy (auto-detect environment) |
| `/oss:stage` | Deploy to staging |
| `/oss:release` | Deploy to production |

## Operations

| Command | Description |
|---------|-------------|
| `/oss:monitor` | Watch production health |
| `/oss:incident` | Incident response |
| `/oss:rollback` | Emergency rollback |
| `/oss:debug` | Systematic debugging workflow |
| `/oss:trace` | Distributed tracing analysis |
| `/oss:smoke` | Post-deployment smoke testing |
| `/oss:docs` | Generate documentation from code |

## Skills (On-Demand Knowledge)

The plugin includes specialized skills that provide deep expertise:

| Skill | Description |
|-------|-------------|
| `london-tdd` | London-style TDD methodology |
| `mocking-patterns` | ts-mockito, Jest, Vitest patterns |
| `typescript-strict` | TypeScript strict mode and type safety |
| `react-patterns` | Modern React hooks and components |
| `owasp-top10` | OWASP Top 10 security prevention |
| `rest-best-practices` | RESTful API design |

## Audio Notifications

Configure audio cues for hands-free development:

```bash
/oss-audio on       # Enable audio
/oss-audio off      # Disable audio
/oss-audio voice    # Use voice ("Ready", "Done")
/oss-audio sound    # Use system sounds
```

## Command Count

| Category | Commands |
|----------|----------|
| Core Workflow | 4 |
| London TDD | 4 |
| Design | 5 |
| Testing & Quality | 8 |
| Deployment | 3 |
| Operations | 7 |
| **Total** | **31** |

## Pricing

- **Free Trial**: 7 days unlimited
- **Pro**: $39/mo unlimited
- **Enterprise**: Custom pricing (contact us)

[View pricing](https://www.oneshotship.com/pricing)

## Support

- Website: [oneshotship.com](https://www.oneshotship.com)
- Email: hello@oneshotship.com

## License

Copyright (c) 2025 PixelGenie. All rights reserved.

This software and its architecture are proprietary. Unauthorized copying, modification, or distribution is prohibited.
