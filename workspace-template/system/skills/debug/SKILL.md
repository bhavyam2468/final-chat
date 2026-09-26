---
name: debug
description: Systematic debugging of code, builds and servers: reproduce, isolate, hypothesise, fix minimally, verify.
tools: dev
---
1. Reproduce: run the exact failing command (shell/host_shell or proc_start + proc_logs). Keep the full error; read it bottom-up for the first frame in the user's code.
2. Locate: fs_search the error text, symbol or route; fs_read around the reported line (±30).
3. Hypotheses: list 2-4 ranked causes with the observation that would confirm each. Check the cheapest first (typos, paths, env vars, versions, ports, stale build, cache).
4. Experiment: one change or probe at a time (print/log, minimal script in run_python, curl the endpoint, `check`). Never change several things at once.
5. Fix: the smallest edit that addresses the cause (fs_edit). No drive-by refactors.
6. Verify: rerun the reproduction, then check(path) for types/lint/tests. For servers: proc_restart + proc_logs(wait_for="port") + browser or curl.
7. Report: cause (one sentence), fix, how it was verified, anything left unverified.
Port busy → proc_logs() lists your processes; stop yours instead of killing unknown ones. Dependency/version errors → read the installed version (`npm ls x`, `pip show x`, `cargo tree -i x`) before searching docs for that version.
