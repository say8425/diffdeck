# diffdeck Plan 3 — de-preact (trees 뷰 스킨 vanilla 재작성) 설계

**날짜**: 2026-07-11
**상태**: 설계 확정 (writing-plans 대기)
**선행**: Plan 1 Foundation + Plan 2(viewer+server 앱) 완료. `@diffdeck/{path-store,theming,diffs,trees}` 포크됨, `apps/viewer`가 `new FileTree(...)`로 트리를 read-only 소비.

## 목표

`@diffdeck/trees`의 **preact 렌더 스킨을 vanilla DOM으로 재작성**하고, `preact`·`preact-render-to-string`
런타임 의존을 제거한다. 뷰어가 실제로 쓰는 **read-only** 기능만 포팅하고, 미사용 기능(가상화·DnD·
rename·sticky 헤더·SSR/hydration)은 드롭한다. 컨트롤러/모델 계층(`model/`, 전부 framework-agnostic
vanilla)과 뷰어의 `FileTree` 공개 계약은 그대로 유지한다.

이로써 diffs(CodeView, 이미 vanilla 27k줄)에 이어 trees도 프레임워크 무의존이 되어, 포크의 목적인
"렌더링 엔진을 온전히 소유"를 완성한다.

## 왜 지금, 왜 이 범위

- `preact 11.0.0-beta.0`은 **beta 핀**이며 유일한 UI 프레임워크 런타임 의존. 제거 시 trees의 외부
  런타임 의존은 `@diffdeck/{path-store,theming}`만 남는다.
- Foundation/Plan 2의 "faithful 이관(로직 무변경)" 원칙은 여기서 **처음으로 해제**된다 — Plan 3는
  명시적 오버홀 plan이다. 단, 오버홀 대상은 **뷰 스킨의 렌더 구현**뿐이고, 컨트롤러 로직·CSS 계약·
  뷰어 공개 API는 오버홀 대상이 아니다(아래 불변 계약 참조).
- 뷰어가 트리를 **블랙박스**로 쓰므로(shadow DOM 미주입, 선택은 JS 콜백으로만 왕복) 재작성 표면이
  작다 — 이 사실이 범위를 "실용판 vanilla"로 좁힐 근거다.

## 범위 (What)

### 재작성/삭제 대상 (preact 6파일)

| 파일 | 줄 | 처리 |
|------|----|------|
| `render/FileTreeView.tsx` | 3890 | **삭제** → `FileTreeVanillaView`로 대체(read-only 코어만) |
| `render/runtime.ts` | 38 | **삭제** → vanilla mount/unmount로 대체 |
| `render/FileTree.ts` | 918 | **수정** — 클라이언트 경로를 vanilla 뷰로 스왑, SSR 절반(`h`/`renderToString`/`preloadFileTree`/`hydrate`/`serializeFileTreeSsrPayload`) 삭제 |
| `render/RenameInput.tsx` | 35 | **삭제** (rename 제외 기능) |
| `components/Icon.tsx` | 65 | **재작성** → vanilla Icon 빌더 |
| `components/OverflowText.tsx` | 430 | **재작성** → vanilla 빌더(순수 `split*` 함수는 그대로) |

### 재사용(무변경) — 이미 vanilla인 substrate

`render/rowAttributes.ts`, `render/rowClickPlan.ts`, `render/iconResolver.ts`, `render/focusHelpers.ts`,
`utils/gitStatusPresentation.ts`, `model/*` 전체, `preparedInput.ts`, `constants.ts`, `builtInIcons.ts`,
`sprite.ts`, `iconConfig.ts`, `utils/*`. 이들은 preact import가 없고, vanilla 뷰의 로직 기반이 된다.

### 드롭하는 기능(뷰어 미사용, 옵션 게이트가 모두 false)

- **가상화**: `computeFileTreeViewLayoutState`, range/window/offset, `data-file-tree-virtualized-*`
  DOM, `onScroll`+ResizeObserver 뷰포트 측정, `scrollTarget.ts`, `--trees-item-height` geometry lockstep.
  → 전체 visible rows를 렌더(스크롤은 CSS `overflow:auto`가 담당). diff의 변경파일 리스트는 경량
  `<button>` 수십~수천 개 수준이고, 무거운 syntax-highlight diff는 `@diffdeck/diffs` 쪽에서 계속
  가상화되므로 read-only 트리에서 가상화 제거는 안전.
