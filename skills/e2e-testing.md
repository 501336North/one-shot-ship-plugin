---
name: e2e-testing
description: Run comprehensive E2E tests across critical user journeys. Use for end-to-end testing.
---

# OSS E2E Testing

End-to-end testing of all critical user flows.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Prompt from API

Install the decrypt CLI if it is missing (a fresh install has none yet):

```bash
~/.oss/hooks/ensure-decrypt-cli.sh || { echo "Failed to install the decrypt CLI (see the message above). Check that github.com is reachable and the plugin is up to date (/plugin update), then retry."; exit 1; }
```

```bash
~/.oss/bin/oss-decrypt --type workflows --name e2e-testing
```

## Step 3: Execute the Fetched Prompt

The prompt tests:
- New user onboarding
- Plugin installation & first use
- Trial to paid conversion
- Team collaboration
- All critical user paths
- Cross-browser compatibility
- Mobile responsiveness

## Error Handling

### If API returns 401
```
Authentication failed. Run: /oss login
```

### If API returns 403
```
Subscription expired. Upgrade at: https://www.oneshotship.com/pricing
```

### If API returns 500
```
API temporarily unavailable. Contact support@oneshotship.com
```

## Example Usage

```
/oss e2e-testing
```

Runs E2E test suite and reports results.
