# diffdeck

로컬 diff 뷰어 (Bun/TypeScript 모노레포). `@pierre/diffs`·`@pierre/trees`를 소스맵에서 복원해 vendored 포크한 렌더링 엔진 기반.

## WHAT

```
diffdeck/
├── packages/               # 포크한 pierre 패키지 (vendored, npm 설치 안 함)
│   ├── path-store/         # @diffdeck/path-store — 트리 순수 로직 (flatten·sort·projection·store), 18 src, deps 없음
│   ├── theming/            # @diffdeck/theming — 테마 시스템 + 테마 데이터, 15 src + themes/*.json 10개
│   ├── diffs/              # @diffdeck/diffs — CodeView diff 렌더 엔진, 170 src (CodeView.ts 3,563줄)
│   └── trees/              # @diffdeck/trees — FileTree 엔진, 52 src (preact 렌더 스킨 포함)
├── apps/
│   └── viewer/             # @diffdeck/viewer — server/(데이터 API) + browser/(뷰어 프론트) + build.ts·serve.ts
├── bin/                    # (Plan 5) diffdeck CLI 엔트리 예정
├── scripts/
│   ├── extract-sources.ts       # 소스맵 sourcesContent → 원본 TS 복원 도구 (Foundation 일회성)
│   ├── extract-sources.test.ts  # 합성 소스맵 fixture로 hermetic (외부 체크아웃 의존 없음)
│   ├── css-inline-plugin.ts     # *.css?inline import용 Bun 플러그인 (런타임/번들러 2분리)
│   └── parity/                  # 포크 렌더 패리티 하니스 (fixture·smoke test·main·build)
├── tsconfig.base.json      # 공유 base (jsxImportSource: preact, @diffdeck/* path alias)
├── .oxlintrc.json / .oxfmtrc.json
├── NOTICE                  # pierre (Apache-2.0) 유래 고지
└── package.json            # Bun workspace 루트 (workspaces: packages/*, apps/*)
```

**기술 스택**: Bun (런타임·번들·테스트·workspace), TypeScript 6, oxlint/oxfmt

**패키지 의존 그래프**:

- `path-store` → (없음)
- `theming` → shiki, @shikijs/themes
- `diffs` → theming, shiki, @shikijs/transformers, diff, hast-util-to-html, lru_map
- `trees` → path-store, theming, **preact**, preact-render-to-string

**포크 provenance**: 원본 `@pierre/*`의 dist `.js.map` `sourcesContent`에 주석 포함 원본 TS가 전량 존재 → `scripts/extract-sources.ts`로 복원 후 `@pierre/*` import를 `@diffdeck/*`로 rewrite. `@pierre/path-store`는 npm 미배포지만 trees dist에 번들되어 함께 복원됨. `@pierre/theme`(테마 데이터)는 코드가 아니라 shiki 테마 JSON 10개라 `theming/themes/`에 그대로 vendored. 전부 Apache-2.0.

## WHY

cc-statusline에 포함됐던 로컬 diff 뷰어를 독립 제품으로 분리 + pierre 포크:

1. **업스트림 리스크** — `@pierre/diffs`는 churn이 크고(7개월 84버전), `@pierre/trees`는 pre-1.0 beta라 내부 마크업이 정당하게 바뀔 수 있음.
2. **이미 많이 개조** — 헤더 폴드·복사 버튼·이미지 카드·인앱 검색·flatten UX를 pierre 내부 마크업(shadow DOM data 속성·sprite id)에 결합해 얹어 씀.

→ 소스 복원해 vendored 포크, 업스트림과 완전 결별. 내부 마크업 결합을 diffdeck 자체의 안정 계약으로 승격.

뷰어 토글(untracked 포함·watch 자동갱신·flatten·파일트리 좌우·unified/split·파일트리 숨김·트리 접기 동기화)은 `--untracked`/`--watch`/`--no-flatten`/`--tree-right`/`--split`/`--hide-tree`/`--fold-with-tree` CLI 플래그로 구동 시점에 미리 설정할 수 있다(session-only — 저장된 localStorage 프리퍼런스는 건드리지 않음). 인앱 토글의 초기 표시 상태는 항상 실제 launch 값과 일치하도록 sync되며, 우선순위 계산(URL 파라미터 → localStorage → 기본값)은 `apps/viewer/browser/prefs.ts`의 순수 resolver 함수(`resolveUntracked`/`resolveWatch`/`resolveFlatten`/`resolveTreeSide`/`resolveDiffStyle`/`resolveTreeHidden`/`resolveFoldWithTree`)로 분리해 단위 테스트한다. 파일트리 숨김은 `localStorage` 폴백이 없는 session-only 토글(`resolveUntracked`와 동일 패턴)로, 툴바 아이콘 버튼(`#tree-toggle-btn`)과 오버플로 메뉴 체크박스(`#toggle-tree-hidden`) 둘 다에서 조작 가능하며 항상 서로 동기화된다. 사이드바에서 디렉토리를 접으면 diff 화면의 해당 파일들도 자동으로 접히는 "Fold with tree" 토글은 `flatten`/`treeSide`와 동일하게 `localStorage`(`cc-statusline:fold-with-tree`)에 영속화되며, 오버플로 메뉴 체크박스(`#toggle-fold-with-tree`)로만 조작한다(전용 툴바 버튼 없음). 트리에서 접힌 디렉토리 아래 파일을 diff 헤더 클릭으로 개별 펼치면 그 파일은 사용자가 다시 접기 전까지(토글 on/off와 무관하게) 계속 펼쳐진 채 유지된다.

