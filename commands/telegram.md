---
description: Manage Telegram notifications for OSS Dev Workflow
---

## Help

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
API_KEY=$(cat ~/.oss/config.json 2>/dev/null | jq -r '.apiKey // empty')
if [[ -z "$API_KEY" ]]; then
    echo "Not authenticated. Run: /oss:login"
    exit 1
fi
API_URL=$(cat ~/.oss/config.json 2>/dev/null | jq -r '.apiUrl // "https://api.oneshotship.com"')
```

### Step 1: Parse Arguments

```bash
SUBCOMMAND="${1:-status}"
case "$SUBCOMMAND" in
    link|on|off|unlink|status|--help|-h)
        ;;
    *)
        echo "Unknown subcommand: $SUBCOMMAND"
        echo "Usage: /oss:telegram [link|on|off|unlink|status]"
        exit 1
        ;;
esac
```

### Step 2: Handle Subcommands

#### status (default)

```bash
# Get current status from API
RESPONSE=$(curl -s --http1.1 -X GET "$API_URL/api/v1/telegram/status" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json")

LINKED=$(echo "$RESPONSE" | jq -r '.linked')
CHAT_ID=$(echo "$RESPONSE" | jq -r '.chatId // "N/A"')
NOTIFS_ENABLED=$(echo "$RESPONSE" | jq -r '.notificationsEnabled // false')

if [[ "$LINKED" == "true" ]]; then
    echo "Telegram Status"
    echo "==============="
    echo ""
    echo "✅ Account linked"
    echo "   Chat ID: $CHAT_ID"
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
# Generate magic link
RESPONSE=$(curl -s --http1.1 -X POST "$API_URL/api/v1/telegram/link" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json")

SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
if [[ "$SUCCESS" != "true" ]]; then
    echo "Error: $(echo "$RESPONSE" | jq -r '.error')"
    exit 1
fi

MAGIC_LINK=$(echo "$RESPONSE" | jq -r '.magicLink')
EXPIRES_AT=$(echo "$RESPONSE" | jq -r '.expiresAt')

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
    STATUS=$(curl -s --http1.1 -X GET "$API_URL/api/v1/telegram/status" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json")
    LINKED=$(echo "$STATUS" | jq -r '.linked')
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
# Enable notifications
RESPONSE=$(curl -s --http1.1 -X PATCH "$API_URL/api/v1/telegram/notifications" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"enabled": true}')

SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')

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
# Disable notifications
RESPONSE=$(curl -s --http1.1 -X PATCH "$API_URL/api/v1/telegram/notifications" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"enabled": false}')

echo "✅ Telegram notifications disabled"
echo ""
echo "You won't receive Telegram messages. Terminal notifications still work."
```

#### unlink

```bash
# Unlink account
RESPONSE=$(curl -s --http1.1 -X DELETE "$API_URL/api/v1/telegram/unlink" \
    -H "Authorization: Bearer $API_KEY" \
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
