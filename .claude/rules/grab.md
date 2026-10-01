---
paths:
  - "apps/viewer/browser/grab/**"
  - "apps/viewer/browser/main.ts"
  - "apps/viewer/index.html"
  - "apps/viewer/e2e/grab*.e2e.ts"
  - "apps/viewer/e2e/fixtures/drag.ts"
  - "packages/diffs/src/managers/InteractionManager.ts"
---

# Grab — diff 선택 → 프롬프트 → 클립보드

순수 로직은 `browser/grab/*`(커버리지 게이트 안), 배선은 `main.ts`다. 배선의 회귀망은 `grab.e2e.ts`·`grab-highlight.e2e.ts`이고, 합성 드래그의 튜닝값(sleep, 오프셋)은 `e2e/fixtures/drag.ts` 한 곳에 둔다.

## 진입 경로

- 거터: 엔진의 `enableLineSelection` + `enableGutterUtility`("+" 버튼)를 켜고 `enableLineSelectionDrag: false`로 라인넘버 드래그만 끈다(vendored 예외 5). 모든 행 호버와 find 매치 행에 "+"가 뜨는 것은 의도다.
- 텍스트 선택: 드래그는 `pointerup`에서 이동 거리가 `DRAG_THRESHOLD`를 넘었는지로, 더블·트리플클릭은 `click`의 `event.detail >= 2`로 받는다. Chrome의 pointer 이벤트는 `detail`이 늘 0이다. `dblclick`으로 짜면 트리플클릭의 줄 선택을 놓친다.
- 트리플클릭 때 팝오버가 한 번 닫혔다 다시 열린다. 바깥 dismiss에 디바운스나 재오픈 금지 시간을 넣으면 트리플클릭이 깨진다.
- shift+클릭 선택 확장은 팝오버를 열지 않는다(알려진 제외). `detail >= 2` 문턱을 지키는 테스트는 지금 없다 — shift+클릭을 지원하게 되면 그 문턱을 가르는 테스트를 함께 세운다.
- Cmd+C 기본 복사 흐름은 유지하지 않는다(수용한 트레이드오프).

## 선택과 하이라이트

- 제스처 시점(한 틱 뒤)에 선택·파일·스니펫을 스냅샷한다. 이후 워커 DOM 교체나 recycle이 선택을 죽여도 안전하다.
- 팝오버 입력이 포커스를 가져가면 네이티브 선택은 사라진다. 그래서 텍스트 경로가 잡은 범위는 별도 채널로 칠한다: `unsafeCSS`로 넣은 `::highlight(diffdeck-grab)` + `CSS.highlights`. Range는 recycle에 죽으므로 `onPostRender`에서 다시 심는다. 거터 경로는 이 채널을 쓰지 않는다(엔진의 `data-selected-line`이 줄을 칠한다).
- 텍스트 경로는 문자 단위다. `NormalizedRange.chars`가 스니펫(`applyChars`)과 하이라이트(`withChars`)에 같은 값으로 들어가 "보이는 범위 == 복사되는 범위"를 지킨다. `chars`는 양 끝점이 `[data-line]` 안 텍스트 노드에 떨어지고 클램프가 없을 때만 세운다(그 밖에는 줄 전체).
- 가상화: `rowsInRange`는 렌더된 행만 받으므로 경계 행이 실제 선택 경계일 때만 문자 오프셋을 적용한다(`startExact`/`endExact`).
- unified의 context 행은 `data-line`이 new 번호라 `lineFor`가 `data-alt-line`도 읽는다(unified 한정). 빼면 old 쪽 범위의 context 행이 하이라이트에서만 빠진다.
- 엔진의 선택 슬롯(`selectedLines`)은 거터 경로로 열었을 때만 팝오버가 소유한다(`grabOwnsLineSelection`). 그때만 닫힘·복사 성공에서 해제한다 — 무조건 해제하면 find의 매치 하이라이트와 아직 "+"를 누르지 않은 거터 선택이 지워지고, 해제하지 않으면 엔진이 "+"를 그 선택에 고정해 다른 행에서 "+"가 뜨지 않는다.

