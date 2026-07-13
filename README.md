# diffdeck

A local diff viewer, built on a vendored fork of Pierre's [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) and [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees).

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-black?style=flat&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#license)

![diffdeck rendering a large multi-file diff with syntax highlighting and a deep, flattened file tree](docs/screenshot.png)

## What is this?

diffdeck is the local diff viewer originally embedded in [cc-statusline](https://github.com/say8425/cc-statusline), extracted into its own product. Instead of depending on the upstream Pierre packages — which move fast (`@pierre/diffs` churns heavily; `@pierre/trees` is pre-1.0 beta) and whose internal markup we had already coupled to heavily — diffdeck **recovers the original TypeScript from the packages' source maps and vendors it**, so we own the rendering engine outright.

The result is a Bun-workspace monorepo where a commodity-hard, framework-agnostic diff engine (Pierre's `CodeView`, ~27k lines) is kept as-is, while the parts we customize live in our own code.

## Features

What the diff-rendering engine provides (all demonstrated by the render above):

- **Syntax-highlighted diffs** via [Shiki](https://shiki.style/) with TextMate themes (light + dark).
- **Full old/new file diffs**, not just patches — so unchanged context can be collapsed and **expanded on demand**.
- **Unified and split** layouts.
- **File-tree sidebar** with git-status badges, natural sort, and **flatten** (compacting single-child folder chains).
- **Image diffs** — changed binary images render inline with old/new panels.
- **Virtualized rendering** that stays smooth on large diffs, with sticky file headers.
- **Shadow-DOM encapsulation** per file, so the viewer's styles never leak into the page.

The interactive viewer chrome that wraps this engine — click-to-fold, copy-path, in-app search, watch/auto-refresh, and working-tree-vs-base modes — comes from the [cc-statusline](https://github.com/say8425/cc-statusline) viewer and now lives in diffdeck's `apps/viewer/`.

## Architecture

```
packages/
  path-store/   @diffdeck/path-store   pure tree logic (flatten, sort, projection, store)
  theming/      @diffdeck/theming      theme system + 10 vendored shiki theme JSONs
  diffs/        @diffdeck/diffs         CodeView diff-rendering engine
  trees/        @diffdeck/trees         FileTree engine (vanilla render)
apps/viewer/    @say8425/diffdeck — CLI + diff-server (data API) + browser viewer + agent skill
scripts/        source-map extraction tool, css-inline Bun plugin, render-parity harness
```

Dependency graph: `path-store` (no deps) ← `trees`; `theming` (shiki) ← `diffs`, `trees`. Runtime externals: shiki + `@shikijs/*`, `diff`, `hast-util-to-html`, `lru_map`.

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run typecheck   # per-package tsc
bun test
bun run lint        # oxlint
bun run format      # oxfmt
```

### Render-parity harness

Reproduces the screenshot above — confirms the forked `CodeView` + `FileTree` actually render:

```bash
bun run scripts/parity/build.ts
cd scripts/parity && python3 -m http.server 8099
# open http://127.0.0.1:8099/index.html
```

## Provenance & License

diffdeck bundles source **recovered from and derived from** the following packages, all licensed **Apache-2.0**:

- `@pierre/diffs`, `@pierre/trees`, `@pierre/theming`, `@pierre/theme` — Copyright The Pierre Computer Company.

Files under `packages/` are modified from the originals (import paths rewritten to the `@diffdeck/*` namespace; type declarations reconstructed where absent from source maps). Each package retains its upstream `LICENSE`, `packages/trees/NOTICE.md` retains the `@headless-tree/core` (MIT) attribution, and the top-level [`NOTICE`](./NOTICE) records the provenance and the fact of modification, as required by the Apache-2.0 license.

## License

Apache-2.0. See [`NOTICE`](./NOTICE) and the per-package `LICENSE` files.

## CLI

Run the diff viewer for the git repository in the current directory:

```bash
bunx @say8425/diffdeck
```

This starts a local server on `127.0.0.1:49573` (override with `--port`) and opens
the viewer in your browser.

Options:

| Flag              | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `--port <n>`      | Port to serve on (default: `$DIFFDECK_PORT` or `49573`)          |
| `--no-open`       | Do not open a browser automatically (prints the URL)             |
| `--untracked`     | Start with untracked files included                              |
| `--watch`         | Start with watch (auto-refresh) on                               |
| `--no-flatten`    | Start with the file tree un-flattened (flatten is on by default) |
| `--tree-right`    | Start with the file tree on the right                            |
| `--split`         | Start in split view (unified is the default)                     |
| `-h`, `--help`    | Show help                                                        |
| `-v`, `--version` | Show version                                                     |

These view flags set the initial state for this launch only — they don't
change your saved preferences, and the in-app toggles reflect the launched
state.

Environment: `DIFFDECK_PORT` sets the default port. The token is cached under
`~/.cache/diffdeck/`.

## AI agents

diffdeck ships an **agent skill** so an AI coding agent (Claude Code, Codex, …)
can open the diff viewer in your browser when a change is easier to see than to
read. The skill (a single `skills/diffdeck/SKILL.md`) just teaches the agent when
and how to run the diffdeck CLI. Install it through any of these channels:

```bash
# 1. Self-contained (needs diffdeck installed) — writes ~/.claude/skills/diffdeck/
diffdeck install-skill            # --codex → ~/.agents/skills/,  --project → this repo

# 2. Claude Code plugin
#    /plugin marketplace add say8425/diffdeck
#    /plugin install diffdeck@diffdeck

# 3. Codex plugin
#    codex plugin marketplace add say8425/diffdeck
#    codex plugin add diffdeck@diffdeck

# 4. npx skills (any supported agent)
npx skills add say8425/diffdeck
```

Channels 2–4 fetch from GitHub, so they need the repository to be **public** and
diffdeck **published to npm** (so the skill's `bunx @say8425/diffdeck` resolves);
channel 1 works from any local install. The `codex` / `npx skills` subcommands are
young — check `codex plugin --help` / `npx skills --help` for your version.

## Publishing

The package is `@say8425/diffdeck`; `apps/viewer` is the publish root. `@diffdeck/*`
packages are bundled into `dist` at build time, so the published tarball has no
runtime dependencies.

```bash
cd apps/viewer
bun run build           # produces dist/cli.js + dist/viewer/
bun publish --dry-run   # inspect the tarball contents
bun publish             # publish (requires npm auth; run manually)
```

Note: `bun publish --dry-run` still requires local npm auth to be configured
(`npm login` / a valid token) — without it, it errors with "missing
authentication" even though it performs no write to the registry.

Only `dist/` ships (`files: ["dist"]`).