설계·조사 근거(요약): CodeView는 이미 프레임워크 무관 vanilla 27k줄 엔진(faithful 재작성 4~8개월, 이득 0 → 재작성 금지). 혼합 기술은 얕음 — vanilla가 아닌 건 trees 렌더 스킨의 preact 6파일뿐. 대체 라이브러리 조사 결과 pierre 품질 대체재 없음.

## HOW

### 개발

```bash
bun install
bun run typecheck   # 4패키지 각자 tsconfig로 (혼합 JSX라 flat 불가 — 패키지별 루프)
bun test
bun run lint
bun run format
```

### 테스트 3레인

- `bun test` — 유닛·통합, 빠름. `apps/viewer/e2e/*.e2e.ts`는 collection에서 제외되므로 이 커맨드로는 브라우저가 뜨지 않는다.
- `bun run test:coverage` — 같은 스위트를 `--coverage`로 실행 + **diffdeck 소유 런타임 코드(`apps/viewer/{browser,cli,server}`) 100% 커버리지 게이트**(`bunfig.toml`의 `coverageThreshold`/`coveragePathIgnorePatterns`). 게이트 제외 대상: vendored `packages/*`, `scripts/**`, browser 엔트리 `main.ts`(in-process 유닛 테스트 대신 e2e로 커버), `build.ts`, 그리고 `*.test.ts`/`e2e/**` 자신.
- `bun run test:e2e` — `apps/viewer/e2e/*.e2e.ts` Playwright 실브라우저 스위트. `playwright.config.ts`가 `channel:"chrome"`으로 시스템 Google Chrome을 구동(Chromium 별도 다운로드 없음), `globalSetup`이 `build.ts`를 1회 실행해 실제 `dist/cli.js`를 스폰. `main.ts`와 vendored 렌더 경로(fold·copy-path·find·flags-sync·image-diff 등)를 end-to-end로 커버. fixtures(`apps/viewer/e2e/fixtures/`: 임시 git repo 빌더 `repo.ts`, CLI 스폰 `launchViewer` `app.ts`, Node `child_process` 래퍼 `proc.ts`)는 **Node**로 동작 — Playwright Test는 항상 spec·fixture·globalSetup을 Node로 실행하므로(`bunx playwright test`로 띄워도) `Bun` 글로벌·`bun`의 `$` 셸을 못 쓰고 `spawn`으로 실제 `bun` 바이너리를 PATH에서 호출한다. `apps/viewer/e2e/tsconfig.json`이 루트 `typecheck` 스크립트에 배선되어 있다.
- **`*.e2e.ts` 네이밍 규칙**: `bun test`는 `*.test.ts` 외에 `*.spec.ts`도 수집하므로, Playwright 스펙을 `*.e2e.ts`로 명명해 `bun test`가 절대 이를 실행하지 않도록 분리한다(Playwright 쪽은 `testMatch:"**/*.e2e.ts"`로 반대로 한정).

### 기여 워크플로 (PR 필수)

- **`main`에 직접 push 금지 — 모든 변경은 브랜치 → PR로 진행한다.** (초기 extraction 시기의 main 직접 push 관례는 종료. 이미 배포·CI가 붙은 상태라 PR 리뷰를 거친다.) 브랜치를 파고 PR을 열면 `pr-check` CI(lint/format/typecheck/test/coverage)가 돌고, 사람이 리뷰·머지한다.
- 커밋 메시지는 **Conventional Commits**(`feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:`/`ci:` …) — release-please가 이를 근거로 버전·CHANGELOG·릴리스를 관리하기 때문(`feat:`→minor, `fix:`→patch, `feat!:`/`BREAKING CHANGE:`→major; `docs`/`chore`/`test`/`ci` 등은 릴리스 미유발).

### CI / 릴리스