## 팝오버

- 위치: 텍스트 경로는 제스처가 끝난 좌표(0크기 rect), 거터 경로는 선택의 마지막 행 rect를 `computePlacement`에 넘긴다.
- 라벨은 `grabLabelParts()`가 만드는 조각(파일·범위·side)을 팝오버가 조각마다 칠한다. `grabLabel()`은 프로덕션에서 부르지 않지만 지우지 않는다 — 조각을 이어 붙이면 예전 문자열과 같다는 테스트가 이 함수로 색과 텍스트가 갈라지는 것을 막는다.
- 배치는 `open()` 때 한 번만 계산한다. `POPOVER_SIZE`는 CSS 박스의 바깥 크기(패딩·테두리 포함)이고 실제보다 작게 적으면 화면 끝에서 잘린다 — CSS 값과 같아 보이게 "정리"하지 않고, 줄을 더하면 높이도 올린다.
- 구성: 라벨 줄(`.grab-head` — 닫기 버튼 `.grab-close`가 이 줄 안에 산다) + 입력 상자(`.grab-field`, 보내기 버튼 포함) + 단축키 각주(`.grab-keys`). 닫기 버튼을 라벨 줄 밖으로 빼면 팝오버 높이가 바뀐다.
- `.grab-send`는 배경 없이 색으로만 상태를 말한다(`data-state`: idle → ready → ok → fail). 아이콘은 전부 DOM에 두고 CSS로 하나만 보인다. 빈 프롬프트도 복사되므로 `disabled`로 만들지 않는다.
- `.grab-hint`(`role="status"`)는 sr-only다. 보이는 줄로 두면 복사할 때마다 창이 자라 코드가 밀린다. "상태 없음"은 `hidden`이 아니라 빈 텍스트로 둔다(hidden이면 라이브 리전이 읽히지 않는다).
- radius는 앱에 있는 세 값만 쓴다: 8px 떠 있는 패널, 6px(`--vd-radius`) 표준 컨트롤, 4px 컨테이너 안 버튼. `999px`은 토글 스위치 전용이다.
- 버튼의 `mousedown`은 `preventDefault`한다 — 입력이 포커스를 잃으면 IME 조합 중인 글자가 확정·누락된다.
- 닫힘: Esc, 팝오버 바깥 pointerdown, `renderPatch`, 복사 성공 후 잠시 뒤. 스크롤로는 닫지 않는다.

## 키

- Enter: 참조 + 스니펫 + 프롬프트 복사. ⌥⏎(Alt+Enter): 코드만 복사(`plainSnippet` — 펜스·머리말·`+`/`-` 접두 없음). Shift+Enter: 개행(`preventDefault` 없이 textarea 기본 동작). Esc: 닫기.
- keydown 분기 순서는 IME 가드(`isComposing` / `keyCode === 229`) → `altKey` → `shiftKey` → 제출이다. IME 가드보다 앞에 두면 조합 중에 오작동하고, `shiftKey`를 `altKey`보다 앞에 두면 ⌥⇧⏎가 개행이 된다(이 경우를 지키는 유닛은 없다).
- 단축키 고지는 `.grab-keys` 각주(⌥⏎를 상시 보여 주는 유일한 자리), 보내기 버튼 `title`, `aria-keyshortcuts`가 나눠 맡는다. placeholder는 `Prompt…`만 둔다.

## e2e 함정

- 헤더 더블클릭 스펙은 대상 파일을 먼저 접어 둔다. 펼친 채 더블클릭하면 첫 클릭이 폴드 토글을 쳐서 행이 0개가 되고, 스펙이 의도와 다른 이유로 통과한다.
- vendored 예외 5의 회귀망은 `grab.e2e.ts`의 ⑯(라인넘버 드래그 무선택 + 클릭 선택)과 ⑱(shift+클릭 확장·재클릭 해제)이다. ⑱ 없이 shift 분기를 지우면 나머지 grab 스펙은 전부 통과한다.