- **DnD**: `draggable`/drag 핸들러·touch 핸들러·auto-scroll (`isDragAndDropEnabled()` false).
- **rename**: `RenameInput`, `startRenameFromPath`, `renameHandoff.ts`, F2 (`renamingEnabled` false).
- **sticky 헤더**: sticky 오버레이/계산 (`stickyFolders` false).
- **context menu**: 트리거/앵커/wash (뷰어가 `composition`/menu 옵션 미전달).
- **SSR/hydration**: `preloadFileTree`, `serializeFileTreeSsrPayload`, `hydrate()`,
  `runtime.hydrateFileTreeRoot`, declarative shadow DOM 채택. → `index.ts`의 관련 export 제거,
  `preact-render-to-string` 의존 제거.

## 비목표 (Non-goals)

- **컨트롤러/모델 재작성 금지.** `model/*`는 vanilla·검증됨, 손대지 않는다.
- **CSS(`style.css` 1092줄) 재작성 금지.** vanilla 뷰는 기존 CSS가 요구하는 `data-*`·aria·`--trees-*`
  를 **동일하게 emit**해야 한다. 가상화 전용 셀렉터(`data-file-tree-virtualized-*`)에 대응하는 CSS만
  드롭 가능.
- **뷰어(`apps/viewer`) 변경 금지.** `FileTree` 공개 계약을 보존하므로 뷰어는 무수정.
- **`packages/diffs` 변경 금지.** de-preact는 trees 한정(diffs는 이미 vanilla).
- **가상화/DnD/rename/sticky/SSR 재구현 금지.** 위 드롭 목록은 이번 plan에서 되살리지 않는다.
- **react 어댑터(`src/react/`) 정리·미사용 export 대청소는 Plan 4**(커플링 하드닝)로. Plan 3는 preact
  제거에 필요한 최소 index.ts export 조정만 한다.

## 불변 계약 (재작성이 반드시 보존)

### 뷰어 런타임 계약 (apps/viewer/browser/main.ts)

- 생성자: `new FileTree(options)` — 옵션 6필드: `paths: string[]`, `gitStatus: {path,status}[]`,
  `initialExpansion: "open"`, `flattenEmptyDirectories: boolean`, `search: true`,
  `onSelectionChange: (selected: string[]) => void`.
- 메서드 4개(이것만 뷰어가 호출): `render({ containerWrapper })`, `resetPaths(paths)`,
  `setGitStatus(gitStatus)`, `cleanUp()`.
- 의미 보존 필수:
  - `render`는 `containerWrapper`에 마운트한다.
  - `resetPaths` + `setGitStatus`는 **in-place 갱신** — 스크롤/선택을 리셋하지 않는다(watch 폴링이
    편집 중 트리를 리셋하지 않도록 main.ts:303-307이 의존).
  - `onSelectionChange`는 **실제 파일 경로**로 발화(`selected[0]`이 `codeView.scrollTo`에 그대로 투입).
  - 빈 트리 → 채워진 트리 전이(초기 로드), 그 역도 정상 동작.

### 내부 DOM/CSS 계약 (style.css가 의존 — 동일 emit 필수)

`role="treeitem"`, `aria-level/posinset/setsize/selected/expanded`, `data-item-section`,
`data-item-path`, `data-item-type`, `data-item-git-status`, `data-item-selected`, `data-item-focused`,
`data-item-contains-git-change`, `[data-truncate-*]`(OverflowText 계약), 호스트 vars
`--trees-item-height`·`--trees-density-override`·`--trees-*` 팔레트, 스프라이트 심볼
`file-tree-icon-{chevron,file,dot,lock}` + per-extension 아이콘. `FILE_TREE_TAG_NAME='file-tree-container'`,
`FLATTENED_PREFIX='f::'`(flatten 시 디렉터리 노드 id; 잎 파일은 실제 경로 유지 → 선택 무영향).

## 아키텍처 (How)

### FileTreeVanillaView (신규, `render/FileTreeVanillaView.ts`)

명령형 뷰 클래스. preact 컴포넌트+hooks를 다음으로 치환:

