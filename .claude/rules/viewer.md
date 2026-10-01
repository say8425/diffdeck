---
paths:
  - "apps/viewer/browser/**"
  - "apps/viewer/index.html"
  - "apps/viewer/tsconfig.json"
  - "apps/viewer/__tests__/viewer-*.test.ts"
  - "apps/viewer/__tests__/empty-state.test.ts"
  - "apps/viewer/__tests__/load-error.test.ts"
  - "apps/viewer/e2e/diffstyle-scroll.e2e.ts"
  - "apps/viewer/e2e/update-anchor.e2e.ts"
  - "apps/viewer/e2e/load-failure.e2e.ts"
  - "apps/viewer/e2e/empty-state.e2e.ts"
  - "apps/viewer/e2e/error-cards.e2e.ts"
  - "apps/viewer/e2e/large-file-collapse.e2e.ts"
  - "apps/viewer/e2e/worker-highlight.e2e.ts"
---

# 뷰어 프런트 (`apps/viewer/browser/`, `index.html`)

- `bun run typecheck`는 `browser/**`를 보지 않는다(`apps/viewer/tsconfig.json`의 include는 server·cli·build뿐이다). 여기의 타입 오류는 유닛·e2e·빌드로만 드러난다. include에 넣으려면 패키지의 `*.css?inline` ambient 선언과 vendored 전역 augmentation(`Window.__INSTANCE`/`__TOGGLE`)이 앱 tsconfig에서 보이도록 먼저 배선해야 한다.
- 판단·문자열 조립은 게이트 안의 모듈(`prefs.ts`·`emptyState.ts`·`loadError.ts`·`largeFile.ts`·`changeTotals.ts`·`repoLabel.ts`·`refPicker/`·`grab/` 등)에 순수 함수로 둔다(`main.ts`는 배선만 — 루트 CLAUDE.md의 테스트 절).
- `bun build`는 최상위 `let`을 `var`로 바꿔 TDZ 오류를 가린다. `main.ts`의 최상위 실행 코드가 아직 선언되지 않은 `let`을 읽어도 번들에서는 조용히 돈다 — 선언 순서를 지킨다.
- `hidden`으로 숨기는 요소에 author `display`를 선언했으면 `[hidden] { display: none }` 짝을 함께 둔다(`#grab-popover`·`#ref-picker`·`#pr-chip`). author 규칙이 UA 규칙을 이겨 영구히 보인다. happy-dom은 레이아웃이 없어 잡지 못한다.
- "내용 없음"을 나타내는 텍스트 노드는 `hidden` 대신 빈 문자열로 둔다(위 함정을 피하고, 라이브 리전은 hidden이면 읽히지 않는다).

## CodeView 수명과 스크롤

- CodeView는 `!codeView`일 때만 새로 만든다(첫 렌더, 빈 상태에서 복귀, 워커 로드 실패 폴백). 다시 만들면 `#diff`(= 스크롤 컨테이너)가 비워져 scrollTop이 0으로 클램프된다.
- unified↔split 전환은 살아 있는 인스턴스에 `setOptions(codeViewOptions())` → `setItems` → `render` 순으로 태운다. `setOptions`가 먼저 레이아웃 앵커를 잡아야 전환 전 위치로 돌아온다. 순서를 뒤집어도 테스트가 바로 잡지 못한다. 회귀망 `diffstyle-scroll.e2e.ts`.
- `config.overscrollSize`(1000)는 스크롤에서 다음 rAF 렌더까지의 한 프레임 동안 뷰포트 밖을 미리 그려 둬 빈 화면이 드러나지 않게 하는 여유다(빠른 플링은 `header-mount.e2e.ts`가 확인한다). 생성할 때만 세팅해도 된다 — `setOptions`는 `config`를 건드리지 않는다.
- refresh·watch 갱신은 `setItems` → `render`만 부르고 스크롤은 엔진의 의미론적 앵커에 맡긴다. 픽셀 `scrollTo({type: "position"})`를 얹지 않는다: 갱신마다 sticky 헤더 높이만큼 위로 밀리고, 위쪽 파일 길이가 바뀌면 읽던 줄을 잃고, 스타일 전환과 한 프레임 겹치면 앵커를 덮어쓴다. 회귀망 `update-anchor.e2e.ts`.
- `#diff`에 innerHTML을 쓰기 전에 살아 있는 CodeView가 없는지 본다. 덮어쓰면 엔진 컨테이너가 떨어져 나가고 `setup()`이 재부착을 거부해 패널이 영구히 빈다. 그래서 `showLoadFailure`는 `!codeView`일 때만 카드를 그리고, CodeView가 살아 있으면 이유를 `#status`로만 말한다.
- 워커 하이라이트: 렌더 옵션 5필드(theme·useTokenTransformer·tokenizeMaxLineLength·lineDiffType·maxLineDiffLength)를 바꾸려면 `getOrCreateWorkerPoolSingleton`의 `highlighterOptions`에 넣는다. CodeView 옵션으로 넘기면 워커 경로가 무시한다. 워커 스크립트 로드 실패는 엔진이 감지하지 못하므로 `recoverFromWorkerLoadFailure` 워치독이 워커 없이 재구성한다.
- 앱 스타일을 shadow root에 직접 `<style>`로 붙이지 않는다 — `CodeView.cleanElement()`가 첫 recycle에 떼어낸다. `unsafeCSS` 옵션이나 엔진이 읽는 커스텀 프로퍼티를 쓴다. 엔진의 `--diffs-*` 토큰은 shadow root 밖(툴바)에서 해석되지 않는다.

