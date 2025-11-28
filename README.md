# One Shot Ship - Claude Code Plugin

**Your unfair advantage for shipping software.**

A complete development workflow plugin for Claude Code that transforms how you build software.

---

## Quick Start

### Step 1: Install the Plugin

Open your terminal and start Claude Code:

```bash
claude
```

Once inside Claude Code, run:

```
/plugin
```

Then:
1. Select **"Add marketplace"**
2. Enter: `501336North/one-shot-ship-plugin`
3. The interface will prompt you to install plugins - select **"oss"**
4. **Quit Claude Code** (type `exit` or press Ctrl+C)

### Step 2: Get Your API Key

1. Register at https://one-shot-ship.onrender.com (7-day free trial)
2. Copy your API key from the dashboard

### Step 3: Configure

```bash
mkdir -p ~/.oss
echo '{"apiKey": "YOUR_API_KEY_HERE"}' > ~/.oss/config.json
```

### Step 4: Start Building!

Launch a new Claude Code session:

```bash
claude
```

Then run your first command:

```
/oss:ideate "build a todo app"
```

---

## Available Commands

All commands use the `/oss:command-name` format.

### Development

| Command | Description |
|---------|-------------|
| `/oss:ideate "idea"` | Gather context, explore ideas, brainstorm |
| `/oss:plan "feature"` | Create implementation plans and dev docs |
| `/oss:build` | Execute your plan with TDD |
| `/oss:ship` | Quality check, commit, PR, merge |

### Testing

| Command | Description |
|---------|-------------|
| `/oss:test` | Run comprehensive E2E tests |
| `/oss:bench` | Performance benchmarks |
| `/oss:audit` | Security vulnerability scanning |

### Deployment

| Command | Description |
|---------|-------------|
| `/oss:stage` | Deploy to staging |
| `/oss:deploy` | Deploy to production |
| `/oss:release` | Full production release |

### Operations

| Command | Description |
|---------|-------------|
| `/oss:monitor` | Monitor production health |
| `/oss:incident` | Incident response protocol |
| `/oss:rollback` | Emergency rollback |

---

## Example Workflow

```bash
# 1. Start with an idea
/oss:ideate "build a user authentication system"

# 2. Create your plan
/oss:plan "JWT authentication with refresh tokens"

# 3. Build it with TDD
/oss:build

# 4. Test everything
/oss:test
/oss:audit

# 5. Deploy to staging first
/oss:stage

# 6. Then production
/oss:deploy

# 7. Monitor it
/oss:monitor
```

---

## Pricing

| Plan | Price | Features |
|------|-------|----------|
| **Free Trial** | 7 days | Unlimited commands |
| **Pro** | $39/mo | Unlimited commands, priority support |

Start your free trial at https://one-shot-ship.onrender.com

---

## Requirements

- [Claude Code](https://claude.ai/download) installed
- Node.js
- Active One Shot Ship subscription or trial

---

## Troubleshooting

### "Plugin not found"
Make sure you added the marketplace first via `/plugin` → "Add marketplace"

### "Unknown slash command"
Quit and restart Claude Code after installing the plugin

### "NO_CONFIG" or "NO_API_KEY"
Configure your API key in `~/.oss/config.json`

### "UNAUTHORIZED"
Your API key is invalid. Check `~/.oss/config.json` or get a new key from the dashboard.

### "FORBIDDEN"
Your subscription has expired. Renew at https://one-shot-ship.onrender.com/pricing

---

## Support

- Website: https://www.oneshotship.com
- Issues: https://github.com/501336North/one-shot-ship-plugin/issues

---

## License

Copyright © 2025 PixelGenie. All rights reserved.

This software and its architecture are proprietary. Unauthorized copying, modification, or distribution is prohibited.