1. **mount(host)**: `searchEnabled`면 검색 `<input>`, 스크롤 컨테이너, 평면 리스트 컨테이너를 `el()`로
   구축. 셰도우 루트 부착은 기존 `FileTree.#prepareHost`와 동일(호스트에 `--trees-item-height`/
   density var 유지).
2. **subscribe**: `controller.subscribe(() => this.renderRows())`. 명령형 루프가 repaint 시점을
   전적으로 통제하므로 `controllerSnapshotSubscription.ts`의 초기 스냅샷 억제 기제는 불필요.
3. **renderRows**: `controller.getVisibleRows(0, controller.getVisibleCount()-1)`(컨트롤러가 이미
   flatten·확장·검색필터 반영한 visible 리스트 반환)로 전체 행 구축. 1차 구현은 정확성 우선 전체
   재빌드(`replaceChildren`); 프로파일링상 필요 시에만 `data-item-path` 키 기반 reconcile로 최적화.
4. **이벤트 위임**: 루트에 `click`/`keydown`/`focusin` 리스너 1개씩 —
   `event.target.closest('[data-item-path]')`로 행 식별 → `rowClickPlan.ts` → 컨트롤러(뷰어의 diff-fold
   위임 패턴과 동형).
5. **순수 헬퍼 재사용**: `rowAttributes`(속성 bag을 `setAttribute`+`.style`로 적용), `rowClickPlan`,
   `iconResolver`, `focusHelpers`, `gitStatusPresentation` 무변경.

hooks→명령형 매핑: `useMemo(iconResolver)`→생성자 계산, `useState(revision)`→직접 `renderRows()`,
`useLayoutEffect(subscribe)`→mount 구독/cleanup 해제, `useRef(Map)`→인스턴스 필드. 반응성은
"컨트롤러 변경 → visible rows 재빌드"로 축약.

### el() DOM 헬퍼 (신규, 소형 ~20줄)

`el(tag, attrs?, children?)` — `createElement`+`setAttribute`. **파일 경로에 `innerHTML` 금지**(주입
방지, textContent 사용). JSX 대체.

### vanilla Icon / OverflowText

- Icon: `<svg><use href="#name"/></svg>`를 `el()`로. `iconResolver`가 심볼 id 결정.
- OverflowText: `MiddleTruncate`/`Truncate` 빌더로 `[data-truncate-*]` 구조 동일 emit. 순수 `split*`
  함수(확장자 분리·flatten 세그먼트)는 그대로 재사용.

### FileTree.ts 스왑

클라이언트 마운트/언마운트를 `FileTreeVanillaView`로 교체. SSR 절반 삭제 후 `preact`/`h`/
`renderToString` import 소멸. `#prepareHost`(셰도우+아이콘 표면+density var)는 유지, `hydrate` 분기와
declarative-shadow-DOM 채택은 CSR 전용 `attachShadow`로 단순화.

## 검증 전략 (parity net 최우선)

**현 상태: `packages/trees`에 테스트 0개.** parity 하니스(`scripts/parity`)는 클래스 constructability만
확인(DOM 미검증). 따라서 **뷰를 건드리기 전에 parity net부터 구축**한다(Task 1).

1. **순수 헬퍼 특성화 테스트(DOM 불필요)** — 재사용할 `rowAttributes`·`rowClickPlan`·`iconResolver`·
   `gitStatusPresentation`·OverflowText `split*`를 현재 동작 기준으로 고정. 이들은 무변경이므로 재작성
   내내 green 유지 = substrate 회귀 감지.
2. **vanilla 뷰 DOM-계약 테스트(happy-dom)** — `@happy-dom/global-registrator`를 devDep 추가(가상화를
   제거해 geometry 비의존이므로 happy-dom로 read-only 뷰가 충실히 렌더됨). fixture 트리를 렌더해 계약
   속성(`role`/`aria-*`/`data-item-*`/`<use href>`/git badge/`[data-truncate-*]`)과 상호작용(클릭→
   컨트롤러 선택, 키보드 이동, expand/collapse, 검색 필터, `onSelectionChange` 값, in-place
   `resetPaths`+`setGitStatus`가 선택/스크롤 보존)을 어서션. Task 2–5에서 red-green으로 성장.
