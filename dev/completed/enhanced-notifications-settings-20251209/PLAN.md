# Implementation Plan: Enhanced Notifications + Settings

## Summary

Expand the notification system to cover all key workflow moments and create a `/oss:settings` command for user preferences. Prompt users to choose notification style during login.

## Design Reference

See: Ideation session 2025-12-07

## Existing Infrastructure

Already have:
- `hooks/oss-config.sh` - Audio config with `OSS_AUDIO_ENABLED`, `OSS_USE_VOICE`, etc.
- `hooks/oss-notification.sh` - Basic notification hook (audio only)
- `hooks/oss-session-start.sh` - Uses `terminal-notifier` for context restore
- `commands/oss-audio.md` - Basic audio toggle command
- `~/.oss/audio-config` - User audio settings storage

Need to add:
- Visual notifications at workflow moments
- Unified notification service
- `/oss:settings` command (replaces `oss-audio`)
- Login prompt for notification preference

---

## TDD Implementation Tasks

### Phase 1: Notification Service (Foundation)

#### Task 1.1: Create NotificationService class

**Objective**: Centralized notification dispatch with style support

**Tests to Write (RED step)**:
- File: `watcher/test/services/notification.test.ts`
```typescript
test('should load settings from ~/.oss/settings.json')
test('should fall back to defaults when no settings file')
test('should dispatch visual notification via terminal-notifier')
test('should dispatch audio notification via say command')
test('should dispatch sound notification via afplay')
test('should skip notification when style is "none"')
test('should filter by verbosity level (all, important, errors-only)')
```

**Implementation (GREEN step)**:
- File: `watcher/src/services/notification.ts`
- Class: `NotificationService`
- Methods:
  - `loadSettings(): NotificationSettings`
  - `notify(event: NotificationEvent): void`
  - `shouldNotify(event: NotificationEvent): boolean`

**Acceptance Criteria**:
- [ ] All 7 tests pass
- [ ] Settings loaded from `~/.oss/settings.json`
- [ ] Falls back to visual notifications as default

---

#### Task 1.2: Define notification event types

**Objective**: Type-safe notification events with priorities

**Tests to Write (RED step)**:
- File: `watcher/test/services/notification.test.ts`
```typescript
test('should categorize COMMAND_START as low priority')
test('should categorize COMMAND_COMPLETE as high priority')
test('should categorize COMMAND_FAILED as critical priority')
test('should categorize LOOP_DETECTED as critical priority')
test('should format message with emoji and context')
```

**Implementation (GREEN step)**:
- File: `watcher/src/types/notification.ts`
```typescript
type NotificationEvent = {
  type: 'COMMAND_START' | 'COMMAND_COMPLETE' | 'COMMAND_FAILED' |
        'AGENT_SPAWN' | 'AGENT_COMPLETE' | 'QUALITY_PASSED' |
        'PR_CREATED' | 'PR_MERGED' | 'LOOP_DETECTED' | 'INTERVENTION';
  title: string;
  message: string;
  priority: 'low' | 'high' | 'critical';
  data?: Record<string, unknown>;
}
```

**Acceptance Criteria**:
- [ ] All 5 tests pass
- [ ] Event types match workflow moments
- [ ] Priority levels support verbosity filtering

---

### Phase 2: Settings Storage

#### Task 2.1: Settings file management

**Objective**: Read/write `~/.oss/settings.json`

**Tests to Write (RED step)**:
- File: `watcher/test/services/settings.test.ts`
```typescript
test('should create settings.json if not exists')
test('should read existing settings.json')
test('should write updated settings')
test('should merge partial updates with existing settings')
test('should validate settings schema')
test('should migrate from old audio-config format')
```

**Implementation (GREEN step)**:
- File: `watcher/src/services/settings.ts`
- Class: `SettingsService`
```typescript
interface Settings {
  notifications: {
    style: 'visual' | 'audio' | 'sound' | 'none';
    voice: string;
    sound: string;
    verbosity: 'all' | 'important' | 'errors-only';
  };
  version: number;
}
```

**Acceptance Criteria**:
- [ ] All 6 tests pass
- [ ] Backward compatible with `~/.oss/audio-config`
- [ ] Schema validation prevents corruption

---

### Phase 3: Settings Command

#### Task 3.1: Create `/oss:settings` slash command

**Objective**: Interactive settings management

**Tests to Write (RED step)**:
- File: `watcher/test/commands/settings.test.ts`
```typescript
test('should display current settings')
test('should allow changing notification style')
test('should allow changing verbosity')
test('should persist changes to settings.json')
test('should show available options with descriptions')
```

**Implementation (GREEN step)**:
- File: `commands/settings.md`
```markdown
# /oss:settings

Display and modify OSS preferences.

## Display Current Settings
Show current notification style, verbosity, voice/sound options.

## Change Settings
Present options using AskUserQuestion tool:
- Notification style: visual | audio | sound | none
- Verbosity: all | important | errors-only
- Voice (if audio): Samantha | Daniel | Karen | etc.
- Sound (if sound): Glass | Purr | Ping | etc.
```

**Acceptance Criteria**:
- [ ] All 5 tests pass
- [ ] Settings displayed clearly
- [ ] Changes persisted immediately

---

### Phase 4: Login Integration

#### Task 4.1: Add notification prompt to login flow

**Objective**: First-run setup for notification preference

**Tests to Write (RED step)**:
- File: `watcher/test/commands/login.test.ts`
```typescript
test('should prompt for notification style on first login')
test('should skip prompt if settings already exist')
test('should save chosen style to settings.json')
test('should show preview of chosen notification style')
```