## 갱신과 캐시

- 쿼리의 의미를 바꾸는 경로(untracked 토글, base 선택, head 선택, 낡은 base 복구)는 `lastEtag = null`로 304를 끊는다. 빈 diff의 etag는 선택과 무관하게 같아서, 그대로 두면 빈 상태 카드가 이전 선택의 문구에 고착된다.
- 비동기 응답을 화면에 쓰기 전에 요청 시점의 선택(mode·untracked·head)과 지금 선택을 비교한다(`enrichEmptyState`).
- `fileTree.resetPaths()`는 모든 디렉토리를 다시 펼친다. `renderPatch`는 직전 접힘 상태를 잡아 두었다가 다시 접고, `syncTreeFold()`를 items를 만들기 전에 부른다 — 빠지면 갱신마다 사이드바 접힘과 Fold with tree가 풀린다. 트리에서 접힌 디렉토리 아래 파일을 diff 헤더로 직접 펼치면 사용자가 다시 접기 전까지 펼친 채 둔다.

## 변경량 세기

- 변경 줄 수는 `hunk.additionLines`/`hunk.deletionLines`(숫자)에서 센다(`largeFile.ts`의 `countChangedLines`). `FileDiffMetadata`의 같은 이름 필드는 `string[]`이고, 뷰어는 파일 전량으로 diff를 만들어서 그 값이 옛/새 파일 **전체 내용**이다 — 세면 변경량이 아니라 파일 길이가 나온다. 이 혼동이 대형 파일 자동 접힘을 실제로 망가뜨렸는데 `isLargeFile`의 유닛은 전부 초록이었다(호출부가 틀린 값을 넘겼다).
- 대형 파일 자동 접힘(`isLargeFile`, lockfile은 이름 규칙)과 툴바 변경량(`#change-totals`)이 이 값을 쓴다. 툴바 합계는 `renderPatch`에서만 갱신하고(로딩·실패 중에는 직전 diff의 값을 둔다), 빈 diff에서는 비운다. 접힘 판정의 회귀망은 `large-file-collapse.e2e.ts`다.

## 프리퍼런스 (`prefs.ts`)

- `resolve*` 순수 함수가 값을 정한다. watch·flatten·트리 위치·Fold with tree는 URL → localStorage → 기본값, untracked·트리 숨김·Unified/Split은 URL → 기본값(저장하지 않는다)이다. 사이드바 폭은 localStorage에 저장한다. CLI 뷰 플래그는 URL로 들어와 그 실행에만 적용되고, 인앱 토글은 실제로 적용된 값을 보인다.
- 트리 숨김은 툴바 버튼(`#tree-toggle-btn`)과 오버플로 메뉴 체크박스(`#toggle-tree-hidden`)가 같은 상태를 보인다.
- 기존 `cc-statusline:*` 키는 이름을 바꾸지 않는다 — 마이그레이션 코드가 없어 사용자 설정이 조용히 초기화된다. 새 키는 `diffdeck:` 접두를 쓰고 리포별 값은 리포로 네임스페이스한다(`diffdeck:compare-base:<repo>`).
- URL의 레거시 `mode`는 저장된 base보다 먼저 base로 승격한다(외부 링크가 `?mode=base`를 쓴다). head는 저장하지 않는다 — URL이 진실이라야 새로고침·링크가 재현된다.