3. **육안 before/after(real Chrome)** — 기존 parity 하니스로 재작성 전후 렌더를 브라우저에서 비교(트리
   행/아이콘/배지/트렁케이션). 자동 커버가 놓칠 시각 회귀의 최종 관문.

**Top 5 parity 리스크** (각각 위 net이 잡음): (1) 선택/포커스/키보드 의미(수식 클릭·range·roving
tabindex·화살표), (2) `data-*`+aria 드리프트(style.css 바인딩), (3) 아이콘/스프라이트+git 배지(chevron
회전·per-ext 아이콘·A/D/M/R/U), (4) 라벨 트렁케이션(MiddleTruncate·flatten `f::`), (5) in-place 갱신
무결성(watch 폴링).

## 태스크 분해 (개략 — 상세는 writing-plans, TDD·독립검증)

1. **parity net 구축**: happy-dom devDep 추가 + 순수 헬퍼 특성화 테스트 + 뷰 DOM 테스트 스캐폴드.
2. **vanilla substrate**: `el()` 헬퍼 + vanilla Icon + vanilla OverflowText(순수 `split*` 유지), 각
   빌더 DOM 테스트.
3. **vanilla 행 렌더러**: `renderFileTreeRowContent`+`renderStyledRow`의 read-only 분기를 DOM 빌더로
   포팅, 행 DOM 계약 어서션.
4. **뷰 컨테이너+구독**: `FileTreeVanillaView`(호스트/리스트 구축, 컨트롤러 구독, 전체 행 렌더, emit 시
   재빌드), mount/update/teardown 테스트.
5. **상호작용 배선**: 위임 클릭→`rowClickPlan`→컨트롤러, 키보드/포커스(`handleTreeKeyDown` 포팅+
   `focusHelpers`), expand/collapse, 선택→`onSelectionChange`, 검색 input. 컨트롤러 대비 테스트.
6. **FileTree.ts 스왑**: 클라이언트 경로를 vanilla 뷰로 교체 + SSR 절반 삭제. 5-멤버 뷰어 계약 보존,
   뷰어 호출 시퀀스(생성→render→resetPaths+setGitStatus→cleanUp) 테스트.
7. **preact 제거**: `FileTreeView.tsx`/`RenameInput.tsx`/`runtime.ts` 삭제, `package.json`에서 `preact`+
   `preact-render-to-string` 제거, `index.ts`의 SSR export 제거, tsconfig JSX 조정(react/preact 혼합
   해소). 전체 typecheck + `bun test` + 육안 parity.

## 불변 제약 (Foundation/Plan 2 계승)

- **CodeView(diffs) 재작성 금지** — blackbox 유지, 이번 plan 무관.
- 컨트롤러/모델·CSS·뷰어 API는 오버홀 대상 아님(위 불변 계약).
- 외부 deps 정확 버전 핀(캐럿 금지). happy-dom도 정확 버전 핀.
- 루트 typecheck는 패키지별 tsconfig 루프. preact 제거 후 trees tsconfig의 JSX 설정 재점검.
- 라이선스·NOTICE 보존. preact 유래 코드 삭제여도 `NOTICE`/`packages/trees/NOTICE.md`는 pierre/
  headless-tree 고지라 유지.

## 리스크 & 완화

- **테스트 0 상태에서의 대규모 재작성** → Task 1 parity net 선구축(순수 특성화 + happy-dom 계약 +
  육안). 이것이 최대 de-risk 단계.
- **happy-dom install 실패(사내 TLS/registry)** → cafile 설정 확인(`~/.bunfig.toml`). 만약 install
  불가면 fallback: 뷰 DOM 테스트를 최소 DOM 스텁 또는 real-Chrome 하니스 확장으로 대체(Task 1에서
  install 성공 여부를 먼저 확인 후 경로 확정).
- **style.css 계약 드리프트** → DOM-계약 테스트가 요구 속성을 명시 어서션 + 육안 parity.
- **가상화 제거로 초대형 diff 성능 저하** → 현실적 행 수(수십~수천)에서 경량 `<button>`은 무해; 필요
  시 후속으로 CSS `content-visibility:auto`(JS 없음). 이번 범위엔 미포함(YAGNI).
- **in-place 갱신 회귀** → `resetPaths`+`setGitStatus`가 선택/스크롤 보존하는지 통합 테스트로 고정.
