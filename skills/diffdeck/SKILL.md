---
name: diffdeck
description: Launch the diffdeck local diff viewer in the human's browser to show code changes visually. Use when the human asks to see or review a diff, when showing what changed before a commit, or when a multi-file change is easier to understand visually than as terminal text.
license: Apache-2.0
---

# diffdeck — show the human a visual diff

diffdeck runs a local web server that renders the current git repository's diff
(the working tree's changes — or another worktree's, or the commits on any branch)
in the browser: a file tree with git-status badges, unified/split views, in-app
search, image diffs, live watch, and **grab** — the human can select code in the
diff and copy it back to you with an exact reference attached. Use it to let the
**human** see changes visually instead of reading raw diff text in the terminal.

## When to use

- The human asks to "see the diff", "show me the changes", or "open the diff viewer".
- You just made a multi-file change and a visual review would help the human.
- Before a commit, to let the human eyeball what will be committed.

## When NOT to use

- A tiny, single-line change — just show it inline.
- A headless/CI context where no human will open a browser.

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
browser opens automatically for the human.

- **New files**: untracked files are hidden by default. If your change adds files
  you haven't `git add`ed, launch with `--untracked` or the human won't see them.
- **Remote host**: the server listens on `127.0.0.1` only. If the human's browser
  is on another machine (you run on a host they reach over SSH), launch with
  `--no-open` and tell them to forward the port before opening the printed URL —
  e.g. `ssh -N -L 49573:127.0.0.1:49573 <host>`. Use the same port on both ends
  so the URL works unchanged.

If the human might want to point you at a specific hunk, mention grab: they can
select code in the diff (or use the gutter's `+` button), type a prompt, and
press Enter — that copies one block for them to paste back to you.

## When the human pastes a "diffdeck selection"

Pressing Enter copies a single fenced block plus the human's prompt on the line
after it:

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
  a selection spanning both reads `old A / new B`. The diff is `working diff`
  (uncommitted changes) or `base diff vs <base>` (commits since the branch forked
  from `<base>`; plain `base diff` when no base was found). ` on <branch>` follows
  when the human was viewing another branch rather than the working tree (e.g.
  `base diff vs main on feat/x`). An added, deleted, or untracked file appends its
  status (e.g. `, added`).
- The fenced body is the code. In a cross-side block **every** line is prefixed
  with `-`, `+`, or a space (unchanged context) — strip that first character to
  get the file text.

Answer about **that** range in **that** file: for a `new side` range you can go
straight to those line numbers instead of searching for the code. Things not to
assume, though:

- With ` on <branch>`, the lines are that branch's **committed** version — read
  them with `git show <branch>:<path>`. Your checkout may be on another branch or
  hold different contents at that path.
- **`old side` numbers index the pre-change file**, so they need not match the
  working tree (and with `, deleted` the path may be gone).
- The prompt is **optional**: a block with nothing after the fence means the human
  hasn't said what they want yet. Ask rather than inventing a task.

The human can also press ⌥⏎ (Alt+Enter) to copy the picked code **alone** — no
fence, no `diffdeck selection`/`File:`/`Lines:` lines, and no `-`/`+`/space
prefix even when the selection spans both sides. Such a paste is bare code: it
says nothing about where it came from, and a both-sides selection arrives with
the old and new versions of the same lines one after another — so the
strip-the-first-character rule above does not apply to it. Ask which file, and
which side, before acting on it.

## Options

- `--port <n>` — serve on a specific port (default 49573, or `$DIFFDECK_PORT`).
- `--no-open` — don't open a browser (the URL is printed either way).
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
