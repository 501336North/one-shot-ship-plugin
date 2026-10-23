---
description: Manage Telegram notifications for OSS Dev Workflow
model: haiku
---

## Help

> Iron Laws are loaded from CLAUDE.md at session start. No per-command fetch needed.

**Command:** `/oss:telegram`

**Description:** Link your Telegram account to receive notifications when Claude needs your input.

**Workflow Position:** any time - **TELEGRAM** notifications

**Usage:**
```bash
/oss:telegram [SUBCOMMAND]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `SUBCOMMAND` | No | link, on, off, unlink, status (default: status) |

**Options:**
| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show this help message |

**Examples:**
```bash
# Show linking status
/oss:telegram

# Link your Telegram account (shows magic link)
/oss:telegram link

# Enable notifications (after linking)
/oss:telegram on

# Disable notifications
/oss:telegram off

# Unlink your Telegram account
/oss:telegram unlink
```

**Related Commands:**
- `/oss:settings` - General notification settings
- `/oss:login` - Configure API key

---

# /oss:telegram - Telegram Notifications

Receive notifications on your phone when Claude Code needs your input. Answer questions from Telegram or from your terminal - whichever comes first.

## How It Works

1. **Link your account** - Click a magic link to connect @OSSDevWorkflowBot
2. **Receive questions** - When Claude asks you something, get a Telegram message
3. **Answer anywhere** - Reply via Telegram buttons OR from your terminal
4. **First response wins** - No duplicate answers, no timeouts

## Implementation

### Step 0: Check Authentication

```bash
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)
if [[ -z "$API_KEY" ]]; then
    echo "Not authenticated. Run: /oss:login"
    exit 1
fi
oss_api_url >/dev/null || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
```

### Step 1: Parse Arguments

The subcommand is the user's argument (`status` when none is given). It is only used to pick the block below to run; it never goes into a command. For `--help` or `-h`, show the Help section above and stop. For anything other than `link`, `on`, `off`, `unlink` or `status`, tell the user "Unknown subcommand: <what they typed>" and "Usage: /oss:telegram [link|on|off|unlink|status]", and stop.

Each block below reads the API key and URL from `~/.oss/config.json` itself.

### Step 2: Handle Subcommands

#### status (default)

```bash
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)
API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
# Get current status from API
RESPONSE=$(oss_api_curl "$API_KEY" -s --http1.1 -X GET "$API_URL/api/v1/telegram/status" \
    -H "Content-Type: application/json")

LINKED=$(printf '%s' "$RESPONSE" | oss_json_field linked)
CHAT_ID=$(printf '%s' "$RESPONSE" | oss_json_field chatId)
NOTIFS_ENABLED=$(printf '%s' "$RESPONSE" | oss_json_field notificationsEnabled)

if [[ "$LINKED" == "true" ]]; then
    echo "Telegram Status"
    echo "==============="
    echo ""
    echo "✅ Account linked"
    echo "   Chat ID: ${CHAT_ID:-N/A}"
    echo "   Notifications: $([ "$NOTIFS_ENABLED" == "true" ] && echo "ON" || echo "OFF")"
    echo ""
    echo "Commands:"
    echo "  /oss:telegram on      Enable notifications"
    echo "  /oss:telegram off     Disable notifications"
    echo "  /oss:telegram unlink  Remove Telegram link"
else
    echo "Telegram Status"
    echo "==============="
    echo ""
    echo "❌ Not linked"
    echo ""
    echo "To link your Telegram account:"
    echo "  /oss:telegram link"
fi
```

#### link

```bash
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)
API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
# Generate magic link
RESPONSE=$(oss_api_curl "$API_KEY" -s --http1.1 -X POST "$API_URL/api/v1/telegram/link" \
    -H "Content-Type: application/json")

SUCCESS=$(printf '%s' "$RESPONSE" | oss_json_field success)
if [[ "$SUCCESS" != "true" ]]; then
    echo "Error: $(printf '%s' "$RESPONSE" | oss_json_field error)"
    exit 1
fi

MAGIC_LINK=$(printf '%s' "$RESPONSE" | oss_json_field magicLink)
EXPIRES_AT=$(printf '%s' "$RESPONSE" | oss_json_field expiresAt)

echo "Link Your Telegram Account"
echo "=========================="
echo ""
echo "1. Click this link on your phone:"
echo ""
echo "   $MAGIC_LINK"
echo ""
echo "2. Press START in Telegram"
echo ""
echo "⏱️  Link expires in 5 minutes"
echo ""
echo "Waiting for confirmation..."

# Poll for linking completion (max 5 minutes)
for i in {1..60}; do
    sleep 5
    STATUS=$(oss_api_curl "$API_KEY" -s --http1.1 -X GET "$API_URL/api/v1/telegram/status" \
        -H "Content-Type: application/json")
    LINKED=$(printf '%s' "$STATUS" | oss_json_field linked)
    if [[ "$LINKED" == "true" ]]; then
        echo ""
        echo "✅ Telegram linked successfully!"
        echo ""
        echo "You'll now receive notifications when Claude needs your input."
        echo "Toggle with: /oss:telegram on|off"
        exit 0
    fi
done

echo ""
echo "⏱️  Link expired. Run /oss:telegram link to try again."
```

#### on

```bash
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)
API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
# Enable notifications
RESPONSE=$(oss_api_curl "$API_KEY" -s --http1.1 -X PATCH "$API_URL/api/v1/telegram/notifications" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}')

SUCCESS=$(printf '%s' "$RESPONSE" | oss_json_field success)
ERROR=$(printf '%s' "$RESPONSE" | oss_json_field error)

if [[ -n "$ERROR" ]]; then
    echo "Error: $ERROR"
    echo ""
    echo "Link your account first: /oss:telegram link"
    exit 1
fi

echo "✅ Telegram notifications enabled"
echo ""
echo "You'll receive messages when Claude needs your input."
```

#### off

```bash
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)
API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
# Disable notifications
RESPONSE=$(oss_api_curl "$API_KEY" -s --http1.1 -X PATCH "$API_URL/api/v1/telegram/notifications" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}')

echo "✅ Telegram notifications disabled"
echo ""
echo "You won't receive Telegram messages. Terminal notifications still work."
```

#### unlink

```bash
source ~/.oss/hooks/oss-api-curl.sh  # oss_api_key + oss_api_url + oss_api_curl (key via stdin, never argv)
API_KEY=$(oss_api_key)
API_URL=$(oss_api_url) || { echo "apiUrl in your OSS config must be an https URL (plain http only for localhost) with no user@, query or fragment"; exit 1; }
# Unlink account
RESPONSE=$(oss_api_curl "$API_KEY" -s --http1.1 -X DELETE "$API_URL/api/v1/telegram/unlink" \
    -H "Content-Type: application/json")

echo "✅ Telegram account unlinked"
echo ""
echo "To re-link: /oss:telegram link"
```

## Security

- **No bot token needed** - You use our shared @OSSDevWorkflowBot
- **Magic link expires** - 5-minute window prevents unauthorized linking
- **Chat ID verified** - Only your Telegram account receives your messages
- **First response wins** - Answer from Telegram or terminal, both work

## Troubleshooting

### "Not linked" after clicking link

1. Make sure you pressed START in Telegram
2. The link may have expired - run `/oss:telegram link` again
3. Check your internet connection

### Not receiving messages

1. Check status: `/oss:telegram`
2. Make sure notifications are ON
3. Check Telegram notification settings on your phone
4. Ensure the OSS bot isn't muted

### "Telegram is not linked" error in /oss:settings

Run `/oss:telegram link` first, then select Telegram in settings.
