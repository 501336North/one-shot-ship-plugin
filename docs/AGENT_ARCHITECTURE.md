# Agent Architecture & Quality Gate Integration

**Document:** Agent Inventory and CI/CD Quality Gate Mapping
**Date:** January 2026
**Status:** Reference Documentation

---

## Overview

This document inventories all 41 specialized agents available in the OSS Dev Workflow system and identifies which are optimally positioned to serve as automated quality gates in a modern software engineering team's CI/CD pipeline.

---

## Agent Inventory

### Complete Agent Catalog (41 Agents)

| Agent | Description | Category |
|-------|-------------|----------|
| `ai-engineer` | AI/ML Engineer specializing in LLM applications, RAG systems, prompt engineering, and AI infrastructure | AI/ML |
| `analytics-expert` | Web analytics specialist for GA4, GTM, Measurement Protocol, and privacy-compliant analytics | Analytics |
| `architecture-auditor` | Software architecture specialist for reviewing system design and architectural decisions | Quality Gate |
| `backend-architect` | Backend systems architect for API design, database architecture, microservices | Architecture |
| `cloud-architect` | Cloud infrastructure expert for AWS, GCP, Azure, serverless, and cloud-native development | Infrastructure |
| `code-reviewer` | Expert code reviewer for identifying bugs, security issues, and code quality improvements | Quality Gate |
| `data-engineer` | Data pipeline specialist for ETL, data warehousing, and streaming architectures | Data |
| `database-admin` | Database administration expert for optimization, migrations, replication, and maintenance | Database |
| `database-optimizer` | Database performance specialist for query optimization and indexing strategies | Performance |
| `debugger` | Expert debugger for investigating bugs, tracing issues, and root cause analysis | Development |
| `dependency-analyzer` | Dependency management specialist for analyzing dependencies and resolving conflicts | Quality Gate |
| `deployment-engineer` | Deployment and DevOps specialist for CI/CD pipelines and containerization | DevOps |
| `devops-troubleshooter` | DevOps troubleshooting expert for debugging production and infrastructure issues | Operations |
| `docs-architect` | Documentation specialist for creating technical documentation and API docs | Documentation |
| `flutter-expert` | Flutter and Dart specialist for cross-platform mobile development | Mobile |
| `frontend-developer` | Frontend development specialist for React, Vue, Angular, and modern frontend architectures | Frontend |
| `git-workflow-manager` | Git workflow specialist for branching strategies and merge conflict resolution | Version Control |
| `golang-pro` | Go language expert for Go development, concurrency patterns, and systems programming | Language |
| `graphql-architect` | GraphQL specialist for API design, schema design, and resolver implementation | API |
| `incident-responder` | Incident response specialist for production incidents and emergency response | Operations |
| `ios-developer` | iOS development specialist for Swift, SwiftUI, UIKit, and native iOS applications | Mobile |
| `java-pro` | Java expert for Java development, Spring Boot, and enterprise applications | Language |
| `ml-engineer` | Machine learning engineer for ML model development and MLOps | AI/ML |
| `mobile-developer` | Mobile development specialist for iOS, Android, and cross-platform development | Mobile |
| `n8n-automation-specialist` | n8n workflow automation expert for creating and debugging n8n workflows | Automation |
| `nextjs-developer` | Next.js specialist for server components and full-stack React development | Frontend |
| `performance-auditor` | Performance audit specialist for identifying bottlenecks and optimization opportunities | Quality Gate |
| `performance-engineer` | Performance engineering specialist for optimization, profiling, and tuning | Performance |
| `python-pro` | Python expert for Python development, data science, and backend applications | Language |
| `qa-expert` | Quality assurance specialist for test strategy, automation, and quality processes | Quality Gate |
| `react-specialist` | React expert for component architecture and state management | Frontend |
| `refactoring-specialist` | Refactoring expert for design pattern implementation and code modernization | Development |
| `release-manager` | Release management specialist for release planning and deployment coordination | DevOps |
| `security-auditor` | Security specialist for audits, vulnerability assessment, and secure coding | Quality Gate |
| `seo-aeo-expert` | SEO/AEO specialist for search optimization, schema markup, and Core Web Vitals | Frontend |
| `sre-engineer` | Site Reliability Engineer for reliability, scalability, and observability | Operations |
| `swift-macos-expert` | Swift and macOS specialist for Apple platform development | Apple |
| `test-automator` | Test automation specialist for testing frameworks and CI integration | Quality Gate |
| `test-engineer` | Testing specialist for test design, implementation, and TDD | Quality Gate |
| `typescript-pro` | TypeScript expert for type system design and type-safe code | Language |
| `visionos-developer` | VisionOS/Apple Vision Pro developer with RAG-powered Apple documentation | Apple |

---

## Quality Gate Agents

These agents are specifically designed to serve as automated quality gates in CI/CD pipelines. Each can be invoked as part of a pull request check, pre-merge validation, or deployment gate.

