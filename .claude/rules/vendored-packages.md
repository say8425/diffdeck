---
paths:
  - "packages/**"
  - "scripts/**"
  - "tsconfig.base.json"
  - "apps/viewer/e2e/header-mount.e2e.ts"
  - "apps/viewer/e2e/lockfile-freeze.e2e.ts"
  - "apps/viewer/e2e/retokenize-cache.e2e.ts"
  - "apps/viewer/e2e/tree-path-tooltip.e2e.ts"
---

# vendored 패키지 (`packages/*`)

`@pierre/*` dist의 `.js.map` `sourcesContent`에서 원본 TS를 복원(`scripts/extract-sources.ts`)하고 import를 `@diffdeck/*`로 바꾼 포크다. npm에 없던 `@pierre/path-store`는 trees dist에 번들된 것을 함께 복원했고, `theming/themes/`의 shiki 테마 JSON은 `@pierre/theme`에서 그대로 가져왔다. 전부 Apache-2.0이고, 업스트림과는 결별했다(`@pierre/*`를 다시 의존성으로 들이지 않는다).

## 고쳐도 되는 것

- import 경로와 재구성 타입만 고친다. 렌더·로직은 바꾸지 않는다(Foundation 원칙). CodeView 엔진은 재작성하지 않는다.
- 예외는 건별 합의 + 이탈 지점의 `[diffdeck]` 주석 + e2e 회귀망을 모두 갖출 때만 둔다. 새 예외를 만들면 아래 목록에 더한다.
- 동작을 바꾸고 싶으면 먼저 엔진이 열어 둔 확장점(옵션, `var(--…)` 커스텀 프로퍼티, `unsafeCSS`)으로 해결한다.
- 뷰어가 기대는 엔진 마크업(data 속성)은 `constants.ts`의 `DIFFS_*_ATTR`로 export하고 `markup-contract.test.ts`가 지킨다. `packages/diffs`의 테스트는 이것 하나라서 엔진 동작은 e2e로만 확인된다.
- 라이선스 파일(`packages/*/LICENSE`, `packages/trees/NOTICE.md`, 루트 `NOTICE`)과 수정 고지를 유지한다.
- lint·format 대상이 아니다(Pierre 원본 스타일을 유지한다).

## 현재 예외 (1~3·5는 `packages/diffs`, 4는 `packages/trees`)

1. `DiffHunksRenderer.recycle()`이 하이라이터를 생성자와 같은 조건으로 동기 재획득한다(`getHighlighterIfLoaded()`). 빠른 스크롤 때 헤더 없는 0높이 프레임이 깜박이던 것을 막는다. 회귀망 `header-mount.e2e.ts`.
2. 빈 렌더 윈도우(접힌 파일)를 plain-text + zero-range로 렌더한다. 하이라이트 렌더가 범위를 무시하고 파일 전체를 동기 토크나이즈해 대형 lockfile 마운트가 수 초 멈추던 것을 막는다. sync/async 두 경로 + `RenderedDiffASTCache.emptyWindow` 표식(빈 결과를 펼침 렌더가 재사용하면 `processDiffResult`가 throw하므로 펼칠 때 다시 렌더하게 한다). 회귀망 `lockfile-freeze.e2e.ts`는 sync 경로만 지킨다 — 하이라이터가 로드되기 전에 마운트될 때 타는 async 경로는 지키는 테스트가 없다.
3. `recycle()`이 하이라이트가 끝난(비-emptyWindow) renderCache를 언마운트 뒤에도 보존한다. 오버스캔 재진입마다 파일 전체를 다시 토크나이즈하지 않게 한다 — 워커가 없으면 프레임이 멈추고, 워커 경로에서는 워커가 답할 때까지 하이라이트 없이 그려진다. 스테일은 `renderDiff`의 diff·options 동등성 검사가 무효화한다. 회귀망 `retokenize-cache.e2e.ts`(워커 경로에서는 재진입 직후의 하이라이트 단언이 가른다).
4. 파일트리 flatten 행을 GitHub처럼 끝에서 한 번만 말줄임하고(`[data-item-flattened-subitems]` 래퍼 안의 `[data-item-flattened-clip]`에 `text-overflow`), 모든 행 버튼에 전체 경로 `title`을 단다(`renderRowVanilla.ts`·`style.css`). flatten이 아닌 행의 확장자 보존 가운데 말줄임은 그대로다. 회귀망 `tree-path-tooltip.e2e.ts`·`renderRowVanilla.test.ts`.
5. `InteractionManager`의 `enableLineSelectionDrag` 옵션(기본 `true` = upstream 동작)과 `CodeView`의 옵션 키 목록 2곳. `false`면 라인넘버 pointerdown을 `pendingLineSelect`로 미뤘다가, 포인터가 다른 번호 셀로 넘어가면 취소하고(드래그는 아무것도 선택하지 않는다) 제자리에서 놓으면 클릭으로 확정한다. 클릭 선택·shift+클릭 확장·재클릭 해제는 드래그를 켠 경로와 같은 함수(`extendSelectionFromShiftClick`/`selectSingleLineFromPoint`)를 쓴다. 회귀망은 `grab.e2e.ts`의 ⑯·⑱이다(`grab.md`).

## shiki를 올릴 때

- 문법(tm-grammars) 변경을 잡는 자동 게이트는 없다. `scripts/parity/parity.test.ts`는 export가 함수인지만 본다.
- 렌더 패리티 하니스로 before/after를 눈으로 비교한다. 바뀐 언어의 픽스처를 `fixture.json` 앞쪽에 두면 첫 화면에서 바로 보인다.
  ```bash
  bun run scripts/parity/build.ts
  cd scripts/parity && python3 -m http.server 8099   # http://127.0.0.1:8099/index.html
  ```
- `resolveLanguage`는 `bundledLanguages`에 없는 언어 id를 받으면 throw한다. `EXTENSION_TO_FILE_FORMAT`의 값이 전부 `bundledLanguages`에 있는지 확인한다(id가 하나라도 사라지면 그 확장자가 런타임에 터진다).

## tsconfig 잔재

- `tsconfig.base.json`의 `jsx: react-jsx` + `jsxImportSource: preact`와 `include` 블록은 쓰이지 않는다. `.tsx` 파일이 없고, typecheck 대상 tsconfig는 모두 자기 `include`를 선언한다. preact/react 런타임 의존은 없다 — 다시 들이지 않는다.
- 루트 typecheck가 패키지별로 도는 것은 TS project references가 없어서다.
