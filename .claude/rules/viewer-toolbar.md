---
paths:
  - "apps/viewer/browser/main.ts"
  - "apps/viewer/browser/refPicker/**"
  - "apps/viewer/browser/repoLabel.ts"
  - "apps/viewer/browser/prBadge.ts"
  - "apps/viewer/browser/changeTotals.ts"
  - "apps/viewer/index.html"
  - "apps/viewer/__tests__/repo-label.test.ts"
  - "apps/viewer/__tests__/ref-picker-model.test.ts"
  - "apps/viewer/__tests__/pr-badge.test.ts"
  - "apps/viewer/__tests__/change-totals.test.ts"
  - "apps/viewer/e2e/toolbar-*.e2e.ts"
  - "apps/viewer/e2e/ref-picker.e2e.ts"
  - "apps/viewer/e2e/pr-badge.e2e.ts"
---

# 툴바와 피커

## 배치

- 왼쪽 `.tb-left`는 진술만 담는다(트리거 · PR 칩 · 파일 개수 · 변경량). 오른쪽 `.tb-right`는 조작만 담는다.
- 오른쪽 순서는 `찾기 · 새로고침 │ Unified/Split · 트리 토글 │ ⋯`이다. 찾기가 맨 앞이어야 한다: 그룹이 `margin-left: auto`로 오른쪽 끝에 붙어 있어서 `#find-bar`가 펼쳐지면 그 왼쪽 이웃만 밀린다. 같은 이유로 `#find-bar`는 `#find-open` 바로 뒤에 둔다. 트리 토글은 같은 토글(`Hide file tree`)이 든 `⋯` 메뉴 옆에 둔다. 회귀망 `toolbar-order.e2e.ts`.

## 피커 (`#ref-picker`) — head를 고른다

- 피커는 base가 아니라 head(무엇을 볼지)를 고른다. base는 서버가 해석한다. 사용자가 base를 바꾸는 길은 빈 상태 카드의 전환 액션, 실패 카드의 `drop-base`(링크에서 base 제거), 손으로 쓴 URL `base=`뿐이다.
- 워크트리 구역(`WORKTREES`)의 행은 다른 `repo`로 페이지를 이동한다(diff·트리·라벨·프리퍼런스 키가 전부 바뀐다). 이동할 때 `head`를 들고 가지 않는다. 브랜치 구역(`BRANCHES`, 로컬 다음 원격)의 행은 같은 워크트리에서 URL의 `head`만 바꾼다.
- 브랜치를 고르면 base를 auto로 올린다(`applyPick`의 `"HEAD"` → `"@auto"`). 서버 `parseSelection`에도 같은 규칙이 있으니 바꿀 때 둘 다 바꾼다.
- `applyPick`은 패널 닫기와 포커스 복귀를 조기 반환보다 먼저 한다 — 이미 고른 행을 눌러도 피커는 닫혀야 한다.
- 정렬은 두 구역 모두 default → 지금 보는 것 → 받은 순서다. 태그는 `default` 하나뿐이고, 지금 보는 행에는 체크가 붙는다. 필터는 `label`·`note`(워크트리 행의 브랜치 이름)·PR 번호·PR 제목을 본다.
- 워크트리 구역은 고를 것이 없으면 숨기되, head가 브랜치면 남긴다(워킹트리로 돌아올 길).
- 첫 오픈의 빈 목록은 `pickerLoaded`로, `/api/refs` 실패는 `pickerFailed`로 가른다. 목록을 받기 전에 `No match`를, 실패했는데 `Loading…`을 보이지 않는다.
- 구역 제목·구분선·빈 문구는 `role="presentation"`이다(listbox의 자식은 option/group뿐이다).
- 행에 파일 개수를 달지 않는다.
- 피커는 툴바에 앵커한 절대 위치 패널이고 자기 dismiss(바깥 mousedown, Escape + IME 가드)를 가진다. 오버플로 메뉴의 리스너에 얹지 않는다.

## 트리거 라벨 (`#ref-picker-label`)