## 빈 상태와 자동 base 전환 (`emptyState.ts`)

- 빈 diff의 문구는 `/api/summary`가 온 뒤 `enrichEmptyState`가 한 번만 쓴다. 그 전에는 `load()`의 첫 로드와 같은 `LOADING_MARKUP`을 둔다(먼저 "없다"고 쓰면 말을 바꾸는 것으로 보인다). 요약을 못 받았을 때만 `No changes.`로 떨어지고, 그때 `data-loading`도 걷는다(자리를 차지한 것이 실패 카드였다면 카드 클래스·표식·`role`도 걷는다).
- 미커밋 변경이 없어 카드가 base 보기를 권하면 처음부터 base 보기로 연다. 판정은 카드의 `switch-mode` 액션 유무를 읽는다(`shouldAutoViewBase` — 조건을 따로 세우지 않는다). 불변식:
  - 사용자가 base를 고른 적 있으면(URL `base=` 또는 저장값 — `resolveCompareBase`가 non-null) 덮지 않는다. 호출 시점에 다시 읽는다.
  - untracked처럼 이 뷰에도 볼 것이 있으면 옮기지 않는다.
  - 자동 전환은 저장하지 않는다(`selectBase(next, {persist: false})`). 저장하면 "고른 적 있음"이 되어 이후 자동 전환이 영구히 막힌다. `autoBaseTried`로 한 번만 시도한다.
- base를 저장하는 사용자 경로는 카드의 전환 액션(`applySelection`)이다.

## 로드 실패 (`loadError.ts`)

- 서버 표식(`x-diff-error`)·403·503 소진·네트워크 실패를 `buildLoadErrorModel`이 카드와 `#status` 문구로 접는다. 카드는 빈 상태와 같은 `.empty-card` 클래스에 `data-load-error`를 단다.
- 실패 표시는 `showLoadFailure` 한 곳이고 `load()`와 watch의 `poll()`이 함께 부른다. watch 중에는 focus가 없어서 `poll()`이 실패를 삼키면 옛 화면이 무기한 남는다. 같은 실패가 반복되면(`loadErrorKey`) 다시 그리지 않는다(버튼 포커스 보존).
- `fetchDiff`는 실패를 값(`{kind: "failed"}`)으로 돌려준다. 모듈 변수로 흘리면 `load()`와 `poll()`이 서로의 결과를 덮는다.
- `fetchDiff`의 503·네트워크 실패 1회 재시도는 서버 flight 회복 장치의 일부다(`server.md`). 재시도 횟수와 `RETRY_DELAYS_MS`(= 서버의 `Retry-After`)를 따로 바꾸지 않는다.
- 저장된 base가 사라졌으면(`unknown-base`) `recoverFromStaleBase`가 저장값만 한 번 지우고 다시 불러온다. URL에 명시된 base는 건드리지 않는다 — 그 길은 실패 카드의 `drop-base`가 준다. 그 버튼 라벨은 "default"를 약속하지 않는다(base를 걷으면 저장값이 이길 수 있다).
- 이미지 카드의 `/api/blob`에는 재시도가 없고, 실패하면 깨진 아이콘 대신 `Couldn't load image`를 보인다.
- 실패 카드는 `id="empty"`를 유지한다. 빈 리포에서 서버가 돌아오면 첫 응답이 304라 `enrichEmptyState`가 `#empty`를 갈아 끼우는 것으로만 복구된다.
- 버튼(`retry`·`view-working-tree`·`drop-base`)은 누르기 전까지 URL을 바꾸지 않는다. 사라진 head도 조용히 워킹트리로 돌리지 않는다 — 링크가 요청한 것이라 말없이 바꾸면 사용자가 속는다.
