#!/bin/bash
# OSS Audio Cue Configuration
#
# To disable audio cues, change OSS_AUDIO_ENABLED to "false"
# To use sounds instead of voice, change OSS_USE_VOICE to "false"
#
# Users can override settings by creating ~/.oss/audio-config
# Use /oss-audio command to manage settings easily

# Load user overrides if they exist
[[ -f ~/.oss/audio-config ]] && source ~/.oss/audio-config

# Master toggle - set to "false" to disable all audio cues
OSS_AUDIO_ENABLED="${OSS_AUDIO_ENABLED:-true}"

# Voice vs Sound toggle - set to "false" to use system sounds instead of voice
OSS_USE_VOICE="${OSS_USE_VOICE:-true}"

# Voice settings (when OSS_USE_VOICE=true)
OSS_VOICE="${OSS_VOICE:-Samantha}"  # macOS voice: Samantha, Daniel, Karen, etc.

# Sound settings (when OSS_USE_VOICE=false)
# Using macOS system sounds - distinctive and professional
OSS_SOUND_READY="${OSS_SOUND_READY:-Glass}"      # When Claude needs input
OSS_SOUND_DONE="${OSS_SOUND_DONE:-Purr}"         # When Claude finishes task

# Phrases (when using voice)
OSS_PHRASE_READY="${OSS_PHRASE_READY:-Ready}"
OSS_PHRASE_DONE="${OSS_PHRASE_DONE:-Done}"
