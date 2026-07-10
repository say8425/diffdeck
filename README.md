# diffdeck

A local diff viewer, built on a vendored fork of Pierre's [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) and [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees).

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-black?style=flat&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#license)

> **Status: Foundation.** The four forked packages compile, type-check, and render a diff + file tree in the browser. The viewer/server app, de-preact, and CLI are tracked as follow-on work (see [Roadmap](#roadmap)).

## What is this?

diffdeck is the local diff viewer originally embedded in [cc-statusline](https://github.com/say8425/cc-statusline), extracted into its own product. Instead of depending on the upstream Pierre packages — which move fast (`@pierre/diffs` churns heavily; `@pierre/trees` is pre-1.0 beta) and whose internal markup we had already coupled to heavily — diffdeck **recovers the original TypeScript from the packages' source maps and vendors it**, so we own the rendering engine outright.

The result is a Bun-workspace monorepo where a commodity-hard, framework-agnostic diff engine (Pierre's `CodeView`, ~27k lines) is kept as-is, while the parts we customize live in our own code.

## Architecture

```
packages/
  path-store/   @diffdeck/path-store   pure tree logic (flatten, sort, projection, store)
  theming/      @diffdeck/theming      theme system + 10 vendored shiki theme JSONs
  diffs/        @diffdeck/diffs         CodeView diff-rendering engine
  trees/        @diffdeck/trees         FileTree engine (preact render skin, for now)
apps/           viewer + server app (Roadmap: Plan 2)
bin/            diffdeck CLI (Roadmap: Plan 5)
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

Confirms the forked `CodeView` + `FileTree` actually render:

```bash
bun run scripts/parity/build.ts
cd scripts/parity && python3 -m http.server 8099
# open http://127.0.0.1:8099/index.html
```

## Roadmap

| Plan | Scope | Status |
| ---- | ----- | ------ |
| 1 — Foundation | Fork the four packages from source maps; type-check + render parity | ✅ Done |
| 2 — Viewer + server app | Migrate cc-statusline's `viewer`/`diff-server` into `apps/` | Planned |
| 3 — De-preact | Port `trees`' preact render skin to vanilla; drop preact | Planned |
| 4 — Coupling hardening | Promote internal markup to a stable contract; unify sort; canary tests | Planned |
| 5 — CLI + cutover | `bin/diffdeck.ts`, publish `@say8425/diffdeck`, cc-statusline switches to `bunx` | Planned |

## Provenance & License

diffdeck bundles source **recovered from and derived from** the following packages, all licensed **Apache-2.0**:

- `@pierre/diffs`, `@pierre/trees`, `@pierre/theming`, `@pierre/theme` — Copyright The Pierre Computer Company.

Files under `packages/` are modified from the originals (import paths rewritten to the `@diffdeck/*` namespace; type declarations reconstructed where absent from source maps). Each package retains its upstream `LICENSE`, `packages/trees/NOTICE.md` retains the `@headless-tree/core` (MIT) attribution, and the top-level [`NOTICE`](./NOTICE) records the provenance and the fact of modification, as required by the Apache-2.0 license.

## License

Apache-2.0. See [`NOTICE`](./NOTICE) and the per-package `LICENSE` files.
