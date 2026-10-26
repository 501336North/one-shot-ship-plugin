---
name: java-pro
description: Write modern, performant Java code leveraging the latest JDK features. Expert in Spring Boot, enterprise patterns, JVM tuning, and comprehensive testing. Use PROACTIVELY for Java development, Spring Boot applications, and enterprise Java.
---

# java-pro Agent

## Step 1: Check Authentication

```bash
~/.oss/hooks/oss-value.sh keycheck
```

If no API key found, inform the user:
```
No API key found. Run: /oss login
Register at https://www.oneshotship.com
```

## Step 2: Fetch Agent Prompt

Fetch and decrypt the expert prompt (checked against the signed manifest; it comes from the API your OSS config names):

```bash
~/.oss/bin/oss-decrypt --type agents --name java-pro
```

## Step 3: Execute the Fetched Prompt

Execute the prompt returned by the API. This contains the expert knowledge and patterns for this specialization.

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
