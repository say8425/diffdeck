# diffdeck

[English](../README.md) | [한국어](README.ko.md) | 日本語 | [中文](README.zh.md) | [Español](README.es.md)

Pierre の [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs) と [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees) をベンダリングフォークして構築された、ローカル diff ビューアです。

[![npm](https://img.shields.io/npm/v/%40say8425%2Fdiffdeck?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/@say8425/diffdeck)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-black?style=flat&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#ライセンス)

![シンタックスハイライトと折りたたまれたファイルツリーを備えた、大規模なマルチファイル diff をレンダリングする diffdeck](screenshot.png)

## diffdeck とは

diffdeck は、もともと [cc-statusline](https://github.com/say8425/cc-statusline) に組み込まれていたローカル diff ビューアを、独立した製品として切り出したものです。アップストリームの Pierre パッケージ — 変化が激しく(`@pierre/diffs` は頻繁に破壊的変更が入り、`@pierre/trees` はまだ 1.0 未満のベータ版)、しかも内部マークアップにすでに深く依存していた — にそのまま依存し続ける代わりに、diffdeck は **パッケージのソースマップから元の TypeScript を復元してベンダリングし**、レンダリングエンジンを完全に自前で保有しています。

その結果、改変が難しい、フレームワークに依存しない diff エンジン(Pierre の `CodeView`、約 27,000 行)はそのまま維持しつつ、カスタマイズする部分だけを自前のコードに置く、という構成の Bun ワークスペースのモノレポになっています。

## 機能

diff レンダリングエンジンが提供する機能(いずれも上のレンダリング画像で確認できます):

- **シンタックスハイライトされた diff**: [Shiki](https://shiki.style/) による TextMate テーマ(ライト+ダーク)対応。
- **パッチではなく完全な old/new ファイル diff**: 変更のないコンテキストを折りたたみ、**必要に応じて展開**できます。
- **Unified / Split** レイアウト。
- **ファイルツリーサイドバー**: git ステータスバッジ、自然順ソート、**flatten**(単一子フォルダの連鎖を圧縮)に対応。
- **画像 diff** — 変更されたバイナリ画像を old/new パネル付きでインライン表示。
- **仮想化レンダリング**: 大規模な diff でもスムーズに動作し、ファイルヘッダーは sticky。
- **ファイル単位の Shadow DOM カプセル化**: ビューアのスタイルがページに漏れ出すことはありません。

このエンジンをラップするインタラクティブなビューア chrome — クリックでの折りたたみ、パスのコピー、アプリ内検索、watch(自動更新)、working-tree-vs-base モード — は [cc-statusline](https://github.com/say8425/cc-statusline) のビューアに由来し、現在は diffdeck の `apps/viewer/` に置かれています。

## インストール

インストール不要で、その場で実行できます:

```bash
bunx @say8425/diffdeck
```

または、グローバルにインストールして `diffdeck` コマンドを使うこともできます:

```bash
bun install -g @say8425/diffdeck
```

[Bun](https://bun.sh) が必要です。また `PATH` 上に `git`(branch-vs-base 検出には `gh` も)が必要です。

## CLI

任意の git リポジトリ内で実行すると、その diff を表示できます:

```bash
bunx @say8425/diffdeck        # or `diffdeck` if installed globally
```

これにより `127.0.0.1:49573` にローカルサーバーが起動し(`--port` で変更可能)、ブラウザでビューアが開きます。

オプション:

| フラグ | 説明 |
| --- | --- |
| `--port <n>` | 待ち受けポート(デフォルト: `$DIFFDECK_PORT` または `49573`) |
| `--no-open` | ブラウザを自動的に開かない(URL を表示) |
| `--untracked` | 未追跡ファイルを含めた状態で開始 |
| `--watch` | watch(自動更新)を有効にした状態で開始 |
| `--no-flatten` | ファイルツリーを未flatten状態で開始(flatten はデフォルトで有効) |
| `--tree-right` | ファイルツリーを右側に配置した状態で開始 |
| `--split` | split ビューで開始(デフォルトは unified) |
| `-h`, `--help` | ヘルプを表示 |
| `-v`, `--version` | バージョンを表示 |

これらの表示フラグは、この起動時のみの初期状態を設定するものです — 保存済みの設定を変更するわけではなく、アプリ内のトグルは起動時の状態をそのまま反映します。

環境変数: `DIFFDECK_PORT` でデフォルトポートを設定できます。トークンは `~/.cache/diffdeck/` にキャッシュされます。

## スキル

diffdeck は **エージェントスキル**(単一の `skills/diffdeck/SKILL.md`)を同梱しており、変更内容が読むより見た方が分かりやすい場合に、AI コーディングエージェントがブラウザで diff ビューアを開けるようになります。以下のいずれかの方法でエージェントにインストールしてください。

plugin および `npx skills` の経路は GitHub から取得するため、リポジトリが **public** であること、かつ diffdeck が **npm に公開されている** こと(スキル内の `bunx @say8425/diffdeck` が解決できるように)が必要です。自己完結型の `diffdeck install-skill` は、任意のローカルインストールから動作します。

### Claude Code

プラグイン:

```
/plugin marketplace add say8425/diffdeck
/plugin install diffdeck@diffdeck
```

または、自己完結型(`~/.claude/skills/diffdeck/` に書き込み):

```bash
diffdeck install-skill        # --project installs into the current repo instead
```

### Codex

プラグイン:

```
codex plugin marketplace add say8425/diffdeck
codex plugin add diffdeck@diffdeck
```

または、自己完結型(`~/.agents/skills/diffdeck/` に書き込み):

```bash
diffdeck install-skill --codex
```

### skills

`skills` CLI を使って、[対応する任意のエージェント](https://github.com/vercel-labs/skills) にインストールできます:

```bash
npx skills add say8425/diffdeck
```

`codex` / `npx skills` のサブコマンドはまだ新しいため、お使いのバージョンで `codex plugin --help` / `npx skills --help` を確認してください。

## アーキテクチャ

```
packages/
  path-store/   @diffdeck/path-store   pure tree logic (flatten, sort, projection, store)
  theming/      @diffdeck/theming      theme system + 10 vendored shiki theme JSONs
  diffs/        @diffdeck/diffs         CodeView diff-rendering engine
  trees/        @diffdeck/trees         FileTree engine (vanilla render)
apps/viewer/    @say8425/diffdeck — CLI + diff-server (data API) + browser viewer + agent skill
scripts/        source-map extraction tool, css-inline Bun plugin, render-parity harness
```

依存関係グラフ: `path-store`(依存なし)← `trees`、`theming`(shiki)← `diffs`, `trees`。ランタイムの外部依存: shiki + `@shikijs/*`、`diff`、`hast-util-to-html`、`lru_map`。

## 開発

[Bun](https://bun.sh) が必要です。

```bash
bun install
bun run typecheck   # per-package tsc
bun test
bun run lint        # oxlint
bun run format      # oxfmt
```

### テスト

3つのレーンがあります:

- `bun test` — ユニット/統合テスト、高速。`*.e2e.ts` の spec は収集対象から除外されるため、ブラウザは起動しません。
- `bun run test:coverage` — 同じテストスイートに、**diffdeck が所有するランタイムコード(`apps/viewer/{browser,cli,server}`)への 100% カバレッジゲート** を加えたもの。意図的にゲート対象外としているのは、ベンダリングされた `packages/*`、ブラウザエントリの `main.ts`(統合エントリ — インプロセスではなく e2e スイートで代わりに検証)、そして `build.ts` です。
- `bun run test:e2e` — Playwright による実ブラウザスイート(`apps/viewer/e2e/`)。`channel: "chrome"` 経由でシステムの Google Chrome を操作し(Chromium のダウンロードは不要)、`main.ts` とベンダリングされたレンダリングパスをエンドツーエンドでカバーします。

### レンダーパリティハーネス

上のスクリーンショットを再現し、フォークした `CodeView` + `FileTree` が実際にレンダリングされることを確認します:

```bash
bun run scripts/parity/build.ts
cd scripts/parity && python3 -m http.server 8099
# open http://127.0.0.1:8099/index.html
```

## ライセンス

**Apache-2.0** — 詳細は [`NOTICE`](../NOTICE) と各パッケージの `LICENSE` ファイルを参照してください。

diffdeck は、以下のパッケージ(すべて **Apache-2.0** ライセンス)から **復元・派生させた** ソースをバンドルしています:

- `@pierre/diffs`、`@pierre/trees`、`@pierre/theming`、`@pierre/theme` — Copyright The Pierre Computer Company.

`packages/` 配下のファイルはオリジナルから変更が加えられています(import パスは `@diffdeck/*` 名前空間に書き換え、型宣言はソースマップに存在しない箇所を再構築)。各パッケージはアップストリームの `LICENSE` を保持し、`packages/trees/NOTICE.md` は `@headless-tree/core`(MIT)のクレジット表記を保持しています。そしてトップレベルの [`NOTICE`](../NOTICE) が、Apache-2.0 ライセンスの要件に従って、由来と変更の事実を記録しています。
