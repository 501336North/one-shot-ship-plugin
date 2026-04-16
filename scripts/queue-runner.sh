#!/usr/bin/env bash
# Queue Runner — Sequential batch execution of queued items
# Invoked by CC cron to drain the queue: plan→build→ship per item
set -euo pipefail

QUEUE_DIR="${OSS_DIR:-.oss}/queue"
TRACKING_FILE="$QUEUE_DIR/tracking.json"
LOCK_FILE="$TRACKING_FILE.lock"
LOCK_TIMEOUT=10
MAX_RETRIES=2

# ─── Task 9: File Locking ───

acquire_lock() {
    local lock_dir="$LOCK_FILE"
    local stale_timeout=$LOCK_TIMEOUT

    # Atomic lock via mkdir (POSIX atomic operation)
    if ! mkdir "$lock_dir" 2>/dev/null; then
        # Lock exists — check if stale
        local lock_time
        lock_time=$(cat "$lock_dir/pid" 2>/dev/null | cut -d: -f2 || echo 0)
        local now
        now=$(date +%s)
        local lock_age=$(( now - lock_time ))

        if (( lock_age > stale_timeout )); then
            echo "[WARN] Removing stale lock (${lock_age}s old, timeout=${stale_timeout}s)"
            rm -rf "$lock_dir"
            mkdir "$lock_dir" 2>/dev/null || return 1
        else
            echo "[ERROR] Lock held by another process (age: ${lock_age}s)"
            return 1
        fi
    fi

    echo "$$:$(date +%s)" > "$lock_dir/pid"
}

release_lock() {
    rm -rf "$LOCK_FILE"
}

# ─── Task 9: Tracking JSON Read/Write ───

read_tracking() {
    if [[ ! -f "$TRACKING_FILE" ]]; then
        echo '{"items":[],"history":{"completed_runs":0,"avg_duration_per_phase":{"plan":0,"build":0,"ship":0}}}'
        return
    fi
    cat "$TRACKING_FILE"
}

write_tracking() {
    local content="$1"
    local tmp_file="${TRACKING_FILE}.tmp"

    acquire_lock || return 1

    echo "$content" > "$tmp_file"
    mv "$tmp_file" "$TRACKING_FILE"

    release_lock
}

# ─── Task 10: Status Updates ───

update_status() {
    local item_id="$1"
    local new_status="$2"
    local tracking
    tracking=$(read_tracking)

    local updated
    updated=$(echo "$tracking" | jq --arg id "$item_id" --arg status "$new_status" \
        '.items = [.items[] | if .id == $id then .status = $status else . end]')

    write_tracking "$updated"
}

update_session() {
    local item_id="$1"
    local phase="$2"
    local session_id="$3"
    local tracking
    tracking=$(read_tracking)

    local updated
    updated=$(echo "$tracking" | jq --arg id "$item_id" --arg phase "$phase" --arg sess "$session_id" \
        '.items = [.items[] | if .id == $id then .sessions[$phase] = $sess else . end]')

    write_tracking "$updated"
}

# ─── Task 10: Sequential Drain Loop ───

get_ideated_items() {
    local tracking
    tracking=$(read_tracking)
    echo "$tracking" | jq -c '[.items[] | select(.status == "ideated")] | sort_by(.createdAt)'
}

drain_loop() {
    local items
    items=$(get_ideated_items)
    local count
    count=$(echo "$items" | jq 'length')

    if (( count == 0 )); then
        echo "[INFO] No ideated items to process"
        return 0
    fi

    echo "[INFO] Processing $count ideated items"

    for i in $(seq 0 $((count - 1))); do
        local item
        item=$(echo "$items" | jq -c ".[$i]")
        local item_id slug
        item_id=$(echo "$item" | jq -r '.id')
        slug=$(echo "$item" | jq -r '.source' | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | head -c 40)

        echo "[INFO] Processing item $((i+1))/$count: $item_id ($slug)"

        # Branch isolation: create feature branch per item
        if ! process_item "$item_id" "$slug" "$item"; then
            echo "[WARN] Item $item_id failed, continuing to next (continueOnFailure)"
            continue
        fi
    done
}

# ─── Task 11: Session Resumption + Task 12: Build Retry ───