**Implementation (GREEN step)**:
- File: `commands/login.md` (update)
- Add step after successful authentication:
```markdown
## Step 5: Configure Notifications (First Run)

If ~/.oss/settings.json does not exist, prompt:

"How would you like to be notified?"
A) Visual (macOS notifications)
B) Audio (spoken messages)
C) Sound (audio chime)
D) None (silent)

Save choice to settings.json.
```

**Acceptance Criteria**:
- [ ] All 4 tests pass
- [ ] Prompt only on first login
- [ ] Preview demonstrates chosen style

---

### Phase 5: Hook Integration

#### Task 5.1: Create unified notification hook

**Objective**: Single hook that respects user settings

**Tests to Write (RED step)**:
- File: `hooks/test-notification.sh` (manual test script)
```bash
# Test visual notification
./oss-notify.sh "Test Title" "Test message" "high"

# Test audio notification
OSS_NOTIFICATION_STYLE=audio ./oss-notify.sh "Test" "Message" "high"

# Test sound notification
OSS_NOTIFICATION_STYLE=sound ./oss-notify.sh "Test" "Message" "high"
```

**Implementation (GREEN step)**:
- File: `hooks/oss-notify.sh`
```bash
#!/bin/bash
# Unified notification hook
# Usage: oss-notify.sh "Title" "Message" "priority"

# Load settings
SETTINGS_FILE=~/.oss/settings.json
if [[ -f "$SETTINGS_FILE" ]]; then
    STYLE=$(jq -r '.notifications.style // "visual"' "$SETTINGS_FILE")
    VERBOSITY=$(jq -r '.notifications.verbosity // "important"' "$SETTINGS_FILE")
    VOICE=$(jq -r '.notifications.voice // "Samantha"' "$SETTINGS_FILE")
    SOUND=$(jq -r '.notifications.sound // "Glass"' "$SETTINGS_FILE")
else
    STYLE="visual"
    VERBOSITY="important"
fi

# Filter by verbosity
PRIORITY="${3:-high}"
case "$VERBOSITY" in
    "errors-only") [[ "$PRIORITY" != "critical" ]] && exit 0 ;;
    "important") [[ "$PRIORITY" == "low" ]] && exit 0 ;;
esac

# Dispatch by style
case "$STYLE" in
    "visual")
        terminal-notifier -title "$1" -message "$2" -sound default
        ;;
    "audio")
        say -v "$VOICE" "$2"
        ;;
    "sound")
        afplay "/System/Library/Sounds/${SOUND}.aiff"
        ;;
esac
```

**Acceptance Criteria**:
- [ ] Manual tests pass for all styles
- [ ] Respects verbosity setting
- [ ] Falls back gracefully if tools missing

---

#### Task 5.2: Add notifications to workflow commands

**Objective**: Trigger notifications at key moments

**Implementation (GREEN step)**:
Update these files to call `oss-notify.sh`:

| File | Event | Title | Priority |
|------|-------|-------|----------|
| `commands/ideate.md` | START | "🎯 Starting ideation..." | low |
| `commands/ideate.md` | COMPLETE | "✅ Design complete" | high |
| `commands/plan.md` | START | "📋 Creating plan..." | low |
| `commands/plan.md` | COMPLETE | "✅ Plan ready" | high |
| `commands/build.md` | START | "🔨 Building..." | low |
| `commands/build.md` | COMPLETE | "✅ Build complete" | high |
| `commands/build.md` | FAILED | "❌ Build failed" | critical |
| `commands/ship.md` | START | "🚢 Shipping..." | low |
| `commands/ship.md` | PR_CREATED | "📝 PR created" | high |
| `commands/ship.md` | MERGED | "🎉 Shipped!" | high |

**Acceptance Criteria**:
- [ ] Each command triggers appropriate notifications
- [ ] Messages are concise and meaningful
- [ ] Emojis make notifications visually distinctive

---

### Phase 6: Deprecate oss-audio

#### Task 6.1: Migrate oss-audio to settings

**Objective**: `/oss:settings` replaces `/oss:audio`

**Implementation**:
- Update `commands/oss-audio.md` to redirect to `/oss:settings`
- Add deprecation notice
- Migrate existing `~/.oss/audio-config` to `~/.oss/settings.json`

**Acceptance Criteria**:
- [ ] `/oss:audio` shows deprecation message
- [ ] Existing audio-config users migrated automatically
- [ ] No functionality lost

---

## Testing Strategy

### Unit Tests
- [ ] NotificationService (7 tests)
- [ ] SettingsService (6 tests)
- [ ] Event types (5 tests)

### Integration Tests
- [ ] Login flow with settings prompt (4 tests)
- [ ] Settings command (5 tests)

### Manual Tests
- [ ] Visual notification appears
- [ ] Audio says message
- [ ] Sound plays
- [ ] Verbosity filtering works

## Security Checklist

- [ ] No secrets in notification messages
- [ ] Settings file not world-readable
- [ ] No command injection in shell scripts

## Estimated Tasks: 6 phases, ~12 tasks
## Estimated Test Cases: ~27 automated + manual tests

---

## Command Chain

```
/oss:ideate (DONE)
    ↓
/oss:plan (THIS DOCUMENT)
    ↓
/oss:build → Execute phases 1-6
    ↓
/oss:ship → Quality check, commit, PR
```

Ready for `/oss:build`?
