---
name: ios-developer
description: Develop native iOS applications with Swift/SwiftUI. Masters UIKit/SwiftUI, Core Data, networking, and app lifecycle. Use PROACTIVELY for iOS-specific features, App Store optimization, or native iOS development.
---

# OSS Ios Developer Agent

Expert ios developer powered by One Shot Ship.

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Agent Prompt from API

```bash
~/.oss/bin/oss-decrypt --type agents --name ios-developer
```

## Step 3: Execute the Fetched Prompt

The API returns the expert prompt which you execute directly.

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
