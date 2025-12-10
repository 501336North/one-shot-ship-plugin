# OSS Dev Workflow - System Architecture

> **Reference Document** - Comprehensive architecture overview for OSS Dev Workflow

---

## System Overview

OSS Dev Workflow follows the **BYOCCA Model** (Bring Your Own Claude Code Account):
- User pays Anthropic for Claude Code ($20/mo)
- User pays OSS for workflow prompts (subscription)
- OSS never touches the LLM directly - all execution is local
- IP (prompts) stays on server, only fetched per-request

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER'S LOCAL MACHINE                                 │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      CLAUDE CODE (Anthropic)                          │   │
│  │                                                                        │   │
│  │   ┌────────────────────────────────────────────────────────────────┐  │   │
│  │   │              OSS PLUGIN (~/.claude/plugins/cache/oss/)         │  │   │
│  │   │                                                                  │  │   │
│  │   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │  │   │
│  │   │  │ commands/   │  │ hooks/      │  │ watcher/                │ │  │   │
│  │   │  │             │  │             │  │                         │ │  │   │
│  │   │  │ ideate.md   │  │ precommand  │  │ Supervisor Agent        │ │  │   │
│  │   │  │ plan.md     │  │ iron-law    │  │ - Queue system          │ │  │   │
│  │   │  │ build.md    │  │ archive     │  │ - Log parser            │ │  │   │
│  │   │  │ ship.md     │  │ notify      │  │ - Health monitor        │ │  │   │
│  │   │  │ ...         │  │ log         │  │ - Anomaly detection     │ │  │   │
│  │   │  └─────────────┘  │ session     │  └─────────────────────────┘ │  │   │
│  │   │                   └─────────────┘                               │  │   │
│  │   └────────────────────────────────────────────────────────────────┘  │   │
│  │                              │                                         │   │
│  │                              ▼                                         │   │
│  │   ┌────────────────────────────────────────────────────────────────┐  │   │
│  │   │                    CLAUDE AGENT (LLM)                          │  │   │
│  │   │                                                                  │  │   │
│  │   │  • Executes slash commands (/oss:plan, /oss:build, etc.)       │  │   │
│  │   │  • Spawns specialized sub-agents (Task tool)                   │  │   │
│  │   │  • Has full filesystem access                                   │  │   │
│  │   │  • Enforces IRON LAWS                                          │  │   │
│  │   └────────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────────┐    │
│  │ ~/.oss/          │  │ dev/active/      │  │ SwiftBar Menu          │    │
│  │                  │  │                  │  │                        │    │
│  │ config.json      │  │ {feature}/       │  │ Workflow status        │    │
│  │ logs/            │  │   PLAN.md        │  │ Health check           │    │
│  │ queue.json       │  │   PROGRESS.md    │  │ Command logs           │    │
│  │ current-project  │  │   DESIGN.md      │  │                        │    │
│  └──────────────────┘  └──────────────────┘  └────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      USER'S CODEBASE                                  │   │
│  │                                                                        │   │
│  │  • Full filesystem access via Claude Code                             │   │
│  │  • Git operations (feature branches, PRs)                             │   │
│  │  • Test execution (npm test)                                          │   │
│  │  • Build tools                                                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTPS (WebFetch)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OSS CLOUD INFRASTRUCTURE                             │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    API SERVER (Render)                                │   │
│  │                    one-shot-ship-api.onrender.com                     │   │
│  │                                                                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ /auth       │  │ /prompts    │  │ /subscription│ │ /admin      │  │   │
│  │  │             │  │             │  │              │  │             │  │   │
│  │  │ register    │  │ workflows/* │  │ status       │  │ trials      │  │   │
│  │  │ login       │  │ shared/*    │  │ checkout     │  │ sharing     │  │   │
│  │  │ verify      │  │ iron-laws   │  │ webhook      │  │ upgrade     │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                              │                                               │
│                              ▼                                               │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    DATABASE (Supabase/PostgreSQL)                     │   │
│  │                                                                        │   │
│  │  Users | ApiKeys | ApiKeyDevices | Subscriptions | UsageEvents        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    WEB DASHBOARD (Vercel)                             │   │
│  │                    www.oneshotship.com                                │   │
│  │                                                                        │   │
│  │  Landing | Pricing | Login | Dashboard | Docs                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SERVICES                                    │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐│
│  │ Stripe      │  │ GitHub      │  │ Telegram    │  │ Anthropic API       ││
│  │             │  │             │  │             │  │                     ││
│  │ Payments    │  │ OAuth       │  │ Admin       │  │ Claude (via user's  ││
│  │ Webhooks    │  │ Repo access │  │ Alerts      │  │ Claude Code sub)    ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Interaction Flows

| Flow | Systems Involved |
|------|------------------|
| **Command Execution** | User → Claude Code → Plugin → API (fetch prompt) → Agent executes |
| **Authentication** | Plugin → API → Database → returns API key |
| **Subscription Check** | Plugin → API → Stripe → allow/deny |
| **Notifications** | Agent → Plugin hooks → SwiftBar/terminal-notifier |
| **Supervisor Monitoring** | Watcher → Log files → Queue → Anomaly detection → Intervention |
| **Git Operations** | Agent → local git → GitHub API (gh cli) |

---

## Component Details

### Plugin Directory Structure

```
~/.claude/plugins/cache/oss/
├── commands/           # Slash command definitions
│   ├── ideate.md      # /oss:ideate - Transform ideas into designs
│   ├── plan.md        # /oss:plan - Create TDD implementation plans
│   ├── build.md       # /oss:build - Execute with strict TDD
│   ├── ship.md        # /oss:ship - Quality check, commit, PR, merge
│   └── ...            # 30+ workflow commands
│
├── hooks/              # Claude Code lifecycle hooks
│   ├── oss-precommand.sh    # Runs before /oss:* commands
│   ├── oss-iron-law-check.sh # IRON LAW enforcement
│   ├── oss-archive-check.sh  # Auto-archive completed features
│   ├── oss-notify.sh         # Desktop notifications
│   ├── oss-log.sh            # Command logging
│   ├── oss-session-start.sh  # Session initialization
│   └── oss-session-end.sh    # Session cleanup
│
├── watcher/            # Supervisor agent (Node.js)
│   ├── src/
│   │   ├── services/
│   │   │   ├── log-parser.ts       # Parse Claude Code output
│   │   │   ├── notification-copy.ts # Nautical-themed messages
│   │   │   └── menubar.ts          # SwiftBar state management
│   │   └── cli/
│   │       ├── get-copy.js         # Get notification copy
│   │       └── update-menubar.js   # Update SwiftBar state
│   └── dist/                       # Compiled output
│
└── swiftbar/           # macOS menu bar integration
    └── oss-workflow.1s.sh  # SwiftBar plugin script
```

### Local State Files

```
~/.oss/
├── config.json         # API key, user settings
├── current-project     # Active project path
├── queue.json          # Task queue for supervisor
└── logs/
    └── current-session/
        ├── ideate.log
        ├── plan.log
        ├── build.log
        ├── ship.log
        └── health-check.log
```

### Dev Docs Structure (Per Feature)

```
dev/active/{feature}/
├── PLAN.md            # TDD implementation plan
├── PROGRESS.md        # Task completion tracking
├── DESIGN.md          # Approved design from ideate
├── TESTING.md         # Test strategy & results
├── DECISIONS.md       # Technical decisions (ADRs)
└── NOTES.md           # Implementation notes
```

---

## API Endpoints

### Authentication (`/api/v1/auth`)
- `POST /register` - Create account, start trial
- `POST /login` - Get API key
- `GET /verify` - Validate API key

### Prompts (`/api/v1/prompts`)
- `GET /workflows/{command}` - Fetch workflow prompt
- `GET /shared/iron-laws` - Fetch IRON LAWS

### Subscription (`/api/v1/subscription`)
- `GET /status` - Check subscription status
- `POST /checkout` - Create Stripe checkout session
- `POST /webhook` - Handle Stripe webhooks

### Admin (`/api/v1/admin`)
- `GET /trials` - List expiring trials
- `GET /sharing` - Detect API key sharing
- `POST /upgrade` - Manual subscription upgrade

---

## Database Schema

```
Users
├── id (uuid)
├── email
├── passwordHash
├── plan (trial|pro|team|enterprise)
├── trialEndsAt
└── createdAt

ApiKeys
├── id (uuid)
├── userId (FK)
├── key (hashed)
├── isActive
├── lastUsedAt
└── expiresAt

ApiKeyDevices (sharing detection)
├── id (uuid)
├── apiKeyId (FK)
├── fingerprint
├── userAgent
├── ipAddress
└── lastSeenAt

Subscriptions
├── id (uuid)
├── userId (FK)
├── stripeCustomerId
├── stripeSubscriptionId
├── status
└── currentPeriodEnd

UsageEvents
├── id (uuid)
├── userId (FK)
├── command
├── timestamp
└── metadata (json)
```

---

## Security Model

### API Key Authentication
- Keys stored hashed (bcrypt)
- Bearer token in Authorization header
- Expiration support
- Last-used tracking

### Sharing Detection
- Device fingerprinting
- IP address tracking
- User agent analysis
- Alert on suspicious patterns

### IRON LAW Enforcement
- Pre-command hook validation
- Branch protection (no main)
- TDD compliance checks
- Type safety validation

---

## Notification System

### Channels
1. **terminal-notifier** - macOS native notifications
2. **SwiftBar** - Menu bar status display
3. **Telegram** - Admin alerts (optional)

### Message Types
- Session lifecycle (start/end)
- Workflow progress (task completion)
- Quality alerts (test failures)
- Supervisor interventions (anomalies)

### Copy Service
Nautical-themed messaging:
- "Charting Course" (context restored)
- "Raising Sails" (build start)
- "Land Ho!" (ship complete)
- "Man Overboard!" (build failure)

---

## Health Check Validations

The health check system validates:

1. **Test Execution** (`npm test`)
   - Pass/fail count
   - Failing test names (up to 5)
   - Duration

2. **Error Detection**
   - TypeScript compilation errors
   - SyntaxError detection
   - Missing modules

3. **IRON LAW Compliance**
   - LAW #4: On feature branch (not main)
   - LAW #1: No `.skip()`/`.todo()`/`.only()` in tests
   - LAW #2: No `any` types in staged files
   - LAW #6: Dev docs structure exists

---

## Deployment

| Component | Platform | URL |
|-----------|----------|-----|
| API Server | Render | one-shot-ship-api.onrender.com |
| Web Dashboard | Vercel | www.oneshotship.com |
| Database | Supabase | (managed PostgreSQL) |
| Plugin | npm registry | `oss` package |

---

*Last Updated: 2025-12-09*
