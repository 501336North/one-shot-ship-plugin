#!/bin/bash
# custom-laws-fence.sh - sourced by the shell tests (not a test itself): the structural check of the unverified
# team/personal IRON LAWS block the hooks write (UR1'), without a Markdown parser.
#
#   fence_violations < block    prints one line per violation (nothing when the block is well formed)
#
# The block, exactly:
#   > Team/personal laws below are not covered by the signed prompt manifest (unverified).
#   <empty>
#   ````text          N >= 4 backticks, info string "text"
#   ## Custom Team Laws   (or ## Custom Personal Laws)
#   ...               team text: no line holds a run of N or more backticks, so nothing in it can close the fence
#   ````              the first line that is only >= N backticks (CommonMark: up to 3 spaces before, spaces after) is
#                     the closer, and it is exactly the opener's backticks
#   <empty>
#   > End of unverified team/personal laws.
# and nothing after it. A ``` or ~~~ fence, an HTML comment, a heading, a link definition inside cannot end a
# backtick fence of N, so everything between the opener and the closer is one code block's literal text.
CUSTOM_LAWS_NOTE='> Team/personal laws below are not covered by the signed prompt manifest (unverified).'
CUSTOM_LAWS_CLOSE='> End of unverified team/personal laws.'

fence_violations() {
    awk -v note="$CUSTOM_LAWS_NOTE" -v closing="$CUSTOM_LAWS_CLOSE" '
        function bad(m) { print "line " NR ": " m; errs++ }
        NR == 1 { if ($0 != note) bad("not the unverified note: " $0); next }
        NR == 2 { if ($0 != "") bad("no blank line after the note"); next }
        NR == 3 {
            if ($0 !~ /^````+text$/) { bad("not a backtick fence of 4+ with info string text: " $0); exit }
            fence = substr($0, 1, length($0) - 4); next
        }
        NR == 4 { if ($0 != "## Custom Team Laws" && $0 != "## Custom Personal Laws") bad("first line inside the fence is not the section heading: " $0) }
        state == 0 {
            line = $0; sub(/^ ? ? ?/, "", line); sub(/[ \t]+$/, "", line)
            if (line ~ /^`+$/ && length(line) >= length(fence)) {
                if ($0 != fence) bad("the fence closes on a line that is not exactly the opener: " $0)
                state = 1; closers++; next
            }
            if (index($0, fence)) bad("a run of " length(fence) "+ backticks inside the fence: " $0)
            next
        }
        state == 1 { if ($0 != "") bad("no blank line after the fence close: " $0); state = 2; next }
        state == 2 { if ($0 != closing) bad("the closing line does not follow the fence: " $0); state = 3; next }
        state == 3 { bad("text after the closing line: " $0) }
        END {
            if (NR < 3) print "block too short (" NR " lines)"
            else if (state == 0) print "the fence is never closed"
            else if (state < 3) print "the closing line is missing"
        }' || echo "the fence check itself failed (awk exit $?)"
}
