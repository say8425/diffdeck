# diffdeck

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | 中文 | [Español](README.es.md)

一个本地 diff 查看器，基于 Pierre 的 [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) 和 [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees) 的 vendored fork（内置维护的分支）构建而成。

[![npm](https://img.shields.io/npm/v/%40say8425%2Fdiffdeck?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/@say8425/diffdeck)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-black?style=flat&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#许可证)

![diffdeck 演示 —— 滚动大型 diff、从文件树跳转到文件、点击折叠、应用内搜索、split 视图](demo.gif)

## 这是什么？

diffdeck 最初是内置在 [cc-statusline](https://github.com/say8425/cc-statusline) 中的本地 diff 查看器，现已被拆分为独立产品。相比继续依赖上游的 Pierre 包——它们迭代很快（`@pierre/diffs` 变动频繁；`@pierre/trees` 仍处于 1.0 之前的 beta 阶段），而我们又已经深度耦合了它们的内部标记结构——diffdeck **从这些包的 source map 中还原出原始 TypeScript 并将其 vendor（内置）进来**，从而完全掌握渲染引擎的所有权。

最终形成了一个 Bun workspace monorepo：与框架无关、已高度成熟稳定的 diff 引擎（Pierre 的 `CodeView`，约 27k 行代码）保持原样，而我们自定义的部分则保存在自己的代码中。

## 功能

diff 渲染引擎提供的功能：

- **语法高亮 diff**：通过 [Shiki](https://shiki.style/) 实现，支持 TextMate 主题（浅色 + 深色）。
- **完整的新旧文件 diff**，而非仅有 patch —— 未变更的上下文可以折叠，并可**按需展开**。
- **Unified 与 Split** 两种布局。
- **文件树侧边栏**：带 git 状态徽章、自然排序，并支持 **flatten**（合并单子项目录链）。
- **图片 diff** —— 变更的二进制图片以新旧面板的形式内联渲染。
- **虚拟化渲染**，在大型 diff 下仍保持流畅，并带有粘性（sticky）文件头。
- **每个文件独立的 Shadow DOM 封装**，确保查看器的样式不会泄漏到页面中。

包裹这一引擎的交互式查看器外壳——点击折叠、复制路径、应用内搜索、watch/自动刷新，以及 working-tree 与 base 对比模式——沿用自 [cc-statusline](https://github.com/say8425/cc-statusline) 的查看器，现已移入 diffdeck 的 `apps/viewer/` 中。

![diffdeck 查看器 —— 带 git 状态徽章的文件树、内联图片 diff 与语法高亮 diff](screenshot.png)

## 安装

按需运行 —— 无需安装：

```bash
bunx @say8425/diffdeck
```

或者全局安装以获得 `diffdeck` 命令：

```bash
bun install -g @say8425/diffdeck
```

需要 [Bun](https://bun.sh)；`PATH` 中需包含 `git`（以及用于分支与 base 对比检测的 `gh`）。

## CLI

在任意 git 仓库中运行即可查看其 diff：

```bash
bunx @say8425/diffdeck        # or `diffdeck` if installed globally
```

这将在 `127.0.0.1:49573` 启动一个本地服务器（可通过 `--port` 覆盖），并在浏览器中打开查看器。

选项：

| 参数               | 说明                                                       |
| ------------------ | ---------------------------------------------------------- |
| `--port <n>`        | 监听端口（默认：`$DIFFDECK_PORT` 或 `49573`）               |
| `--no-open`         | 不自动打开浏览器（会打印 URL）                              |
| `--untracked`       | 启动时包含未跟踪文件                                        |
| `--watch`           | 启动时开启 watch（自动刷新）                                |
| `--no-flatten`      | 启动时文件树不进行 flatten（默认开启 flatten）               |
| `--tree-right`      | 启动时文件树显示在右侧                                      |
| `--split`           | 以 split 视图启动（默认是 unified）                          |
| `--hide-tree`       | 启动时隐藏文件树                                            |
| `-h`, `--help`      | 显示帮助                                                    |
| `-v`, `--version`   | 显示版本号                                                  |

这些视图相关的参数只设置本次启动的初始状态——不会更改你已保存的偏好设置，应用内的开关会反映启动时的状态。

环境变量：`DIFFDECK_PORT` 用于设置默认端口。令牌缓存在 `~/.cache/diffdeck/` 下。

## 技能

diffdeck 附带一个 **agent skill**（单个 `skills/diffdeck/SKILL.md` 文件），使 AI 编程 agent 能够在改动更适合“看”而非“读”时，在你的浏览器中打开 diff 查看器。可通过以下任一渠道将其安装到你的 agent 中。

plugin 和 `npx skills` 渠道会从 GitHub 拉取内容，因此需要仓库是**公开的**，并且 diffdeck 已**发布到 npm**（这样 skill 中的 `bunx @say8425/diffdeck` 才能被正确解析）。而自包含的 `diffdeck install-skill` 则可在任意本地安装环境下使用。

### Claude Code

Plugin：

```
/plugin marketplace add say8425/diffdeck
/plugin install diffdeck@diffdeck
```

或使用自包含方式（写入 `~/.claude/skills/diffdeck/`）：

```bash
diffdeck install-skill        # --project installs into the current repo instead
```

### Codex

Plugin：

```
codex plugin marketplace add say8425/diffdeck
codex plugin add diffdeck@diffdeck
```

或使用自包含方式（写入 `~/.claude/skills/diffdeck/` 和 `~/.agents/skills/diffdeck/`）：

```bash
diffdeck install-skill --codex
```

### skills

使用 `skills` CLI 安装到任意[受支持的 agent](https://github.com/vercel-labs/skills) 中：

```bash
npx skills add say8425/diffdeck
```

`codex` / `npx skills` 的相关子命令还比较新——请以你当前版本的 `codex plugin --help` / `npx skills --help` 输出为准。

## 架构

```
packages/
  path-store/   @diffdeck/path-store   pure tree logic (flatten, sort, projection, store)
  theming/      @diffdeck/theming      theme system + 10 vendored shiki theme JSONs
  diffs/        @diffdeck/diffs         CodeView diff-rendering engine
  trees/        @diffdeck/trees         FileTree engine (vanilla render)
apps/viewer/    @say8425/diffdeck — CLI + diff-server (data API) + browser viewer + agent skill
scripts/        source-map extraction tool, css-inline Bun plugin, render-parity harness
```

依赖关系图：`path-store`（无依赖）← `trees`；`theming`（shiki）← `diffs`、`trees`。运行时外部依赖：shiki + `@shikijs/*`、`diff`、`hast-util-to-html`、`lru_map`。

## 开发

需要 [Bun](https://bun.sh)。

```bash
bun install
bun run typecheck   # per-package tsc
bun test
bun run lint        # oxlint
bun run format      # oxfmt
```

### 测试

包含三条测试线：

- `bun test` —— 单元/集成测试，速度快。`*.e2e.ts` 规格文件会被排除在收集范围之外，因此这一步永远不会启动浏览器。
- `bun run test:coverage` —— 同一套测试，并对 **diffdeck 自有的运行时代码**（`apps/viewer/{browser,cli,server}`）施加 **100% 覆盖率门槛**。以下部分被有意排除在门槛之外：vendored 的 `packages/*`、浏览器入口 `main.ts`（属于集成入口——改为由 e2e 套件而非进程内测试来覆盖），以及 `build.ts`。
- `bun run test:e2e` —— 基于 Playwright 的真实浏览器测试套件（`apps/viewer/e2e/`）。通过 `channel: "chrome"` 驱动系统自带的 Google Chrome（无需下载 Chromium），端到端覆盖 `main.ts` 及 vendored 的渲染路径。

### 渲染一致性验证工具

用于确认 fork 出来的 `CodeView` + `FileTree` 确实能够正常渲染：

```bash
bun run scripts/parity/build.ts
cd scripts/parity && python3 -m http.server 8099
# open http://127.0.0.1:8099/index.html
```

## 许可证

**Apache-2.0.** diffdeck 内置了衍生自 Pierre `@pierre/*` 包（Apache-2.0，© The Pierre Computer Company）的源码，并在 `@diffdeck/*` 命名空间下进行了修改。完整的署名和必要的修改声明见 [`NOTICE`](../NOTICE) 及各包的 `LICENSE`。