- **`.github/workflows/pr-check.yml`** — PR마다 lint(oxlint)·format:check(oxfmt)·typecheck·test·coverage(100% 게이트) 잡. `bun install --frozen-lockfile`.
- **lint 스코프**: 스크립트는 `oxlint apps/`/`oxfmt apps/`로 **owned 코드만** 대상(vendored `packages/*`는 Pierre 원본 스타일이라 lint/format 게이트 제외). `.oxlintrc.json`의 `typeAware:true` 때문에 `oxlint-tsgolint`(devDep)가 있어야 lint가 돈다. 테스트/e2e override(`**/__tests__/**`·`**/e2e/**`)에서 unbound-method·no-empty-pattern·no-unassigned-import 등 완화.
- **`.github/workflows/release.yml` + `release-please-config.json` + `.release-please-manifest.json`** — release-please(모노레포: 배포 패키지 `apps/viewer`, `package-name @say8425/diffdeck`)가 conventional commits로 **릴리스 PR을 생성**하고, **사람이 그 PR을 머지**하면 release-please가 릴리스·태그를 커팅 → `releases_created == 'true'` 일 때 publish 잡이 `apps/viewer`에서 `bun run build` + `npm publish --provenance --access public`.
- **릴리스 PR은 자동머지하지 않는다(의도적)**: 릴리스 = npm 배포이므로 사람의 리뷰 게이트를 둔다. 부수 효과로 `GITHUB_TOKEN` 재귀 방지 문제도 회피된다 — GITHUB_TOKEN이 만든 push는 워크플로를 재트리거하지 않으므로 릴리스 PR을 자동머지했다면 publish가 조용히 영영 안 돌았을 것이다. 사람이 머지하면 사용자 토큰이라 Release가 정상 트리거된다.
- **게이트는 반드시 `== 'true'` 비교**: release-please-action은 아무것도 안 만들어도 `releases_created`/`prs_created`에 **문자열 `"false"`** 를 내보내는데, GHA는 비어있지 않은 문자열을 truthy로 취급한다. `if: ${{ ...release_created }}` 같은 bare truthy는 항상 통과해 publish가 오발한다(실제로 run 29477773636에서 발생 — main이 0.1.0인데 publish가 돌아 중복 버전으로 실패).
- **publish 인증 = trusted publishing(OIDC, tokenless)**: publish 잡에 `NODE_AUTH_TOKEN` 없음 — npm CLI가 OIDC 환경(`id-token: write`)을 감지해 npmjs.com에 등록된 trusted publisher(org say8425/repo diffdeck/workflow release.yml)로 인증. 요건: **Node ≥ 22.14.0(워크플로는 24) + npm ≥ 11.5.1(`npm install -g npm@latest`)**. (0.1.0은 npm의 first-publish OIDC 부재(npm/cli#8544) 때문에 최초 1회 수동 토큰 publish로 부트스트랩됨.)
- **사용자 게이트(부트스트랩, 자동화 불가)**: npm은 신규 패키지 최초 버전을 OIDC로 못 올린다(설정 UI가 패키지 존재를 요구, npm/cli #8544). 따라서 순서: ① `0.1.0`을 **로컬에서 토큰/`npm login`으로 1회 수동 publish**(패키지 생성) → ② npmjs.com 패키지 Settings에서 trusted publisher 등록(org `say8425`, repo `diffdeck`, workflow `release.yml`, environment 없음) → ③ 이후 release-please가 낸 릴리스 PR을 사람이 머지하면 CI가 tokenless로 publish. provenance엔 public repo 필요(✅).
- **저장소 설정 요구사항**: Settings → Actions → General → Workflow permissions의 **"Allow GitHub Actions to create and approve pull requests"** 가 켜져 있어야 한다(기본 OFF). 꺼져 있으면 release-please가 버전 계산·브랜치·커밋까지 다 만들어놓고 **PR 생성 단계에서만** `GitHub Actions is not permitted to create or approve pull requests` 로 실패한다. API로는 `gh api -X PUT repos/say8425/diffdeck/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`.
- **배포 산출물**: `build.ts`가 `dist/cli.js`에 `#!/usr/bin/env bun` 셰뱅 + 실행권한을 부여해 `bunx`뿐 아니라 `npx`/직접 실행에서도 bun으로 구동된다(`// @bun` 마커는 셰뱅 다음 줄에 유지).

### 렌더 패리티 하니스

포크한 CodeView+FileTree가 실제 렌더되는지 확인:

```bash
bun run scripts/parity/build.ts                 # css-inline 플러그인으로 번들
cd scripts/parity && python3 -m http.server 8099 # http://127.0.0.1:8099/index.html
```

### 수정 시 주의사항

- **CodeView(diffs) 재작성 금지** — 27k줄 vendored 엔진을 blackbox로 사용. 가상화·shiki 스트리밍·shadow DOM 등 상용급 난이도, 재작성 이득 없음.
- **포크 패키지는 import 경로 + 재구성 타입만 수정** — 렌더/로직 변경 금지 (Foundation 원칙). 오버홀은 별도 plan에서. 예외는 건별 합의 + `[diffdeck]` 주석으로 upstream 이탈을 코드에 표기 + e2e 회귀망 동반일 때만. 현재 예외 2건 (둘 다 `packages/diffs`):
  1. `DiffHunksRenderer.recycle()`의 하이라이터 동기 재획득 — 빠른 스크롤 headerless blink 완치 (`header-mount.e2e.ts` 극한 프로브가 회귀망).
  2. 빈 렌더 윈도우(totalLines 0 = collapsed) 렌더를 plain-text + zero-range로 — 하이라이트 렌더가 범위를 무시하고 전체 파일을 동기 토크나이즈해 대형 lockfile 마운트가 수 초 프리징하던 것 완치. `renderDiff` sync/async 두 경로 + `RenderedDiffASTCache.emptyWindow` 표식(빈 풀을 확장 렌더가 재사용하면 processDiffResult가 throw — 표식이 확장 시 재렌더를 강제). 회귀망: `lockfile-freeze.e2e.ts` (30k줄 프리징 게이트 + 8k줄 sub-cutoff 펼침 무오류).
- **JSX 설정**: `tsconfig.base.json`은 preact JSX. diffs는 패키지 tsconfig에서 react로 override(react 어댑터 때문), trees는 per-file `@jsxImportSource` pragma 사용. 그래서 루트 typecheck는 flat이 아니라 패키지별 루프.
- **외부 deps는 정확 버전 핀** (캐럿 금지). vendored 패키지는 workspace 내부.
- **preact는 trees에만** — Plan 3(de-preact)에서 vanilla로 포팅 후 제거 예정.
- **react는 하드 런타임 의존 아님** — diffs/trees의 미사용 react 어댑터용 devDep/optional peer. 데드코드는 후속 plan에서 제거.
- **라이선스**: 각 `packages/*/LICENSE`(Apache-2.0) + `packages/trees/NOTICE.md`(headless-tree MIT 유래) + 최상위 `NOTICE` 보존. 파일 수정 사실 고지 유지.
- **`*.css?inline` ambient 선언**: 소비자(앱)의 tsconfig가 패키지 `src/**`를 glob include하지 않으면 안 보임 — Plan 2 앱 tsconfig에서 배선 필요.
- **cc-statusline 잔재 데드코드 제거됨**: `server/ensure.ts`(spawn-if-not-running 데몬 ensure)와 `server.ts`의 `idleTimeoutMs` idle-shutdown을 제거했다. diffdeck의 CLI는 서버를 **foreground**로 띄워 Ctrl+C로 종료하는 모델이라(cc-statusline처럼 statusline이 백그라운드 데몬을 spawn-if-not-running으로 관리하는 구조가 아님) 두 기능 모두 미사용 상태였다.

### 로드맵 (각각 별도 sub-plan)

- **Plan 1 — Foundation** ✅: 4패키지 포크, 타입체크·렌더 검증.
- **Plan 2 — viewer + server 앱** ✅: `apps/viewer`로 이관(server/·browser/), 14 유닛 테스트 + 빌드-번들 서빙 통합 테스트로 동등성 검증. browser/는 vendored JSX 벽 때문에 typecheck 루프 제외(패리티 하니스와 동일, Plan 4/5서 선언 기반으로 해소).
- **Plan 3 — de-preact 실용판**: trees preact 6파일 → vanilla (가상화·DnD·rename·sticky·SSR 제외, read-only 대응), preact 제거.
- **Plan 4 — 커플링 하드닝**: 내부 마크업 계약화, 정렬 comparator 단일화, canary 테스트, 상수 export. **헤더 깜박임은 완치됨**(Foundation 예외를 적용한 첫 vendored 로직 수정): `DiffHunksRenderer.recycle()`이 하이라이터를 무조건 버려(`highlighter = undefined`) 재마운트 때 `renderDiff()`가 null을 반환 → `FileDiff.render()`가 헤더 적용 전에 탈출 → 헤더 없는 0-height 프레임이었는데, recycle()이 생성자(`:228-232`)와 동일 조건으로 `getHighlighterIfLoaded()`를 동기 재획득하게 수정해 근절(`[diffdeck]` 주석으로 upstream 이탈 표기). `overscrollSize=1000`은 유지 — 남은 역할은 scroll→queueRender→다음 rAF의 1프레임 렌더 지연 커버(800px/frame 플링까지 e2e 검증, `header-mount.e2e.ts` 극한 프로브). 참고: 뷰어는 CodeView에 workerManager를 넘기지 않으므로 **항상** non-worker 분기 = 이 하이라이터 경로를 탄다.
- **Plan 5 — CLI + 컷오버 + 배포**: `bin/diffdeck.ts`(데몬·토큰·URL), npm `@say8425/diffdeck` 배포, cc-statusline이 `bunx @say8425/diffdeck`로 전환.
