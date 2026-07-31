# diffdeck

로컬 diff 뷰어 (Bun/TypeScript 모노레포). `@pierre/diffs`·`@pierre/trees`를 소스맵에서 복원해 vendored 포크한 렌더링 엔진 기반.

## WHAT

```
diffdeck/
├── packages/               # 포크한 pierre 패키지 (vendored, npm 설치 안 함)
│   ├── path-store/         # @diffdeck/path-store — 트리 순수 로직 (flatten·sort·projection·store), 18 src, deps 없음
│   ├── theming/            # @diffdeck/theming — 테마 시스템 + 테마 데이터, 14 src + themes/*.json 10개
│   ├── diffs/              # @diffdeck/diffs — CodeView diff 렌더 엔진, 144 src (CodeView.ts 3,563줄)
│   └── trees/              # @diffdeck/trees — FileTree 엔진, 46 src (vanilla 렌더, de-preact 완료)
├── apps/
│   └── viewer/             # @say8425/diffdeck — server/(데이터 API) + browser/(뷰어 프론트) + cli/(CLI 엔트리) + build.ts·cli.ts
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
- `trees` → path-store, theming (preact 의존 제거됨 — vanilla 렌더러)

**포크 provenance**: 원본 `@pierre/*`의 dist `.js.map` `sourcesContent`에 주석 포함 원본 TS가 전량 존재 → `scripts/extract-sources.ts`로 복원 후 `@pierre/*` import를 `@diffdeck/*`로 rewrite. `@pierre/path-store`는 npm 미배포지만 trees dist에 번들되어 함께 복원됨. `@pierre/theme`(테마 데이터)는 코드가 아니라 shiki 테마 JSON 10개라 `theming/themes/`에 그대로 vendored. 전부 Apache-2.0.

## WHY

cc-statusline에 포함됐던 로컬 diff 뷰어를 독립 제품으로 분리 + pierre 포크:

1. **업스트림 리스크** — `@pierre/diffs`는 churn이 크고(7개월 84버전), `@pierre/trees`는 pre-1.0 beta라 내부 마크업이 정당하게 바뀔 수 있음.
2. **이미 많이 개조** — 헤더 폴드·복사 버튼·이미지 카드·인앱 검색·flatten UX를 pierre 내부 마크업(shadow DOM data 속성·sprite id)에 결합해 얹어 씀.

→ 소스 복원해 vendored 포크, 업스트림과 완전 결별. 내부 마크업 결합을 diffdeck 자체의 안정 계약으로 승격.

뷰어 토글(untracked 포함·watch 자동갱신·flatten·파일트리 좌우·unified/split·파일트리 숨김·트리 접기 동기화)은 `--untracked`/`--watch`/`--no-flatten`/`--tree-right`/`--split`/`--hide-tree`/`--fold-with-tree` CLI 플래그로 구동 시점에 미리 설정할 수 있다(session-only — 저장된 localStorage 프리퍼런스는 건드리지 않음). 인앱 토글의 초기 표시 상태는 항상 실제 launch 값과 일치하도록 sync되며, 우선순위 계산(URL 파라미터 → localStorage → 기본값)은 `apps/viewer/browser/prefs.ts`의 순수 resolver 함수(`resolveUntracked`/`resolveWatch`/`resolveFlatten`/`resolveTreeSide`/`resolveDiffStyle`/`resolveTreeHidden`/`resolveFoldWithTree`)로 분리해 단위 테스트한다. unified↔split 전환은 읽던 스크롤 위치를 그대로 유지한다(엔진 앵커링 — 아래 "CodeView 인스턴스 수명" 항목 참고). 파일트리 숨김은 `localStorage` 폴백이 없는 session-only 토글(`resolveUntracked`와 동일 패턴)로, 툴바 아이콘 버튼(`#tree-toggle-btn`)과 오버플로 메뉴 체크박스(`#toggle-tree-hidden`) 둘 다에서 조작 가능하며 항상 서로 동기화된다. 사이드바에서 디렉토리를 접으면 diff 화면의 해당 파일들도 자동으로 접히는 "Fold with tree" 토글은 `flatten`/`treeSide`와 동일하게 `localStorage`(`cc-statusline:fold-with-tree`)에 영속화되며, 오버플로 메뉴 체크박스(`#toggle-fold-with-tree`)로만 조작한다(전용 툴바 버튼 없음). 트리에서 접힌 디렉토리 아래 파일을 diff 헤더 클릭으로 개별 펼치면 그 파일은 사용자가 다시 접기 전까지(토글 on/off와 무관하게) 계속 펼쳐진 채 유지된다. 파일 트리 사이드바 폭은 `#tree-resizer`를 드래그하거나(포커스 후 방향키로도 10px 단위 조정 가능) 180~600px 범위에서 조정할 수 있으며, 조정한 폭은 `localStorage`(session-only 토글들과 달리 지속)에 저장된다.

"Grab" 기능은 diff의 특정 구간을 프롬프트와 함께 클립보드로 복사해 AI 에이전트에게 바로 붙여넣을 수 있게 한다. 진입 경로는 둘: ① 엔진 거터의 GitHub식 라인 선택 + 상주 "+" 버튼(CodeView의 `enableLineSelection`/`enableGutterUtility` 옵션으로 활성화), ② 코드 텍스트 드래그 릴리스 시 즉시 열리는 프롬프트 팝오버. 둘 다 `#grab-popover` 프롬프트 입력창을 열고, Enter로 "참조(파일 경로·상태·base)+스니펫+프롬프트"를 한 텍스트로 인코딩해 클립보드에 복사한다. `enableLineSelection`/`enableGutterUtility`는 전역 활성화라 모든 라인 호버에 "+"가 뜨고 find 매치 라인에도 상주하는데, 이는 의도된 UX 변화다. 텍스트 경로는 pointerup에서 "실제 드래그였는지"부터 게이트한다 — pointerDown→pointerup 이동 거리가 `DRAG_THRESHOLD`(6px)를 넘어야 하며(헤더 폴드 토글과 동일한 `movedBeyondThreshold` 관례), 이 게이트가 없으면 더블/트리플클릭의 네이티브 단어·문단 선택(마우스 이동 없이도 비어있지 않은 Selection을 만든다)이 곧장 팝오버를 열어버린다. 통과하면 스냅샷 의미론: `pointerup` 시점(한 틱 뒤)에 선택·파일·스니펫을 전부 고정해 이후 워커 하이라이트 DOM 교체나 recycle이 선택을 죽여도 안전하고, 팝오버는 스크롤로는 닫히지 않으며 Esc·팝오버 바깥 pointerdown·`renderPatch`(파일 목록 갱신) 발생 시, 그리고 복사 성공 후 1.2초 뒤 자동으로 닫힌다. 선택 소유권: 팝오버가 엔진 라인 선택(`codeView.selectedLines` — `data-selected-line`을 낳는 슬롯)을 "소유"한 경우에만 — 즉 거터 "+" 경로(`onGutterUtilityClick`)로 열렸을 때만 — 닫히거나 복사가 성공할 때 `codeView.clearSelectedLines()`로 그 선택을 해제한다(`onGutterUtilityClick`이 세우는 `grabOwnsLineSelection` 플래그를 `onCopied`/`onClosed`가 공통으로 가드). 텍스트 드래그 경로는 네이티브 브라우저 Selection만 읽을 뿐 이 슬롯을 건드리지 않으므로 플래그를 세우지 않는다 — 무조건 해제했다면 find 바가 `revealMatch`/`selectMatch`로 같은 슬롯에 세워 둔 매치 하이라이트가 텍스트 경로 팝오버의 Esc나 복사 성공만으로 지워지고, 팝오버를 연 적 없는 "파킹된"(드래그만 하고 아직 "+"를 안 누른) 거터 선택도 `renderPatch`(팝오버가 열렸든 아니든 진입부에서 항상 `close()`를 호출)마다 지워지는 회귀가 생긴다. 거터 경로에서 스테일 선택이 남으면 안 되는 이유: 엔진의 `InteractionManager.placeUtility()`는 활성 선택이 있으면 호버를 무시하고 "+"를 선택 하단 행에 고정하며(그 행이 더 이상 렌더 대상이 아니면 아예 숨김) 이후 다른 행 호버에서도 "+"가 뜨지 않게 된다. 텍스트 경로 팝오버가 열리면(`input.focus()`) 네이티브 드래그 선택은 붕괴한다 — 포커스가 문서 선택을 팝오버 input으로 **옮기는** 것이라(실측: `getComposedRanges`가 `#grab-popover`의 자식을 가리킨다) 페인팅만 멈추는 게 아니고, 강제로 되돌려도 첫 타이핑에 다시 붕괴한다. 그래서 잡은 라인은 **grab 하이라이트**가 대신 보여준다: `unsafeCSS`로 넣은 `::highlight(diffdeck-grab)`(파랑) + `CSS.highlights` 레지스트리로 칠하는 독립 채널이다. 앱이 shadow root에 직접 `<style>`을 붙이면 안 된다 — `CodeView.cleanElement()`가 `data-unsafe-css` 등이 없는 style 노드를 첫 recycle에 떼어낸다. 하이라이트 범위는 진입 경로에 따라 다르다: **텍스트 드래그는 문자 단위**(드래그한 문자만), **거터 "+"는 라인 단위**다. `NormalizedRange`의 선택적 `chars`(`CharSpan`)가 그 차이를 나른다 — 없으면 줄 전체이고, 있으면 스니펫(`snippet.ts`의 `applyChars`)과 하이라이트(`highlight.ts`의 `withChars` → `setStart`/`setEnd`) **양쪽에 같은 값이 들어가** "보이는 범위 == 복사되는 범위"가 문자 수준에서 유지된다. `chars`는 양 끝점이 `[data-line]` 안에 직접 떨어졌고 클램프가 없었을 때만 세운다(거터 복구 끝점·크로스 파일·split 컬럼 클램프·비-라인 끝점·끝점이 텍스트 노드가 아닌 토큰 `<span>`인 경우는 생략 → 줄 전체). 가상화 주의: `rowsInRange`는 **그 순간 렌더된 행**만 받으므로, 보이는 첫/끝 행이 실제 선택 경계와 일치할 때만 그 경계에 오프셋을 적용한다(`startExact`/`endExact`) — 경계 행이 렌더 윈도우 밖이면 그 행은 통째로 칠한다. 행의 `textContent`가 파일 원본 라인과 정확히 일치하므로(탭 포함) 텍스트 노드 길이 누적이 원본 기준 오프셋을 준다. 어느 범위든 `lineFor`가 `data-alt-line`을 함께 읽어 행을 고르는 것은 그대로다: unified의 context 행은 엔진이 addition 요소 하나로만 렌더해 `data-line`이 new 번호이므로, 이 폴백이 없으면 old-side 범위에서 사이의 context 행이 하이라이트에서만 빠져(클립보드에는 들어간다 — `snippet.ts`가 `deletionLines`를 통째로 슬라이스한다) "보이는 범위 == 복사되는 범위"가 깨진다. split은 컬럼마다 context 행이 따로 있어 이 폴백을 unified로 한정한다. Range는 워커 DOM 교체·recycle에 죽으므로 `onPostRender`에서 재시딩하며, 대상 파일이 렌더 윈도우 밖일 때 하이라이트가 사라지는 것은 의도된 동작이다. 이 채널은 엔진 `selectedLines` 슬롯을 쓰지 않으므로 위 소유권 규칙(`grabOwnsLineSelection`)과 find 매치 하이라이트는 그대로다. 팝오버 위치는 드래그 **릴리스 좌표**(0크기 rect)를 앵커로 `computePlacement`에 넘긴다 — 예전엔 행 전체 rect라 커서와 무관하게 파일 왼쪽 끝에 떴다. Cmd+C로 이어지는 브라우저 기본 복사 흐름은 여전히 유지되지 않으며, 이는 수용된 트레이드오프다(팝오버 자체가 스니펫을 인코딩해 복사한다). 팝오버는 컨텍스트 라벨(전체 경로 `title`) + 여러 줄 입력(`<textarea rows=1>`, CSS `field-sizing: content`로 `max-height` 96px까지 자란 뒤 스크롤) + 상태 전용 라이브 리전(`.grab-hint`, `role="status"`, 평상시 `hidden`)으로 구성된다. Enter는 제출, **Shift+Enter는 개행**(`preventDefault` 없이 빠져나가 textarea 기본 동작에 맡긴다 — 새 키 분기를 만들지 않아 IME 가드 3지점이 불변이다), Esc는 닫기다. `Enter ↵ · Esc` 상시 힌트 줄은 제거했다 — placeholder와 **같은 말을 두 번** 하는 중복이었고, 한 노드가 상시 안내와 상태를 겸용해 실패로 전이하면 조작 안내가 사라졌다. 단축키 고지는 이제 placeholder(`"Prompt… (⏎ copy · shift + ⏎ new line)"`)와 `aria-keyshortcuts`가 전담한다 — 채널이 하나라 중복이 없고, 입력을 시작하면 사라져 상주 노이즈도 아니다. 회귀망: `grab-highlight.e2e.ts` 8종. 팝오버의 Enter/Esc 둘 다 IME 조합 가드(`isComposing`/`keyCode === 229`)를 걸어 한국어 등 조합 입력 중 키 이벤트가 오작동하지 않는다. 구현은 순수 로직 `apps/viewer/browser/grab/*`(range·snippet·encode·selectionAdapter·position·textSelection·popover·highlight, 100% 커버리지 게이트 안)와 `main.ts`의 배선으로 나뉘며, 배선 쪽은 `grab.e2e.ts` 11종이 회귀망이다.

설계·조사 근거(요약): CodeView는 이미 프레임워크 무관 vanilla 27k줄 엔진(faithful 재작성 4~8개월, 이득 0 → 재작성 금지). trees의 preact 렌더 스킨도 Plan 3(de-preact)에서 vanilla로 포팅 완료 — 현재 리포에 preact/react 런타임 의존이 전혀 없다. 대체 라이브러리 조사 결과 pierre 품질 대체재 없음.

## HOW

### 개발

```bash
bun install
bun run typecheck   # 4패키지 + apps/viewer + apps/viewer/e2e, 각자 tsconfig로 (project references 미설정이라 패키지별 루프)
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
- **워커 하이라이트 경로 활성화됨**: `build.ts`가 `packages/diffs/src/worker/worker.ts`를 `dist/viewer/worker.js`로 번들하고, `main.ts`가 `getOrCreateWorkerPoolSingleton`(poolSize 2)으로 만든 풀을 CodeView에 주입한다. 렌더 옵션 5필드(theme·useTokenTransformer·tokenizeMaxLineLength·lineDiffType·maxLineDiffLength)는 풀이 자기 옵션을 init 메시지로 워커에 밀어넣어 자기일관적이다 — 진짜 계약은 반대 방향: 이 5필드를 CodeView 레벨에서 오버라이드해도 워커 경로는 무시하므로, 바꾸려면 반드시 `getOrCreateWorkerPoolSingleton`의 `highlighterOptions`에 넣어야 한다. 회귀망: `worker-highlight.e2e.ts`(첫 진입 무스파이크 + plain→색 전이 + 폴백).
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
- **CodeView 인스턴스 수명 — 재생성은 `!codeView`일 때만**: `renderPatch`가 CodeView를 새로 만드는 건 첫 렌더와 빈 상태 복귀뿐이다. unified↔split 전환은 살아 있는 인스턴스에 `setOptions(codeViewOptions())` → `setItems` → `render`로 태운다. 재생성하면 `diffMount.replaceChildren()`이 **스크롤 컨테이너 자신**(`#diff`가 곧 `diffMount`)을 비워 scrollHeight가 무너지고 브라우저가 scrollTop을 0으로 클램프해, 읽던 위치를 잃는다. 엔진은 `diffStyle`을 item-layout 옵션으로 취급하고(`hasItemLayoutOptionChanged`) `setOptions` 진입 즉시 `capturePendingLayoutAnchor()`로 앵커를 잡아 렌더 경로에서 `resolveAnchoredScrollTop()`으로 뷰포트를 붙든다(픽셀이 아니라 의미론적 앵커 — split은 scrollHeight가 대략 절반이라 픽셀 복원은 엉뚱한 파일에 착지한다). **호출 순서 자체가 계약이다**: `setOptions`가 `setItems`보다 먼저여야 앵커가 전환 전 레이아웃을 본다. `setOptions`가 건 인덱스 0 리셋이 뒤이은 `setItems`의 부분 리셋에 지워지지 않는 건 `markLayoutDirtyFromIndex()`가 기존 인덱스와 min을 취하기 때문이라, 순서를 뒤집으면 테스트가 못 잡는 채로 조용히 깨진다. `config.overscrollSize`를 생성 분기에서만 세팅해도 되는 이유도 여기 있다 — `setOptions`는 `config`를 건드리지 않아 이후 옵션 변경을 전부 살아남는다. 회귀망: `diffstyle-scroll.e2e.ts`(양방향 앵커 오프셋 + `data-diff-type`).
- **평범한 데이터 갱신에도 픽셀 `scrollTo`를 얹지 말 것**: refresh·`--watch` 갱신 경로는 `setItems` → `render`만 부르고 스크롤 복원을 엔진에 맡긴다. `reconcileItems`가 `markLayoutDirtyFromIndex`를 세우면 렌더 경로가 `layoutDirtyIndex != null`을 보고 scroll correction을 무조건 재무장하고, 캐시된 앵커가 없으면 `getScrollAnchor`가 `renderState`에서 새로 만들어 보정한다 — 즉 이미 의미론적으로 보존된다. 여기에 `scrollTo({type:"position"})`를 얹으면 잉여가 아니라 **해롭다**: ① `position` 타깃은 애초에 항등 복원이 아니다 — `resolveScrollTargetTop`이 클램프되지 않은 값에서 `getStickyHeaderOffset()`(= `diffHeaderHeight` 44, 우리가 `stickyHeaders: true`를 주고 `disableFileHeader`를 안 주므로)을 빼므로, 모든 refresh·watch 폴링마다 뷰포트가 44px씩 위로 밀렸다, ② 뷰포트 *위쪽* 파일 길이가 변하면 아래 내용이 통째로 밀리는데 옛 픽셀로 되돌아가 읽던 줄이 어긋난다(실측: 60줄 증가에 1244px 드리프트), ③ `scrollTo`가 세우는 `pendingScrollTarget`을 프레임이 앵커보다 우선해 적용하므로, 스타일 전환의 렌더가 아직 큐에만 있는 1프레임 창에 갱신이 겹치면(그 창에선 `renderedDiffStyle`이 이미 갱신돼 이 갱신 분기로 들어온다) 전환 전 픽셀값이 앵커를 덮어써 split 기준 거의 바닥으로 착지한다. 보정이 항상 도는 건 아니고 그럴 필요도 없다: `setItems`엔 아무것도 dirty로 안 세우는 append 전용 경로가 있고(위쪽이 안 움직였으니 보정할 게 없다), 앵커 아이템이 사라지거나 목록이 렌더 윈도우보다 작아져 `renderState`가 리셋되면 앵커 해석이 비어 돌아온다 — 그 폴백은 클램프된 현재 위치라 옛 "값 −44"보다 낫다. 회귀망: `update-anchor.e2e.ts`(위쪽 파일 증가 + rAF 게이트로 결정화한 한 프레임 레이스).
- **`#diff`에 innerHTML을 쓰기 전엔 살아 있는 CodeView가 없는지 확인**: 위와 같은 이유로 이 노드는 CodeView가 `setup()`에서 자기 컨테이너를 append한 스크롤 컨테이너라, 덮어쓰면 그 컨테이너가 문서에서 떨어져 나간다. `CodeView.setup()`은 이미 setup된 인스턴스의 재부착을 거부하므로(`already setup`) 인스턴스를 새로 만들기 전까지 패널이 영구히 빈 채로 남는다. 그래서 `load()`의 실패 카드는 `!codeView`로 가드한다 — `!lastFiles`가 아니다: 변경 없는 리포는 `lastFiles === []`(truthy)지만 `teardownViews()`로 이미 codeView가 비워진 뒤라 카드를 쓰는 게 안전하고, `!lastFiles`로 걸면 그 경우에 상태 라벨만 실패를 말하고 화면은 "No changes."를 계속 주장한다. 회귀망: `load-failure.e2e.ts`.
- **포크 패키지는 import 경로 + 재구성 타입만 수정** — 렌더/로직 변경 금지 (Foundation 원칙). 오버홀은 별도 plan에서. 예외는 건별 합의 + `[diffdeck]` 주석으로 upstream 이탈을 코드에 표기 + e2e 회귀망 동반일 때만. 현재 예외 4건 (1~3은 `packages/diffs`, 4는 `packages/trees`):
  1. `DiffHunksRenderer.recycle()`의 하이라이터 동기 재획득 — 빠른 스크롤 headerless blink 완치 (`header-mount.e2e.ts` 극한 프로브가 회귀망).
  2. 빈 렌더 윈도우(totalLines 0 = collapsed) 렌더를 plain-text + zero-range로 — 하이라이트 렌더가 범위를 무시하고 전체 파일을 동기 토크나이즈해 대형 lockfile 마운트가 수 초 프리징하던 것 완치. `renderDiff` sync/async 두 경로 + `RenderedDiffASTCache.emptyWindow` 표식(빈 풀을 확장 렌더가 재사용하면 processDiffResult가 throw — 표식이 확장 시 재렌더를 강제). 회귀망: `lockfile-freeze.e2e.ts` (30k줄 프리징 게이트 + 8k줄 sub-cutoff 펼침 무오류).
  3. `DiffHunksRenderer.recycle()`의 renderCache 조건부 보존 — 하이라이트 완료된(비-emptyWindow) 토크나이즈 AST를 언마운트 후에도 유지해, 오버스캔 재진입 때마다 파일 전체를 동기 재토크나이즈하던 100~360ms 프레임 스파이크(스크롤 끊김의 주범, 프로파일로 busy의 84~86% 확인)를 근절. 스테일은 renderDiff의 diff/options 동등성 검증이 자동 무효화. 회귀망: `retokenize-cache.e2e.ts` (재진입 프레임 상한 + watch 스테일 가드).
  4. 파일트리 flatten 경로의 GitHub식 말줄임 + full-path 툴팁 (`renderRowVanilla.ts` + `style.css`) — upstream은 flatten된 체인의 세그먼트마다 Truncate 위젯을 씌워 좁은 사이드바에서 `eng… / r… / … / p…`처럼 세그먼트별로 조각나던 것을, 세그먼트를 plain 텍스트로 렌더하고 래퍼(`[data-item-flattened-subitems]` — nowrap min-content가 행 flex 체인을 타고 행 폭을 부풀리지 않도록 `minmax(0, max-content)` 단일 컬럼 grid) 안의 clip 요소(`[data-item-flattened-clip]`)에서 CSS `text-overflow: ellipsis`로 끝에서 한 번만 자르게 변경(GitHub 트리와 동일). 아울러 모든 행 버튼에 `title`(full path — flatten 행은 종단 경로, `data-item-path`와 동일)을 주입해 hover 시 전체 경로 툴팁이 뜬다. 비-flatten 행의 확장자 보존 middle-truncate는 그대로다. 회귀망: `tree-path-tooltip.e2e.ts` + `renderRowVanilla.test.ts`.
- **JSX 설정**: `tsconfig.base.json`은 `jsx: react-jsx` + `jsxImportSource: preact`를 여전히 선언하지만, Plan 3(de-preact) 완료 이후 리포 전체에 `.tsx` 파일이 하나도 없어 이 설정은 현재 미사용(vestigial) 상태다. `packages/diffs`·`packages/trees`의 tsconfig는 base를 extend만 하고 별도 JSX override가 없다. 루트 typecheck가 flat이 아니라 패키지별 루프인 건 JSX 때문이 아니라 TS project references가 안 걸려 있어서다.
- **외부 deps는 정확 버전 핀** (캐럿 금지). vendored 패키지는 workspace 내부.
- **preact/react 런타임 의존 없음** — Plan 3(de-preact)에서 trees의 preact 렌더 스킨을 vanilla로 완전히 포팅했고, 어느 `packages/*/package.json`·`apps/viewer/package.json`에도 preact/react가 없다(devDep·peer 포함).
- **라이선스**: 각 `packages/*/LICENSE`(Apache-2.0) + `packages/trees/NOTICE.md`(headless-tree MIT 유래) + 최상위 `NOTICE` 보존. 파일 수정 사실 고지 유지.
- **`*.css?inline` ambient 선언**: 소비자(앱)의 tsconfig가 패키지 `src/**`를 glob include하지 않으면 안 보임 — Plan 2 앱 tsconfig에서 배선 필요.
- **cc-statusline 잔재 데드코드 제거됨**: `server/ensure.ts`(spawn-if-not-running 데몬 ensure)와 `server.ts`의 `idleTimeoutMs` idle-shutdown을 제거했다. diffdeck의 CLI는 서버를 **foreground**로 띄워 Ctrl+C로 종료하는 모델이라(cc-statusline처럼 statusline이 백그라운드 데몬을 spawn-if-not-running으로 관리하는 구조가 아님) 두 기능 모두 미사용 상태였다.
- **CLI 플래그 변경 시 `skills/diffdeck/SKILL.md` 동기화 필수**: `apps/viewer/cli/args.ts`(파싱)·`cli.ts`(`--help` 텍스트)에 플래그를 추가·변경·삭제하면 `skills/diffdeck/SKILL.md`의 `## Options` 섹션도 같은 커밋에서 갱신한다. 이 파일은 `install-skill`로 `~/.claude/skills/`에 배포되고(`--codex` 시 `~/.agents/skills/`에도) Claude Code 플러그인은 `skills/` 디렉터리를 자동 스캔해 로드하는, 에이전트가 diffdeck를 구동할 때 참조하는 유일한 문서라 — CLI 표면과 조용히 드리프트하면 에이전트가 존재하는 옵션(`--untracked`/`--watch`/`--split` 등)을 모른 채 구동하게 된다. `apps/viewer/__tests__/skill-flags-parity.test.ts`가 `cli.ts`의 `HELP` Options 블록과 SKILL.md를 비교해 드리프트를 자동으로 잡아낸다.
- **`hidden`으로 숨기는 노드에 author `display`를 선언하면 `[hidden]{display:none}`을 반드시 짝지어라.** author origin이 UA 규칙을 이겨 영구 노출된다. `#grab-popover[hidden]`이 `display:flex` 뒤에 명시된 이유와 같은 실패 클래스이고 `.grab-hint`에서 두 번째로 밟았다. **happy-dom은 `textContent`만 보므로 유닛이 못 잡고 실브라우저에서만 드러난다** — `grab-highlight.e2e.ts` ②의 `.grab-hint` toBeHidden 단언이 회귀망이다.
- 워커 로드 실패 폴백은 엔진이 아니라 앱 워치독이 담당한다(회귀망: worker-highlight.e2e.ts의 폴백 테스트).

### 로드맵 (각각 별도 sub-plan)

- **Plan 1 — Foundation** ✅: 4패키지 포크, 타입체크·렌더 검증.
- **Plan 2 — viewer + server 앱** ✅: `apps/viewer`로 이관(server/·browser/), 14 유닛 테스트 + 빌드-번들 서빙 통합 테스트로 동등성 검증. `apps/viewer/tsconfig.json`은 지금도 `browser/**`를 include하지 않아 typecheck 루프에서 빠진다 — de-preact로 JSX 벽은 없어졌지만, `*.css?inline` ambient 선언 미해결(같은 문서의 `*.css?inline` 항목 참고)과 vendored 전역 augmentation(`Window.__INSTANCE`/`__TOGGLE`) 가시성 문제가 남아 있어 여전히 미해소 — Plan 4 이후로 이월.
- **Plan 3 — de-preact 실용판** ✅: trees의 preact 렌더 스킨 → vanilla 포팅(가상화·DnD·rename·sticky·SSR 제외, read-only 대응) 완료. `packages/trees`에 preact 의존·`.tsx` 파일이 더 이상 없다.
- **Plan 4 — 커플링 하드닝**: 내부 마크업 계약화, 정렬 comparator 단일화, canary 테스트, 상수 export. **헤더 깜박임은 완치됨**(Foundation 예외를 적용한 첫 vendored 로직 수정): `DiffHunksRenderer.recycle()`이 하이라이터를 무조건 버려(`highlighter = undefined`) 재마운트 때 `renderDiff()`가 null을 반환 → `FileDiff.render()`가 헤더 적용 전에 탈출 → 헤더 없는 0-height 프레임이었는데, recycle()이 생성자(`:228-232`)와 동일 조건으로 `getHighlighterIfLoaded()`를 동기 재획득하게 수정해 근절(`[diffdeck]` 주석으로 upstream 이탈 표기). `overscrollSize=1000`은 유지 — 남은 역할은 scroll→queueRender→다음 rAF의 1프레임 렌더 지연 커버(800px/frame 플링까지 e2e 검증, `header-mount.e2e.ts` 극한 프로브). 참고: 뷰어는 이제 workerManager를 주입해 워커 하이라이트 경로를 탄다(plain 동기 → 색 비동기). 워커 스크립트 로드 실패 시에는 앱 레벨 워치독(main.ts의 recoverFromWorkerLoadFailure — 엔진은 로드 실패를 스스로 감지하지 못해 diff가 영구 공백이 된다)이 풀을 종료하고 CodeView를 workerManager 없이 재구성해 non-worker 분기 = 이 하이라이터 경로로 폴백한다.
- **Plan 5 — CLI + 컷오버 + 배포** ✅: 계획 당시의 `bin/diffdeck.ts` 대신 `apps/viewer/cli.ts` + `apps/viewer/cli/{args,installSkill,opener}.ts`로 CLI(토큰·URL·flags·install-skill)를 구현, npm `@say8425/diffdeck` 배포 완료(현재 0.3.0, trusted publishing으로 자동 배포). `bin/` 디렉토리는 만들어지지 않았다 — CLI 엔트리는 계속 `apps/viewer` 워크스페이스 안에 산다.
