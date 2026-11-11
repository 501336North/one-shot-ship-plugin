# shellcheck shell=bash
# Sourced by hooks/__tests__/*.test.sh. Not a test itself. The ONLY time cap a hook test may use (T49):
# no-hand-capped-tests.test.sh fails on any test file that writes its own alarm/timeout/gtimeout cap.
#
# run_capped SECONDS CMD [ARGS...]
#   Runs CMD in its own process group, with stdin, stdout and stderr passed through.
#   - Returns CMD's own exit status (128 + n when a signal n ended it).
#   - At SECONDS it sends KILL to the whole group, not only to CMD, and returns RUN_CAPPED_CAP_RC: a cap that
#     killed only the hook's shell left its `jq -s` child reading /dev/zero forever (2026-10-30).
#   - After every run it checks the group. A member still alive 2 s after CMD ended (a background job) is
#     killed, the call returns RUN_CAPPED_LEAK_RC and says so on stderr.
#   Needs only /usr/bin/perl: stock macOS has no timeout, gtimeout or setsid. Never kills by name.
RUN_CAPPED_CAP_RC=124
RUN_CAPPED_LEAK_RC=125
run_capped() {
    /usr/bin/perl -MPOSIX -e '
        my ($secs, $cap, $leak) = splice(@ARGV, 0, 3);
        # A caller that blocks SIGALRM must not switch the cap off, nor CMD'"'"'s own alarms: unblock it before the
        # fork. A Ctrl-C, TERM or HUP to the caller must take the group down with it (CMD has a group of its own, so
        # the terminal'"'"'s signal never reaches it): hold them back from the fork until the handlers are in, so one
        # landing in between is not lost; CMD gets the caller'"'"'s mask back before exec.
        POSIX::sigprocmask(POSIX::SIG_UNBLOCK(), POSIX::SigSet->new(POSIX::SIGALRM()));
        my $mask = POSIX::SigSet->new;
        POSIX::sigprocmask(POSIX::SIG_BLOCK(), POSIX::SigSet->new(POSIX::SIGINT(), POSIX::SIGTERM(), POSIX::SIGHUP()), $mask);
        my $p = fork; die "run_capped: fork failed: $!\n" unless defined $p;
        if (!$p) { setpgrp(0, 0); POSIX::sigprocmask(POSIX::SIG_SETMASK(), $mask); exec { $ARGV[0] } @ARGV or exit 127 }
        setpgrp($p, $p);
        my $capped = 0;
        $SIG{ALRM} = sub { $capped = 1; kill "KILL", -$p };
        for my $sig (qw(INT TERM HUP)) {
            $SIG{$sig} = sub { kill "KILL", -$p; $SIG{$sig} = "DEFAULT"; kill $sig, $$; exit 128 };
        }
        POSIX::sigprocmask(POSIX::SIG_SETMASK(), $mask);
        alarm $secs;
        my $r; do { $r = waitpid($p, 0) } while ($r == -1 && $!{EINTR});
        my $st = $?;
        alarm 0;
        for (1 .. 20) { last unless kill 0, -$p; select(undef, undef, undef, 0.1) }
        if (kill 0, -$p) {
            kill "KILL", -$p;
            print STDERR "run_capped: a process started by \"@ARGV\" survived it; killed it (a test must not leave processes behind)\n";
            exit $leak;
        }
        exit $cap if $capped;
        exit($st & 127 ? 128 + ($st & 127) : $st >> 8);
    ' "$1" "$RUN_CAPPED_CAP_RC" "$RUN_CAPPED_LEAK_RC" "${@:2}"
}
