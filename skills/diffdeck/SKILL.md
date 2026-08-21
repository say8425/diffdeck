---
name: diffdeck
description: Launch the diffdeck local diff viewer in the human's browser to show code changes visually. Use when the human asks to see or review a diff, when showing what changed before a commit, or when a multi-file change is easier to understand visually than as terminal text.
license: Apache-2.0
---

# diffdeck — show the human a visual diff

diffdeck runs a local web server that renders the current git repository's diff
(working-tree changes, or a comparison against any branch) in the browser: a file tree with
git-status badges, unified/split views, in-app search, image diffs, live watch,
and **grab** — the human can select code in the diff and copy it back to you with
an exact reference attached. Use it to let the **human** see changes visually
instead of reading raw diff text in the terminal.

## When to use

- The human asks to "see the diff", "show me the changes", or "open the diff viewer".
- You just made a multi-file change and a visual review would help the human.
- Before a commit, to let the human eyeball what will be committed.

## When NOT to use

- A tiny, single-line change — just show it inline.
- A headless/CI context where the human has no browser to look at (or use
  `--no-open` and share the URL for them to open later).

## How to launch

Run diffdeck in the repository you want to show, **in the background** (the
server stays up until stopped), then tell the human it is open and give them the
URL. Prefer a globally-installed `diffdeck`; otherwise use `bunx @say8425/diffdeck`:

```bash
# from inside the target git repo, run in the background:
diffdeck            # or: bunx @say8425/diffdeck
```

It prints:

```
diffdeck viewer running at:
http://127.0.0.1:49573/?repo=<repo>&token=<token>
Press Ctrl+C to stop.
```

Capture that URL and tell the human, e.g. "Opened the diff viewer for you:
http://127.0.0.1:49573/?repo=…&token=… — it shows the current changes." The
browser opens automatically for the human. If you are running somewhere the
human's browser can't be reached (remote/headless), add `--no-open` and just
share the printed URL.

If the human might want to point you at a specific hunk, mention grab: they can
drag-select code in the diff (or use the gutter's `+` button), type a prompt, and
press Enter — that copies one block for them to paste back to you.

## When the human pastes a "diffdeck selection"

Grab copies a single fenced block plus the human's prompt on the line after it:

````text
```
diffdeck selection
File: apps/viewer/browser/main.ts
Lines: 84-85 (new side, working diff)

if (a) return;
const b = 1;
```
why was this needed?
````

Read it as an **exact pointer**, not as loose context.

- `File:` — repo-relative path, with `(renamed from …)` when the file was renamed.
- `Lines:` — the exact range, which side it came from, and which diff was on
  screen. `new side` = the version **after** the change, `old side` = **before**;
  a selection spanning both reads `old A / new B`. The mode is `working diff` or
  `base diff vs <branch>`, and an added, deleted, or untracked file appends its
  status (e.g. `, added`).
- The fenced body is the code. In a cross-side block **every** line is prefixed
  with `-`, `+`, or a space (unchanged context) — strip that first character to
  get the file text.

Answer about **that** range in **that** file: for a `new side` range you can go
straight to those line numbers instead of searching for the code. Two things not
to assume, though — **`old side` numbers index the pre-change file**, so they
need not match the working tree (and with `, deleted` the path may be gone); and
the prompt is **optional**, so a block with nothing after the fence means the
human hasn't said what they want yet. Ask rather than inventing a task.

## Options

- `--port <n>` — serve on a specific port (default 49573, or `$DIFFDECK_PORT`).
- `--no-open` — don't open a browser; print the URL to share.
- `--untracked` — start with untracked files included in the diff.
- `--watch` — start with watch (auto-refresh) on.
- `--no-flatten` — start with the file tree un-flattened (flatten is on by default).
- `--tree-right` — start with the file tree on the right.
- `--split` — start in split view (unified is the default).
- `--hide-tree` — start with the file tree hidden.
- `--fold-with-tree` — start with sidebar directory collapse synced to diff folds.

## Stopping

The server keeps running (across your session) until the process is stopped
(Ctrl+C, or kill the background process). Leave it running while the human is
looking; stop it when they are done.
