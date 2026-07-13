---
name: diffdeck
description: Launch the diffdeck local diff viewer in the human's browser to show code changes visually. Use when the human asks to see or review a diff, when showing what changed before a commit, or when a multi-file change is easier to understand visually than as terminal text.
license: Apache-2.0
---

# diffdeck — show the human a visual diff

diffdeck runs a local web server that renders the current git repository's diff
(working-tree changes, or a branch vs its base) in the browser: a file tree with
git-status badges, unified/split views, in-app search, image diffs, and live
watch. Use it to let the **human** see changes visually instead of reading raw
diff text in the terminal.

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

## Options

- `--port <n>` — serve on a specific port (default 49573, or `$DIFFDECK_PORT`).
- `--no-open` — don't open a browser; print the URL to share.

## Stopping

The server keeps running (across your session) until the process is stopped
(Ctrl+C, or kill the background process). Leave it running while the human is
looking; stop it when they are done.