run_phase() {
    local phase="$1"
    local item_id="$2"
    local resume_session="$3"
    local dev_docs_path="$4"

    local session_id=""
    local phase_output=""
    local phase_exit=0

    if [[ -n "$resume_session" ]]; then
        echo "[INFO] Running $phase with --resume $resume_session"
        phase_output=$(claude -p "/oss:$phase" --resume "$resume_session" 2>&1) || phase_exit=$?
        session_id=$(echo "$phase_output" | grep -o 'session:[a-zA-Z0-9-]*' | head -1) || true

        if [[ $phase_exit -ne 0 || -z "$session_id" ]]; then
            # Fallback to fresh session without --resume, with dev docs context
            echo "[INFO] Resume failed for $phase, falling back to fresh session with dev docs"
            phase_output=$(claude -p "/oss:$phase (context: see $dev_docs_path)" 2>&1) || phase_exit=$?
            session_id=$(echo "$phase_output" | grep -o 'session:[a-zA-Z0-9-]*' | head -1) || true
        fi
    else
        phase_output=$(claude -p "/oss:$phase" 2>&1) || phase_exit=$?
        session_id=$(echo "$phase_output" | grep -o 'session:[a-zA-Z0-9-]*' | head -1) || true
    fi

    if [[ -n "$session_id" ]]; then
        update_session "$item_id" "$phase" "$session_id"
    fi

    echo "$session_id"
    return $phase_exit
}

retry_build() {
    local item_id="$1"
    local resume_session="$2"
    local dev_docs_path="$3"
    local retry_count=0

    while (( retry_count < MAX_RETRIES )); do
        ((retry_count++))

        if (( retry_count == 1 )); then
            # First retry: resume session
            echo "[INFO] Build retry $retry_count/$MAX_RETRIES with --resume"
            if run_phase "build" "$item_id" "$resume_session" "$dev_docs_path"; then
                return 0
            fi
        else
            # Second retry: fresh session (no --resume)
            echo "[INFO] Build retry $retry_count/$MAX_RETRIES fresh (no --resume)"
            if run_phase "build" "$item_id" "" "$dev_docs_path"; then
                return 0
            fi
        fi
    done

    echo "[ERROR] Build failed after $retry_count retries (max=$MAX_RETRIES)"
    update_status "$item_id" "failed"
    update_retries "$item_id" "$retry_count"
    return 1
}

update_retries() {
    local item_id="$1"
    local retries="$2"
    local tracking
    tracking=$(read_tracking)

    local updated
    updated=$(echo "$tracking" | jq --arg id "$item_id" --argjson r "$retries" \
        '.items = [.items[] | if .id == $id then .retries = $r else . end]')

    write_tracking "$updated"
}

# ─── Task 13: Conflict Resolution ───

resolve_conflicts() {
    local item_id="$1"
    local dev_docs_path="$2"

    echo "[INFO] Checking for conflicts with origin/main before ship"
    git fetch origin main

    if ! git merge --no-commit origin/main 2>/dev/null; then
        echo "[WARN] Conflicts detected, attempting auto-resolve using dev docs"

        # Invoke claude to resolve conflicts using both features' DESIGN.md and PLAN.md
        local this_design="$dev_docs_path/DESIGN.md"
        local this_plan="$dev_docs_path/PLAN.md"

        claude -p "Resolve merge conflicts. Context: this feature's DESIGN.md at $this_design and PLAN.md at $this_plan. Resolve in favor of preserving both features' intent." || {
            echo "[ERROR] Auto-resolve failed"
            git merge --abort 2>/dev/null || true
            update_status "$item_id" "failed"
            return 1
        }

        # Stage only previously-conflicted files, not untracked artifacts
        git diff --name-only --diff-filter=U | xargs git add
        git commit -m "chore: resolve merge conflicts with main"

        # Re-run tests after conflict resolution
        echo "[INFO] Running tests after conflict resolution (post-resolve check)"
        if ! run_tests_after_resolve; then
            echo "[ERROR] Tests failed after conflict resolution — flagging for human review"
            update_status "$item_id" "failed"
            # Flag for HUMAN_REVIEW
            local tracking
            tracking=$(read_tracking)
            local updated
            updated=$(echo "$tracking" | jq --arg id "$item_id" \
                '.items = [.items[] | if .id == $id then .error = "HUMAN_REVIEW: tests failed after conflict resolution" else . end]')
            write_tracking "$updated"
            return 1
        fi
    else
        # No conflicts, abort the merge attempt
        git merge --abort 2>/dev/null || true
    fi

    return 0
}

run_tests_after_resolve() {
    npx vitest run 2>&1
}

# ─── Task 14: Timing and History ───

