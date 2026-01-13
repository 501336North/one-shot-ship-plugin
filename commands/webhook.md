---
description: Configure GitHub webhook for PR review notifications
---

# /oss:webhook - GitHub Webhook Configuration

Receive notifications when GitHub PR reviews are submitted, enabling real-time response to review feedback.

## Usage

```bash
/oss:webhook              # Show current status
/oss:webhook setup        # Generate secret and configure
/oss:webhook on           # Enable webhook server
/oss:webhook off          # Disable webhook server
```

## How It Works

1. A local HTTP server listens for GitHub webhooks
2. GitHub sends `pull_request_review` events when reviewers comment
3. You receive notifications about review feedback
4. Optionally use cloudflared tunnel for public exposure

## Setup Instructions

### Step 1: Generate Webhook Secret

Run the setup command to generate a cryptographically secure secret:

```bash
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/webhook-setup.js" setup
```

This will:
- Generate a 64-character hex secret
- Save configuration to `~/.oss/config.json`
- Display the webhook URL and secret for GitHub

**Output:**
```
Webhook Configuration
=====================

Secret: a1b2c3d4e5f6... (64 characters)
Port:   3456

Webhook URL Options:
  Local:  http://localhost:3456/webhook
  Tunnel: Run cloudflared (see Step 3)

Next Steps:
1. Copy the secret above
2. Add webhook to GitHub repository settings
3. (Optional) Start cloudflared tunnel for public URL
```

### Step 2: Add Webhook to GitHub

1. Go to your repository on GitHub
2. Navigate to **Settings** > **Webhooks** > **Add webhook**
3. Configure the webhook:
   - **Payload URL**: Your webhook URL (see Step 3 for public URL)
   - **Content type**: `application/json`
   - **Secret**: Paste the secret from Step 1
   - **Events**: Select **Let me select individual events** > check **Pull request reviews**
4. Click **Add webhook**

### Step 3: Expose Webhook (Optional)

For GitHub to reach your local server, you need a public URL. Use cloudflared:

```bash
# Install cloudflared (macOS)
brew install cloudflared

# Start tunnel (in separate terminal)
cloudflared tunnel --url http://localhost:3456
```

Cloudflared will output a public URL like:
```
https://random-words-here.trycloudflare.com
```

Use this URL in GitHub:
```
https://random-words-here.trycloudflare.com/webhook
```

### Step 4: Start Webhook Server

Enable the webhook server:

```bash
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/webhook-toggle.js" on
```

The server will start listening on the configured port.

## Configuration File

Settings are stored in `~/.oss/config.json`:

```json
{
  "webhook": {
    "enabled": true,
    "port": 3456,
    "secret": "64-character-hex-secret..."
  }
}
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | POST | Receives GitHub webhook events |
| `/health` | GET | Health check (returns `{"status":"ok"}`) |

## Security Features

- **HMAC-SHA256 Signature Validation**: All requests are verified using the webhook secret
- **Timing-Safe Comparison**: Prevents timing attacks on signature validation
- **Rate Limiting**: Default 10 requests per minute to prevent abuse
- **Event Filtering**: Only `pull_request_review` events are processed

## Rate Limiting

Default limits:
- **10 requests per minute** per webhook endpoint
- **No limit** on health check endpoint

Requests exceeding the limit receive HTTP 429 response.

## Troubleshooting

### "Invalid signature" Error (HTTP 401)

1. Verify the secret in GitHub matches `~/.oss/config.json`
2. Ensure Content-Type is set to `application/json` in GitHub
3. Regenerate secret if needed:
   ```bash
   rm ~/.oss/config.json  # Remove old config
   node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/webhook-setup.js" setup
   ```

### "Connection refused" Error

1. Ensure webhook server is running:
   ```bash
   node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/webhook-toggle.js" on
   ```
2. Check the port is not in use:
   ```bash
   lsof -i :3456
   ```

### GitHub Shows "Failed to deliver"

1. Verify cloudflared tunnel is running
2. Check the public URL is correct in GitHub settings
3. Test health endpoint:
   ```bash
   curl https://your-tunnel-url.trycloudflare.com/health
   ```

### Rate Limited (HTTP 429)

If receiving many webhooks in quick succession:
- Wait 60 seconds for rate limit to reset
- Consider increasing rate limit in configuration (advanced)

## Event Types

Currently supported events:
- `pull_request_review` - When a review is submitted (approved, changes requested, commented)

Ignored events (return 200 but not processed):
- `push`
- `pull_request`
- `issues`
- All other GitHub webhook events

## Advanced Configuration

### Custom Port

```bash
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/webhook-setup.js" setup --port 8080
```

### Manual Configuration

Edit `~/.oss/config.json` directly:

```json
{
  "webhook": {
    "enabled": true,
    "port": 8080,
    "secret": "your-custom-64-char-hex-secret"
  }
}
```

### Regenerate Secret

To generate a new secret (invalidates existing GitHub webhook):

```bash
# Remove webhook section from config
jq 'del(.webhook)' ~/.oss/config.json > tmp && mv tmp ~/.oss/config.json

# Re-run setup
node "$CLAUDE_PLUGIN_ROOT/watcher/dist/cli/webhook-setup.js" setup
```

Then update the secret in GitHub repository settings.

## Integration with PR Monitor

When integrated with the PR Monitor feature, webhook events trigger:

1. Notification about review feedback
2. Queue item for addressing review comments
3. Status line update showing pending reviews

See `/oss:monitor` for full PR monitoring capabilities.