- 고르는 컨트롤이 곧 지금 상태의 표시다. 같은 정보를 말하는 별도 라벨을 두지 않는다(둘은 어긋날 수 있다). 툴바에는 base도 표시하지 않는다 — 옛 `#base-label`(`vs main`)은 사용자가 고를 수 없는 값을 말해서 걷어냈다. 미커밋 변경만 보는지 브랜치 전체를 보는지 가르는 표시가 필요해지면 옛 라벨을 되살리지 말고 새로 설계한다.
- 트리거는 "어느 리포의 어느 워크트리에서 무엇을 보는가"를 말한다. 메인 워크트리는 `repo · branch`, 링크된 워크트리는 `repo / worktree · branch`, 브랜치를 head로 보면 워크트리 조각 없이 `repo · head`(브랜치 이름이 `/`를 품으므로 여기서는 ` / `를 쓰지 않는다). 색은 구별되는 조각(`#picker-name`)만 밝힌다. 탭 제목에는 리포 접두를 넣지 않는다.
- 구분자는 조각의 텍스트가 품는다(`"repo / "`, `" · main"`). 마크업의 span 사이에 공백 텍스트 노드를 넣지 않는다.
- detached는 `detached @ <7자>`. bare 리포의 루트 이름은 관례적 `.git` 접미를 벗긴다(`repoLabel.ts`).
- 지금 어느 워크트리인지는 `findWorktree`(`repoLabel.ts`) 하나로 판정한다 — 세그먼트 경계 최장 접두 일치(하위 디렉토리에서 기동, 중첩 워크트리). 라벨과 피커(정렬·체크)가 같은 함수를 쓴다.
- 갱신 시점은 `load()`, 피커 열림, watch의 `poll()` 셋이다. `poll()`을 빼면 watch 중 브랜치를 갈아탈 때 툴바가 옛 브랜치에 굳는다. 워킹트리가 깨끗하면 지문이 같아 304로 흐르므로 "내용이 바뀐 폴에서만" 갱신하는 조건도 쓸 수 없다.

## 트리거 폭 (flex shrink 사슬)

라벨을 말줄임하는 기제는 flex shrink 하나뿐이다. 마디를 하나라도 빼면 라벨이 잘리지 않거나 툴바가 넘친다:

1. `.tb-left { min-width: 0 }`
2. `.tb-left > * { flex: none }`의 예외로 `#toolbar .tb-picker { flex: 0 1 auto; min-width: 0 }`
3. `#toolbar .tb-picker { display: flex }` — 블록이면 안쪽 버튼이 flex item이 아니어서 줄어든 몫을 받지 못한다.
4. `#toolbar #ref-picker-btn { min-width: 0 }` — 3과 한 짝이다.
5. 라벨 자신의 `overflow: hidden`, 셰브론 `svg`의 `flex: none`

피커 규칙은 `#toolbar`로 스코프해 특이도로 `.tb-left > *`를 이긴다(소스 순서에 기대지 않는다). `max-width`를 되살리지 않는다 — 넘침을 막는 데 보탬이 없고 공간이 남아도 라벨을 자른다. 레이아웃이라 `toolbar-repo.e2e.ts`만 잡는다.

## PR 칩 (`#pr-chip`)과 피커 행의 PR 줄

- 지금 보는 브랜치(head, 없으면 워크트리의 브랜치)에 PR이 있을 때만 보인다. 링크는 새 탭(`target="_blank" rel="noopener noreferrer"`)이고 접근 가능한 이름은 `aria-label`로 명시한다.
- 상태 4종(Open·Draft·Merged·Closed)은 색과 모양이 모두 다른 아이콘으로 말한다(글자로 되풀이하지 않는다, 아이콘에 `role="img"` + `aria-label`).
- PR 데이터는 `/api/prs`로 따로 받아 도착하는 대로 얹는다(`refreshPrs` — 라벨과 같은 세 시점). 응답 원문이 직전과 같으면(`lastPrsRaw`) 아무것도 다시 그리지 않는다 — 열린 피커를 다시 세우면 누르는 중인 행 노드가 바뀌어 click이 사라진다. 맵 조회는 `Object.hasOwn`이다(`prFor`).
- 원격 행(`origin/feat/x`)은 원격 접두를 벗긴 이름의 PR을 단다(`prBranchOf`). head가 원격인지는 이름이 아니라 `/api/refs` 목록으로 판정한다(`viewedPrBranch`) — 첫 세그먼트를 무조건 벗기면 로컬 `fix/foo`가 `foo`의 PR을 단다. `head=HEAD`는 워크트리의 브랜치로 읽는다. 원격 이름에 `/`가 있으면 대개 PR을 못 찾는다(알고 둔 한계).
- CSS: `#toolbar #pr-chip`에 `[hidden]` 짝을 둔다. 줄어드는 순서가 계약이다 — 칩 제목이 먼저, 트리거가 나중이다(`flex: 0 100000 auto`; 1000으로는 트리거가 1px씩 잘렸다). 칩의 바닥 폭(아이콘 + 번호)은 `applyPrChip`이 재서 인라인 `min-width`로 걸고, 웹폰트가 늦게 오면 다시 잰다(`fonts.md`).
- 피커의 선택 체크 규칙은 `#ref-picker .ref-row > svg`다. 자식 결합자가 빠지면 둘째 줄의 PR 아이콘까지 체크 자리로 날아간다.

## 변경량 (`#change-totals`)

- 파일 개수 오른쪽에 전체 `+N -M`을 둔다. 한쪽이 0이어도 둘 다 보이고, 센 줄이 없으면(이미지만 바뀐 diff) 자리를 비운다. 자릿수 구분자는 넣지 않는다. 세는 값의 출처는 `viewer.md`의 "변경량 세기"를 따른다. e2e(`toolbar-totals.e2e.ts`)는 기대값을 하드코딩하지 않고 스펙 안에서 `git diff --numstat` 합과 대조한다.
