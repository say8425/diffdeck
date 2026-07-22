# @say8425/diffdeck

A local git diff viewer. Run it in any git repository to browse working-tree
and branch diffs in your browser, with syntax highlighting, a file tree, and
inline image diffs.

## Usage

```bash
bunx @say8425/diffdeck
```

Run it from inside a git repository. It starts a local server on
`127.0.0.1:49573` (override with `--port`) and opens the viewer in your
default browser.

## Options

| Flag              | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `--port <n>`      | Port to serve on (default: `$DIFFDECK_PORT` or `49573`)      |
| `--no-open`       | Do not open a browser automatically (prints the URL instead) |
| `--untracked`     | Start with untracked files included                          |
| `--watch`         | Start with watch (auto-refresh) on                           |
| `--no-flatten`    | Start with the file tree un-flattened (flatten is on)        |
| `--tree-right`    | Start with the file tree on the right                        |
| `--split`         | Start in split view (unified is the default)                 |
| `--hide-tree`     | Start with the file tree hidden                              |
| `-h`, `--help`    | Show help                                                    |
| `-v`, `--version` | Show version                                                 |

The view flags (`--untracked`, `--watch`, `--no-flatten`, `--tree-right`,
`--split`, `--hide-tree`) set the initial state for this launch only — they
don't change your saved preferences, and the in-app toggles reflect the
launched state.

## Environment

- `DIFFDECK_PORT` — sets the default port (equivalent to `--port`).

The server issues an access token on first run and caches it under
`~/.cache/diffdeck/` (or `$XDG_CACHE_HOME/diffdeck/` if set), so the printed
URL keeps working across restarts without re-authenticating.

## Learn more

See the [project repository](https://github.com/say8425/diffdeck) for
architecture, development setup, and provenance details.
