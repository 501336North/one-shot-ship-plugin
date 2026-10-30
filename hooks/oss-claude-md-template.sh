#!/bin/bash
# oss-claude-md-template.sh - prints the CLAUDE.md template (/oss:login Step 4.2). Takes no arguments.
#
# The key and the API it goes to come from one file, the OSS config (oss_config_file: $OSS_CONFIG_DIR/config.json,
# else ~/.oss/config.json): GET <oss_api_url>/api/v1/prompts/claude-md, the key fed to curl on stdin
# (oss_api_curl), never in argv. A loopback-http apiUrl without OSS_ALLOW_HTTP_LOOPBACK=1 prints the switch line.
#
# Exit 0: the template, control characters removed, on stdout. Exit 1: nothing on stdout, the reason on stderr
# (not logged in, a refused apiUrl, the API unreachable or timed out mid-body, a non-200 answer, a body over
# 256 KB, an HTML page, or an empty body).
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oss-api-curl.sh" \
    || { echo "oss-claude-md-template: oss-api-curl.sh not found beside this script" >&2; exit 1; }

warn() { printf 'oss-claude-md-template: %s\n' "$*" >&2; }

oss_api_creds   # key and URL from one read (T37)
url=$OSS_URL key=$OSS_KEY
case $OSS_URL_RC in
    (0) ;;
    (2) oss_loopback_refused >&2; exit 1 ;;
    (*) warn "$(oss_config_file) is not valid JSON, or its apiUrl is not an https URL (plain http only for localhost) with no user@, query or fragment; the key was not sent."; exit 1 ;;
esac
[[ -n "$key" ]] || { warn "not logged in: no apiKey in $(oss_config_file). Run /oss:login."; exit 1; }

MAX_BODY_BYTES=262144   # the cap oss-iron-laws-sync.sh uses
max_time=10
[[ "${OSS_CLAUDE_MD_MAX_TIME:-}" =~ ^[1-9]$ ]] && max_time=$OSS_CLAUDE_MD_MAX_TIME   # tests only: shorter, never longer

# --max-filesize refuses a too-large Content-Length up front; head -c bounds a body sent without one. The byte
# past the cap and the "\n200" status line lets a cut-off body be told apart from one that fits.
r=$(oss_api_curl "$key" -s -m "$max_time" --max-filesize "$MAX_BODY_BYTES" -w '\n%{http_code}' "$url/api/v1/prompts/claude-md" \
    | head -c $((MAX_BODY_BYTES + 5)); exit "${PIPESTATUS[0]}")
rc=$?
(( rc == 0 )) || { warn "the API at $url could not be read in full (curl exit $rc: unreachable, timed out, or over $MAX_BODY_BYTES bytes); no template."; exit 1; }
bytes=$(printf '%s' "$r" | wc -c | tr -d ' ')
(( bytes <= MAX_BODY_BYTES + 4 )) || { warn "the API at $url sent over $MAX_BODY_BYTES bytes; no template."; exit 1; }
code=${r##*$'\n'}
body=${r%$'\n'*}
[[ "$code" == 200 ]] || { warn "the API at $url answered HTTP $code; no template."; exit 1; }
if printf '%s' "$body" | grep -qiE '<!doctype html|<html[[:space:]>]'; then
    warn "the API at $url sent an HTML page (a captive portal or proxy?), not the template."; exit 1
fi
# Terminal control codes and invisible text never reach stdout: C0 except tab and newline, plus the set oss_json_field
# strips (oss_invisible in oss-api-curl.sh: DEL, C1, U+2028/U+2029, every format character incl. tag characters, T45).
body=$(printf '%s' "$body" | jq -Rrsj "$OSS_JQ_INVISIBLE"'gsub("[\u0000-\u0008\u000b-\u001f" + oss_invisible + "]"; "")') \
    || { warn "could not clean the template (jq missing?); no template."; exit 1; }
[[ -n "$body" ]] || { warn "the API at $url sent an empty template."; exit 1; }
printf '%s\n' "$body"
