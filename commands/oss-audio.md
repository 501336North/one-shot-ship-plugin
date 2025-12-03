---
name: oss-audio
description: Configure OSS audio notifications
---

# OSS Audio Configuration

Manage audio cues for OSS Dev Workflow.

## Usage

```bash
/oss-audio status    # Show current settings
/oss-audio on        # Enable audio cues
/oss-audio off       # Disable audio cues
/oss-audio voice     # Use voice notifications
/oss-audio sound     # Use system sounds instead of voice
```

## Implementation

When user runs `/oss-audio <option>`:

### status
Read and display current settings from `~/.oss/audio-config`:
```bash
if [ -f ~/.oss/audio-config ]; then
    source ~/.oss/audio-config
    echo "OSS Audio Settings:"
    echo "  Enabled: $OSS_AUDIO_ENABLED"
    echo "  Mode: $([ "$OSS_USE_VOICE" = "true" ] && echo "Voice" || echo "Sound")"
    echo "  Voice: $OSS_VOICE"
else
    echo "OSS Audio: Using defaults (voice enabled)"
fi
```

### on
```bash
mkdir -p ~/.oss
echo 'export OSS_AUDIO_ENABLED="true"' > ~/.oss/audio-config
echo "Audio cues enabled"
```

### off
```bash
mkdir -p ~/.oss
echo 'export OSS_AUDIO_ENABLED="false"' > ~/.oss/audio-config
echo "Audio cues disabled"
```

### voice
```bash
mkdir -p ~/.oss
cat > ~/.oss/audio-config << 'EOF'
export OSS_AUDIO_ENABLED="true"
export OSS_USE_VOICE="true"
EOF
echo "Switched to voice notifications"
```

### sound
```bash
mkdir -p ~/.oss
cat > ~/.oss/audio-config << 'EOF'
export OSS_AUDIO_ENABLED="true"
export OSS_USE_VOICE="false"
EOF
echo "Switched to sound notifications"
```

## Available Sounds

macOS system sounds that can be customized in `oss-config.sh`:
- Glass (default for "ready")
- Purr (default for "done")
- Ping
- Pop
- Submarine
- Tink

## Available Voices

macOS voices that can be used:
- Samantha (default - female, natural)
- Daniel (male, British)
- Karen (female, Australian)
- Moira (female, Irish)
- Alex (male, American)