record_phase_duration() {
    local item_id="$1"
    local phase="$2"
    local start_time="$3"
    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    local tracking
    tracking=$(read_tracking)

    local updated
    updated=$(echo "$tracking" | jq --arg id "$item_id" --arg phase "$phase" --argjson dur "$duration" \
        '.items = [.items[] | if .id == $id then (.durations // {})[$phase] = $dur | .durations = (.durations // {}) | .durations[$phase] = $dur else . end]')

    write_tracking "$updated"
}

update_history_averages() {
    local item_id="$1"
    local tracking
    tracking=$(read_tracking)

    # Get this item's durations
    local plan_dur build_dur ship_dur
    plan_dur=$(echo "$tracking" | jq --arg id "$item_id" '[.items[] | select(.id == $id)][0].durations.plan // 0')
    build_dur=$(echo "$tracking" | jq --arg id "$item_id" '[.items[] | select(.id == $id)][0].durations.build // 0')
    ship_dur=$(echo "$tracking" | jq --arg id "$item_id" '[.items[] | select(.id == $id)][0].durations.ship // 0')

    # Get current history
    local runs avg_plan avg_build avg_ship
    runs=$(echo "$tracking" | jq '.history.completed_runs')
    avg_plan=$(echo "$tracking" | jq '.history.avg_duration_per_phase.plan')
    avg_build=$(echo "$tracking" | jq '.history.avg_duration_per_phase.build')
    avg_ship=$(echo "$tracking" | jq '.history.avg_duration_per_phase.ship')

    # Compute rolling averages
    local new_runs=$((runs + 1))
    local new_avg_plan new_avg_build new_avg_ship
    new_avg_plan=$(( (avg_plan * runs + plan_dur) / new_runs ))
    new_avg_build=$(( (avg_build * runs + build_dur) / new_runs ))
    new_avg_ship=$(( (avg_ship * runs + ship_dur) / new_runs ))

    # Update history with incremented completed_runs
    local updated
    updated=$(echo "$tracking" | jq \
        --argjson runs "$new_runs" \
        --argjson plan "$new_avg_plan" \
        --argjson build "$new_avg_build" \
        --argjson ship "$new_avg_ship" \
        '.history.completed_runs = $runs |
         .history.avg_duration_per_phase.plan = $plan |
         .history.avg_duration_per_phase.build = $build |
         .history.avg_duration_per_phase.ship = $ship')

    write_tracking "$updated"
}

# ─── Main: Process a single item ───

process_item() {
    local item_id="$1"
    local slug="$2"
    local item="$3"
    local dev_docs_path=".oss/dev/active/$slug"

    # Branch isolation
    git checkout -b "feat/queue-$slug" origin/main || {
        echo "[ERROR] Failed to create branch for $slug"
        update_status "$item_id" "failed"
        return 1
    }

    local ideate_session
    ideate_session=$(echo "$item" | jq -r '.sessions.ideate // empty')

    # Plan phase
    update_status "$item_id" "planning"
    local plan_start
    plan_start=$(date +%s)
    local plan_session
    plan_session=$(run_phase "plan" "$item_id" "$ideate_session" "$dev_docs_path")
    record_phase_duration "$item_id" "plan" "$plan_start"

    # Build phase
    update_status "$item_id" "building"
    local build_start
    build_start=$(date +%s)
    if ! retry_build "$item_id" "$plan_session" "$dev_docs_path"; then
        return 1
    fi
    record_phase_duration "$item_id" "build" "$build_start"

    # Conflict resolution before ship
    if ! resolve_conflicts "$item_id" "$dev_docs_path"; then
        return 1
    fi

    # Ship phase (without --merge — human reviews PRs)
    update_status "$item_id" "shipping"
    local ship_start
    ship_start=$(date +%s)
    local build_session
    build_session=$(echo "$(read_tracking)" | jq -r --arg id "$item_id" '[.items[] | select(.id == $id)][0].sessions.build // empty')
    run_phase "ship" "$item_id" "$build_session" "$dev_docs_path"
    record_phase_duration "$item_id" "ship" "$ship_start"

    # Complete
    update_status "$item_id" "completed"
    update_history_averages "$item_id"

    echo "[INFO] Item $item_id completed successfully"
    return 0
}

# ─── Entry point ───

main() {
    mkdir -p "$QUEUE_DIR"
    echo "[INFO] Queue runner starting"
    drain_loop
    echo "[INFO] Queue runner finished"
}

# Only run main if script is executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
