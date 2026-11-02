# One Shot Ship - Claude Code Plugin

World-class development workflows for Claude Code. Ship software with confidence using London-style TDD.

## Installation

```bash
# In Claude Code
/plugin marketplace add 501336north/one-shot-ship-plugin
/plugin install oss@one-shot-ship-plugin
```

## Getting Started

1. **Register** at [oneshotship.com](https://www.oneshotship.com)
2. **Login** in Claude Code: `/oss:login`
3. **Start building**: `/oss:ideate "your idea"` — or `/oss:auto "your idea"` to run the whole pipeline in one go

## Does my code leave my machine?

Your code does not. OSS runs on the **BYOCCA model** (Bring Your Own Claude Code Account): you keep your own
Claude Code subscription, execution stays local, and OSS serves the workflow layer without ever
proxying your code to the model itself.

One thing does leave by default: your **picker answers**. When you answer a question in the picker,
the question, its options, your pick and any note you add are sent to your OSS account to build your
team's decision record. They are redacted (secrets and tokens removed) and capped in length, and they
are never code. Answers given outside a feature stay in your repo, and only answers you gave on this
machine are sent, under your own account. Anyone can turn this off for themselves on this machine with
`/oss:settings decisions off` (back on with `on`; `status` shows both your setting and your team's).
Off is also kept in its own file, `~/.oss/decisions-push-off`, so no other tool saving your settings can switch it back on.
When a team owner or admin runs it, it also turns the push off for the whole team.
Answers given while the push is off are never sent, not even after it is turned back on. Turning the
team push off also withholds every answer still waiting to be sent, including ones given earlier while
it was on; they are never sent. Answers waiting to be sent are only ever stored under the account that
gave them: they still go after you get a new key for that account. If you log in as someone else, they are
sent to OSS under the new account and refused there: they are never stored under that account, and they
are not sent again. If `~/.oss/settings.json` cannot be read
as one JSON object, the push stays off on this machine until it can (`status` says so).

Full system reference: [ARCHITECTURE.md](ARCHITECTURE.md).

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
| `/oss:auto` | Full pipeline (ideate → plan → build → ship) in one session |

### One-shot shortcut

Use `/oss:auto "your idea"` to run all four phases in a single session. It pauses only
for interactive ideation Q&A, then drives plan → build → ship on its own. Best for
well-scoped features. Use the four-command flow when you want explicit checkpoints
between phases.

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

## What ships in the plugin

The tables above cover the commonly used commands. Full inventory:

| | Count | Source |
|---|---|---|
| Workflow commands | 68 | [`commands/`](commands/) |
| Specialized agents | 44 | [`agents/`](agents/) |
| On-demand skills | 57 | [`skills/`](skills/) |

## Pricing

Free trial, then per-seat monthly. Current tiers and terms live on
**[oneshotship.com/pricing](https://www.oneshotship.com/pricing)** — the single source of truth,
so this README can't drift out of date against it.

## Support

- Website: [oneshotship.com](https://www.oneshotship.com)
- Email: hello@oneshotship.com

## License

Copyright (c) 2025 PixelGenie. All rights reserved.

This software and its architecture are proprietary. Unauthorized copying, modification, or distribution is prohibited.