### Primary Quality Gate Matrix

| Gate | Agent | Trigger Point | Blocks Merge If |
|------|-------|---------------|-----------------|
| **Code Quality** | `code-reviewer` | PR opened/updated | Critical issues found |
| **Security** | `security-auditor` | PR opened, pre-deploy | Vulnerabilities detected |
| **Testing** | `test-engineer` | PR opened | Test coverage drops |
| **Test Automation** | `test-automator` | PR merged to main | CI tests fail |
| **Architecture** | `architecture-auditor` | PR with structural changes | Anti-patterns detected |
| **Performance** | `performance-auditor` | PR with performance-critical code | Regression detected |
| **Dependencies** | `dependency-analyzer` | Weekly, PR with package changes | Vulnerable deps found |
| **QA Process** | `qa-expert` | Pre-release | Quality criteria not met |

### Detailed Gate Specifications

#### Gate 1: Code Review (`code-reviewer`)

**Purpose:** Automated first-pass code review before human review

**Invocation:**
```bash
# Via Task tool
subagent_type: "oss:code-reviewer"
prompt: "Review the changes in this PR for bugs, code smells, and improvements"
```

**Checks Performed:**
- Logic errors and potential bugs
- Code duplication
- Naming conventions
- Error handling completeness
- Code complexity (cyclomatic)
- SOLID principles adherence

**Integration Point:** GitHub Actions on `pull_request` event

---

#### Gate 2: Security Audit (`security-auditor`)

**Purpose:** Identify security vulnerabilities before they reach production

**Invocation:**
```bash
subagent_type: "oss:security-auditor"
prompt: "Audit these changes for OWASP Top 10 vulnerabilities"
```

**Checks Performed:**
- SQL injection vectors
- XSS vulnerabilities
- Authentication/authorization issues
- Sensitive data exposure
- Security misconfigurations
- Insecure dependencies

**Integration Point:** Required check before merge to `main`

---

#### Gate 3: Test Design (`test-engineer`)

**Purpose:** Ensure proper test coverage and TDD compliance

**Invocation:**
```bash
subagent_type: "oss:test-engineer"
prompt: "Verify test coverage for new code and suggest missing test cases"
```

**Checks Performed:**
- Test coverage thresholds
- Edge case coverage
- Mock appropriateness (London TDD)
- Test isolation
- Assertion quality

**Integration Point:** PR opened, blocks if coverage drops

---

#### Gate 4: Architecture Review (`architecture-auditor`)

**Purpose:** Catch architectural anti-patterns early

**Invocation:**
```bash
subagent_type: "oss:architecture-auditor"
prompt: "Review architectural impact of these changes"
```

**Checks Performed:**
- Dependency direction violations
- Layer boundary crossings
- Coupling analysis
- Interface segregation
- Single responsibility adherence

**Integration Point:** PRs touching 5+ files or core modules

---

#### Gate 5: Performance Audit (`performance-auditor`)

**Purpose:** Prevent performance regressions

**Invocation:**
```bash
subagent_type: "oss:performance-auditor"
prompt: "Identify potential performance bottlenecks in these changes"
```

**Checks Performed:**
- N+1 query patterns
- Memory leak potential
- Blocking I/O in async contexts
- Unnecessary re-renders (frontend)
- Cache invalidation issues

**Integration Point:** PRs with database or API changes

---

#### Gate 6: Dependency Health (`dependency-analyzer`)

**Purpose:** Maintain healthy dependency tree

**Invocation:**
```bash
subagent_type: "oss:dependency-analyzer"
prompt: "Analyze dependency changes for security and compatibility"
```

**Checks Performed:**
- Known vulnerabilities (CVE)
- License compatibility
- Dependency freshness
- Circular dependencies
- Bundle size impact

**Integration Point:** Weekly scheduled + PRs with package.json changes

---

## CI/CD Pipeline Integration

### Recommended Pipeline Structure

```yaml
# .github/workflows/quality-gates.yml
name: Quality Gates

on:
  pull_request:
    branches: [main]

jobs:
  # Stage 1: Fast checks (parallel)
  lint-and-type:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck

  # Stage 2: Agent-powered gates (parallel)
  code-review:
    needs: lint-and-type
    runs-on: ubuntu-latest
    steps:
      - name: AI Code Review
        uses: oss-dev-workflow/code-reviewer-action@v1
        with:
          agent: code-reviewer
          severity-threshold: warning

  security-audit:
    needs: lint-and-type
    runs-on: ubuntu-latest
    steps:
      - name: Security Audit
        uses: oss-dev-workflow/security-auditor-action@v1
        with:
          agent: security-auditor
          fail-on: critical

  # Stage 3: Testing
  unit-tests:
    needs: [code-review, security-audit]
    runs-on: ubuntu-latest
    steps:
      - run: npm test -- --coverage
      - name: Coverage Check
        uses: oss-dev-workflow/test-engineer-action@v1
        with:
          agent: test-engineer
          min-coverage: 80

  # Stage 4: Architecture (conditional)
  architecture-review:
    needs: unit-tests
    if: contains(github.event.pull_request.labels.*.name, 'architecture')
    runs-on: ubuntu-latest
    steps:
      - name: Architecture Review
        uses: oss-dev-workflow/architecture-auditor-action@v1
```

