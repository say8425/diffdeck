# diffdeck

[English](../README.md) | 한국어 | [日本語](README.ja.md) | [中文](README.zh.md) | [Español](README.es.md)

Pierre의 [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs)와 [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees)를 vendored fork한 로컬 diff 뷰어입니다.

[![npm](https://img.shields.io/npm/v/%40say8425%2Fdiffdeck?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/@say8425/diffdeck)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-black?style=flat&logo=bun)](https://bun.sh)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#라이선스)

![구문 강조와 깊이 있게 flatten된 파일 트리로 대규모 멀티파일 diff를 렌더링하는 diffdeck](screenshot.png)

## diffdeck란?

diffdeck는 원래 [cc-statusline](https://github.com/say8425/cc-statusline)에 내장되어 있던 로컬 diff 뷰어를 별도 제품으로 분리한 것입니다. 빠르게 변화하는(`@pierre/diffs`는 변경이 잦고, `@pierre/trees`는 아직 1.0 이전 베타 단계입니다) 업스트림 Pierre 패키지에 의존하는 대신 — 게다가 내부 마크업에 이미 깊이 결합되어 있었기 때문에 — diffdeck는 **패키지의 소스맵에서 원본 TypeScript를 복원해 vendoring**해서, 렌더링 엔진을 완전히 직접 소유합니다.

그 결과 구현하기 어려운, 프레임워크에 종속되지 않는 diff 엔진(Pierre의 `CodeView`, 약 27,000줄)은 그대로 유지하고, 우리가 커스터마이즈하는 부분만 자체 코드에 두는 Bun 워크스페이스 모노레포 구조가 되었습니다.

## 기능

diff 렌더링 엔진이 제공하는 기능(모두 위 렌더링 결과에서 확인할 수 있습니다):

- **구문 강조된 diff**: [Shiki](https://shiki.style/) 기반, TextMate 테마 사용(라이트 + 다크).
- **패치가 아닌 전체 old/new 파일 diff** — 변경되지 않은 컨텍스트를 접을 수 있고 필요할 때 **펼칠 수 있습니다**.
- **Unified 및 Split** 레이아웃.
- git 상태 배지, natural sort, **flatten**(단일 자식 폴더 체인을 압축)을 지원하는 **파일 트리 사이드바**.
- **이미지 diff** — 변경된 바이너리 이미지가 old/new 패널과 함께 인라인으로 렌더링됩니다.
- 큰 diff에서도 부드럽게 동작하는 **가상화 렌더링**, sticky 파일 헤더 포함.
- 파일마다 적용되는 **shadow DOM 캡슐화**로 뷰어 스타일이 페이지로 새어나가지 않습니다.

이 엔진을 감싸는 인터랙티브 뷰어 chrome — 클릭으로 접기, 경로 복사, 인앱 검색, watch/자동 새로고침, working-tree-vs-base 모드 — 는 [cc-statusline](https://github.com/say8425/cc-statusline) 뷰어에서 왔으며, 현재는 diffdeck의 `apps/viewer/`에 있습니다.

## 설치

설치 없이 바로 실행할 수 있습니다:

```bash
bunx @say8425/diffdeck
```

또는 전역 설치해서 `diffdeck` 명령을 사용할 수도 있습니다:

```bash
bun install -g @say8425/diffdeck
```

[Bun](https://bun.sh)이 필요하며, `PATH`에 `git`(branch-vs-base 감지를 위한 `gh` 포함)이 있어야 합니다.

## CLI

git 저장소 어디서든 실행하면 diff를 볼 수 있습니다:

```bash
bunx @say8425/diffdeck        # or `diffdeck` if installed globally
```

`127.0.0.1:49573`(`--port`로 재정의 가능)에 로컬 서버를 띄우고 뷰어를 브라우저에서 엽니다.

옵션:

| Flag               | 설명                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `--port <n>`        | 서빙할 포트 (기본값: `$DIFFDECK_PORT` 또는 `49573`)                 |
| `--no-open`         | 브라우저를 자동으로 열지 않음(URL을 출력)                          |
| `--untracked`       | untracked 파일을 포함한 상태로 시작                                |
| `--watch`           | watch(자동 새로고침)를 켠 상태로 시작                               |
| `--no-flatten`      | 파일 트리를 flatten하지 않은 상태로 시작(flatten은 기본적으로 켜져 있음) |
| `--tree-right`      | 파일 트리를 오른쪽에 둔 상태로 시작                                 |
| `--split`           | split 뷰로 시작(unified가 기본값)                                  |
| `-h`, `--help`      | 도움말 표시                                                        |
| `-v`, `--version`   | 버전 표시                                                          |

이 뷰 플래그들은 이번 실행에서만 초기 상태를 설정합니다 — 저장된 설정을 바꾸지 않으며, 인앱 토글은 실행된 상태를 그대로 반영합니다.

환경 변수: `DIFFDECK_PORT`로 기본 포트를 설정합니다. 토큰은 `~/.cache/diffdeck/`에 캐시됩니다.

## 스킬

diffdeck는 **agent skill**(단일 `skills/diffdeck/SKILL.md`)을 함께 제공해서, 변경 사항을 읽기보다 눈으로 보는 게 더 나을 때 AI 코딩 에이전트가 브라우저에서 diff 뷰어를 열 수 있게 합니다. 아래 채널 중 하나를 통해 에이전트에 설치하세요.

plugin과 `npx skills` 채널은 GitHub에서 가져오므로 저장소가 **public**이어야 하고 diffdeck가 **npm에 게시**되어 있어야 합니다(스킬의 `bunx @say8425/diffdeck`가 정상적으로 resolve되려면). 자체 완결형인 `diffdeck install-skill`은 로컬에 설치된 어떤 환경에서도 동작합니다.

### Claude Code

플러그인:

```
/plugin marketplace add say8425/diffdeck
/plugin install diffdeck@diffdeck
```

또는 자체 완결형(`~/.claude/skills/diffdeck/`에 기록):

```bash
diffdeck install-skill        # --project installs into the current repo instead
```

### Codex

플러그인:

```
codex plugin marketplace add say8425/diffdeck
codex plugin add diffdeck@diffdeck
```

또는 자체 완결형(`~/.agents/skills/diffdeck/`에 기록):

```bash
diffdeck install-skill --codex
```

### skills

`skills` CLI로 [지원되는 모든 에이전트](https://github.com/vercel-labs/skills)에 설치할 수 있습니다:

```bash
npx skills add say8425/diffdeck
```

`codex` / `npx skills` 서브커맨드는 아직 초기 단계입니다 — 사용 중인 버전의 `codex plugin --help` / `npx skills --help`를 확인하세요.

## 아키텍처

```
packages/
  path-store/   @diffdeck/path-store   pure tree logic (flatten, sort, projection, store)
  theming/      @diffdeck/theming      theme system + 10 vendored shiki theme JSONs
  diffs/        @diffdeck/diffs         CodeView diff-rendering engine
  trees/        @diffdeck/trees         FileTree engine (vanilla render)
apps/viewer/    @say8425/diffdeck — CLI + diff-server (data API) + browser viewer + agent skill
scripts/        source-map extraction tool, css-inline Bun plugin, render-parity harness
```

의존성 그래프: `path-store`(의존성 없음) ← `trees`; `theming`(shiki) ← `diffs`, `trees`. 런타임 외부 의존성: shiki + `@shikijs/*`, `diff`, `hast-util-to-html`, `lru_map`.

## 개발

[Bun](https://bun.sh)이 필요합니다.

```bash
bun install
bun run typecheck   # per-package tsc
bun test
bun run lint        # oxlint
bun run format      # oxfmt
```

### 테스트

세 가지 레인으로 구성됩니다:

- `bun test` — 단위/통합 테스트, 빠릅니다. `*.e2e.ts` 스펙은 수집 대상에서 제외되므로 브라우저를 절대 띄우지 않습니다.
- `bun run test:coverage` — 동일한 스위트를 실행하되 **diffdeck가 직접 소유한 런타임 코드**(`apps/viewer/{browser,cli,server}`)에 대해 **100% 커버리지 게이트**를 적용합니다. 게이트에서 의도적으로 제외된 것: vendoring된 `packages/*`, 브라우저 엔트리 `main.ts`(통합 엔트리 — in-process가 아니라 e2e 스위트로 검증됨), `build.ts`.
- `bun run test:e2e` — Playwright 실제 브라우저 스위트(`apps/viewer/e2e/`)입니다. `channel: "chrome"`로 시스템에 설치된 Google Chrome을 구동하며(Chromium 다운로드 없음), `main.ts`와 vendoring된 렌더링 경로를 엔드투엔드로 커버합니다.

### 렌더 패리티 하네스

위 스크린샷을 재현합니다 — 포크된 `CodeView` + `FileTree`가 실제로 렌더링되는지 확인합니다:

```bash
bun run scripts/parity/build.ts
cd scripts/parity && python3 -m http.server 8099
# open http://127.0.0.1:8099/index.html
```

## 라이선스

**Apache-2.0** — [`NOTICE`](../NOTICE)와 각 패키지의 `LICENSE` 파일을 참고하세요.

diffdeck는 다음 패키지들에서 **복원하고 파생시킨** 소스를 번들로 포함하며, 모두 **Apache-2.0** 라이선스입니다:

- `@pierre/diffs`, `@pierre/trees`, `@pierre/theming`, `@pierre/theme` — Copyright The Pierre Computer Company.

`packages/` 아래 파일들은 원본에서 수정되었습니다(import 경로를 `@diffdeck/*` 네임스페이스로 재작성; 소스맵에 없는 타입 선언은 재구성). 각 패키지는 업스트림 `LICENSE`를 그대로 유지하고, `packages/trees/NOTICE.md`는 `@headless-tree/core`(MIT) 저작자 표시를 유지하며, 최상위 [`NOTICE`](../NOTICE)는 Apache-2.0 라이선스가 요구하는 대로 출처와 수정 사실을 기록합니다.
