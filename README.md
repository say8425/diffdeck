# diffdeck

A local diff viewer, built on a vendored fork of Pierre's [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) and [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees).

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-black?style=flat&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#license)

> **Status: Foundation + viewer/server app.** The four forked packages compile, type-check, and render a diff + file tree in the browser (shown below); the viewer and its local diff server now live in `apps/viewer/`. De-preact and the CLI are follow-on work.

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
  trees/        @diffdeck/trees         FileTree engine (preact render skin, for now)
apps/viewer/    diff-server (data API) + browser viewer, built with the css-inline plugin
bin/            diffdeck CLI (in progress)
scripts/        source-map extraction tool, css-inline Bun plugin, render-parity harness
```

Dependency graph: `path-store` (no deps) ← `trees`; `theming` (shiki) ← `diffs`, `trees`. Runtime externals: shiki + `@shikijs/*`, `diff`, `hast-util-to-html`, `lru_map`, and `preact` (in `trees` only).

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun run typecheck   # per-package tsc (mixed preact/react JSX can't share one flat config)
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

| Flag | Description |
|------|-------------|
| `--port <n>` | Port to serve on (default: `$DIFFDECK_PORT` or `49573`) |
| `--no-open` | Do not open a browser automatically (prints the URL) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

Environment: `DIFFDECK_PORT` sets the default port; `DIFFDECK_DISABLE=1` disables the
viewer. The token is cached under `~/.cache/diffdeck/`.

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

Only `dist/` ships (`files: ["dist"]`).