### Gate Severity Levels

| Level | Action | Example |
|-------|--------|---------|
| `critical` | Block merge | SQL injection, auth bypass |
| `high` | Block merge | XSS, missing auth check |
| `warning` | Require acknowledgment | Code smell, missing test |
| `info` | Report only | Style suggestion |

---

## Agent Categories by Function

### Development Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT LIFECYCLE                         │
└─────────────────────────────────────────────────────────────────────┘

DESIGN              BUILD               TEST                DEPLOY
┌─────────┐        ┌─────────┐        ┌─────────┐        ┌─────────┐
│backend- │        │debugger │        │test-    │        │deploy-  │
│architect│        │         │        │engineer │        │ment-    │
├─────────┤        ├─────────┤        ├─────────┤        │engineer │
│architec-│        │refactor-│        │test-    │        ├─────────┤
│ture-    │        │ing-     │        │automator│        │release- │
│auditor  │        │specialis│        ├─────────┤        │manager  │
├─────────┤        ├─────────┤        │qa-expert│        ├─────────┤
│graphql- │        │code-    │        └─────────┘        │sre-     │
│architect│        │reviewer │                           │engineer │
└─────────┘        └─────────┘                           └─────────┘
```

### Language Specialists

| Language | Agent | Specialization |
|----------|-------|----------------|
| TypeScript/JavaScript | `typescript-pro` | Type system, modern JS |
| Python | `python-pro` | Data science, backend |
| Go | `golang-pro` | Concurrency, systems |
| Java | `java-pro` | Spring Boot, enterprise |
| Swift | `swift-macos-expert` | Apple platforms |
| Dart | `flutter-expert` | Cross-platform mobile |

### Platform Specialists

| Platform | Agent | Specialization |
|----------|-------|----------------|
| iOS | `ios-developer` | UIKit, SwiftUI |
| visionOS | `visionos-developer` | Spatial computing, RealityKit |
| macOS | `swift-macos-expert` | Desktop apps |
| Mobile (cross-platform) | `mobile-developer` | React Native, Flutter |
| Web Frontend | `frontend-developer`, `nextjs-developer`, `react-specialist` | Modern web |
| Cloud | `cloud-architect` | AWS, GCP, Azure |

### Infrastructure & Ops

| Function | Agent | Specialization |
|----------|-------|----------------|
| CI/CD | `deployment-engineer` | Pipelines, containers |
| Database | `database-admin`, `database-optimizer` | Performance, migrations |
| Reliability | `sre-engineer` | Observability, SLOs |
| Incidents | `incident-responder`, `devops-troubleshooter` | Emergency response |
| Data | `data-engineer` | ETL, warehousing |

---

## Model Routing Configuration

All agents support custom model routing for cost optimization:

```json
{
  "models": {
    "agents": {
      "oss:code-reviewer": "ollama/codellama",
      "oss:test-engineer": "claude",
      "oss:security-auditor": "claude",
      "oss:architecture-auditor": "openrouter/anthropic/claude-3-opus"
    }
  }
}
```

**Recommended Model Assignment:**

| Gate Criticality | Recommended Model | Reason |
|-----------------|-------------------|--------|
| Security-critical | Claude Opus/Sonnet | Highest accuracy needed |
| Code review | Local LLM (Ollama) | High volume, fast feedback |
| Architecture | Claude Opus | Complex reasoning required |
| Test coverage | Claude Sonnet | Balance of speed/accuracy |

---

## Shared Infrastructure

### `_shared/model-routing.md`

All agents include the model routing pre-check from `_shared/model-routing.md`:

1. Check for custom model configuration
2. If configured, route through model proxy
3. If not, use native Claude Code execution

This enables:
- Cost optimization via local models for high-volume gates
- Quality preservation via premium models for critical gates
- Flexibility to adjust per-project or per-team

---

## Summary

### Quality Gate Agent Shortlist

For a modern CI/CD pipeline, these 8 agents form the core quality gates:

1. **`code-reviewer`** - First-pass code quality
2. **`security-auditor`** - Security vulnerabilities
3. **`test-engineer`** - Test coverage & design
4. **`test-automator`** - CI test infrastructure
5. **`architecture-auditor`** - Architectural integrity
6. **`performance-auditor`** - Performance regression
7. **`dependency-analyzer`** - Dependency health
8. **`qa-expert`** - Release readiness

### Total Agent Count

- **41 specialized agents** covering:
  - 8 quality gate roles
  - 5 language specialists
  - 6 platform specialists
  - 7 infrastructure/ops roles
  - 15 specialized development roles

---

*Document Version: 1.0*
*Last Updated: January 2026*
