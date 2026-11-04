#!/usr/bin/env python3
"""Double-fork daemon spawner (pg_ctl-style) for the ServiceOS sandbox.

Processes started directly from agent shell sessions are reaped when the
session ends; daemons that fork twice + setsid (like PostgreSQL via pg_ctl)
survive. This helper uses the same pattern to keep the Next.js dev server
running between tool invocations.

Usage: python3 spawn-daemon.py <command> <logfile>
"""
import os
import sys


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: spawn-daemon.py <command...> --log <file>", file=sys.stderr)
        sys.exit(2)
    log_index = sys.argv.index("--log")
    command = sys.argv[1:log_index]
    logfile = sys.argv[log_index + 1]

    # First fork: child detaches from the invoking shell's session.
    pid = os.fork()
    if pid > 0:
        print(f"[spawn-daemon] intermediate pid {pid}")
        return

    os.setsid()
    os.umask(0o022)

    # Second fork: the final daemon is parented by init and can never
    # reacquire a controlling terminal.
    pid = os.fork()
    if pid > 0:
        os._exit(0)

    # Redirect stdio to the log file, then exec the command.
    fd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.close(fd)
    os.close(devnull)

    os.execvp(command[0], command)


if __name__ == "__main__":
    main()
