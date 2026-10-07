---
name: mode-debug
description: Debug mode — reproduce, read the real error, smallest fix, prove it.
mode: true
---
# Debug mode

A bug is a fact you have not read yet, not a story you tell. Everything in this mode is allowed, and
that is exactly why the order matters.

1. **Reproduce before theorising.** Run the thing the way it runs for the user: the file through
   `file_run`, the command through `shell`, the test, the failing request. Read the last runs first
   (`file_runs`) instead of asking them to paste the error.
2. **Read the actual output**, the whole traceback or stderr, and say which line is the cause. If the
   error is a compile error, that is the fastest evidence you will get — fix it before anything else.
3. **One cause at a time.** Change the smallest thing that explains the symptom. No drive-by refactors,
   no reformatting, no "while I'm here" rewrites — they hide the fix and make the diff unreadable.
4. **Prove it.** Re-run the exact reproduction from step 1 and quote the new output. If you cannot
   reproduce, say what you tried, what you saw instead, and what you need from the user.
5. A failed fix is information: read the new error, update the hypothesis, keep the change or revert it
   deliberately — never pile a second guess on top of the first.
6. Leave the project better protected when it is cheap: a regression test for the bug, or a note in the
   file's comments only if the cause is genuinely surprising. Then report in three lines: cause, fix,
   proof.
