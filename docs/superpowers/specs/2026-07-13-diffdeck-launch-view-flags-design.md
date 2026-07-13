# diffdeck Launch View Flags — 설계

**날짜**: 2026-07-13
**상태**: 설계 (writing-plans 대기)
**저자**: Penguin + Claude (brainstorming)
**선행**: `@say8425/diffdeck` CLI(`apps/viewer/cli.ts`)가 `startDiffServer` + `buildDiffViewerUrl`로 뷰어 URL 생성. 뷰어(`browser/main.ts`)가 토글 상태를 관리(일부 localStorage 지속, 일부 런타임 기본값). 기존 `mode`(working/base) URL 파라미터는 이미 localStorage보다 우선하며 localStorage에도 씀(지속).

## 목표

diffdeck을 **구동 시점부터 특정 뷰어 기능을 켠 채로** 띄울 수 있게 CLI 플래그를 제공한다. 플래그는 **이번 구동에만 적용**(session-only)되며, 저장된 localStorage 프리퍼런스는 건드리지 않는다. **핵심 불변식: 초기 렌더에서 인앱 토글 스위치의 표시 상태 = 실제 기능 상태 = 플래그 값** (sync).

## 플래그 세트 (session-only)

| 플래그 | URL 파라미터 | 기본값 | 효과 |
|---|---|---|---|
| `--untracked` | `untracked=1` | off | untracked 파일 포함 |
| `--watch` | `watch=1` | off | watch 자동갱신 켜고 시작 |
| `--no-flatten` | `flatten=0` | **on** | flatten 끄고 시작 |
| `--tree-right` | `tree=right` | left | 파일트리 우측 |
| `--split` | `style=split` | unified | split 뷰로 시작 |

**mode(working/base)는 이 기능에서 제외** — 기존 `mode` URL 파라미터는 localStorage에 쓰는(지속) 별도 UX(✏️ base 링크용)이므로, session-only 원칙과 섞으면 같은 파라미터가 두 동작을 갖게 된다(비목표).

## 메커니즘 (기존 `mode` 패턴 계승, 단 localStorage 미기록)

1. **`cli/args.ts` `parseArgs`**: `ParsedArgs`에 view 옵션 추가 — `untracked: boolean`, `watch: boolean`, `flatten: boolean`(기본 true), `treeSide: "left"|"right"`(기본 left), `diffStyle: "unified"|"split"`(기본 unified). 새 플래그(`--untracked`, `--watch`, `--no-flatten`, `--tree-right`, `--split`) 파싱.
2. **`server/link.ts` `buildDiffViewerUrl`**: 옵션 파라미터에 view 상태를 받아 URL 쿼리에 추가 — **기본값과 다를 때만** 파라미터를 붙인다(URL 깔끔하게 유지: `untracked=1`·`watch=1`·`flatten=0`·`tree=right`·`style=split`). 기존 `mode?`, `repo`, `token`, `port`는 유지.
3. **`cli.ts`**: `parseArgs` 결과의 view 옵션을 `buildDiffViewerUrl`에 전달.
4. **뷰어 초기화(`browser/main.ts`)**: 각 상태를 **`URL 파라미터가 있으면 그 값, 없으면 localStorage/기본값`** 우선순위로 계산 → **기능 변수 + 토글 input.checked(또는 세그먼트 aria-pressed) 둘 다** 그 값으로 설정 → **localStorage.setItem 하지 않음**(session-only; 기존 init도 flatten/tree-side는 setItem 안 하므로 자연스러움). 이후 인앱 토글 change 핸들러는 기존대로 동작(지속 항목은 localStorage 갱신).

## 컴포넌트 / 순수화

- **우선순위 계산은 순수 함수로 분리**해 단위 테스트한다(기존 `browser/prefs.ts`의 `readFlatten`/`readTreeSide` 패턴 확장). 예:
  - `resolveFlatten(urlParam: string | null, get: Getter): boolean` — `urlParam==="0"→false`, `urlParam==="1"→true`, 없으면 기존 `readFlatten(get)`.
  - `resolveTreeSide(urlParam, get): TreeSide` — `urlParam==="right"→"right"`, `"left"→"left"`, 없으면 `readTreeSide(get)`.
  - `resolveWatch(urlParam, get): boolean` — URL 우선, 없으면 localStorage(`cc-statusline:diff-watch`).
  - `resolveUntracked(urlParam): boolean` — localStorage 없음, `urlParam==="1"→true` 기본 false.
  - `resolveDiffStyle(urlParam): "unified"|"split"` — localStorage 없음, `urlParam==="split"→"split"` 기본 unified.
- **`main.ts`는 이 순수 함수들을 호출**해 init 값을 얻고, 해당 토글 UI를 그 값으로 세팅(sync). 렌더/토글 로직 자체는 변경 없음.

## 검증 전략

1. **단위**: `parseArgs`(새 플래그 각각 + 조합 + 기본값), `buildDiffViewerUrl`(기본값과 다를 때만 파라미터 추가 — untracked/watch/flatten/tree/style 조합), 순수 resolver 5종(URL 우선 / localStorage 폴백 / 기본값).
2. **통합 스모크**: 빌드된 `dist/cli.js`를 `--untracked --split --tree-right --watch --no-flatten`로 spawn(--no-open) → 출력 URL에 `untracked=1&watch=1&flatten=0&tree=right&style=split`가 포함되는지 검증(기존 cli-smoke 패턴 재사용).
3. **불변식 회귀**: 순수 resolver 테스트가 "URL 파라미터 → 초기 상태" 매핑을 고정. (실제 브라우저 토글-sync는 헤드리스로 확인 가능하나, 순수 resolver + 토글 세팅이 결정적이라 단위로 충분; 필요 시 CDP 스모크는 선택.)
4. **전체 게이트**: `bun run typecheck` EXIT 0, `bun test` green, 뷰어+CLI 빌드 성공.

## 문서 (사용자 명시 — 필수 산출물)

- **`README.md`**: `## CLI` 옵션 표에 새 플래그 5개 추가(설명 + 기본값 + session-only 명시).
- **`CLAUDE.md`**: 프로젝트 문서의 관련 섹션(WHY의 뷰어 기능 설명 / HOW의 CLI) 갱신 — 새 launch 플래그와 session-only·토글 sync 동작 기록.

## 비목표 (Non-goals)

- **mode(working/base) CLI 플래그** — 기존 지속 파라미터와 의미 충돌(위 참조).
- **localStorage에 플래그 상태 지속** — 사용자 결정: session-only.
- 새 뷰어 기능 추가 — 기존 토글의 launch-time 노출만.
- 엔진(CodeView/trees) 변경.

## 불변 제약 (계승)

- 엔진 재작성 금지 — 이 기능은 CLI 인자 + URL 파라미터 + 뷰어 init 배선일 뿐.
- 외부 deps 추가 없음.
- 기존 `mode` 파라미터 동작(지속) 유지 — 건드리지 않음.
- 우선순위 로직은 순수 함수로 분리해 테스트(기존 prefs 패턴).

## 리스크 & 완화

- **토글 UI와 기능 상태 불일치**(핵심 요구 위반): init에서 기능 변수와 토글 input을 **같은 resolver 값**으로 세팅 → 구조적으로 sync 보장. 순수 resolver 단위 테스트로 고정.
- **URL 파라미터가 localStorage를 영구 오염**: session-only라 init에서 setItem 안 함으로 방지(기존 flatten/tree-side init도 안 씀). watch init만 주의(현재 localStorage read; URL 우선 시 setItem 금지).
- **URL 지저분**: 기본값과 다를 때만 파라미터 추가.
- **flatten 기본 on이라 `--flatten`이 아니라 `--no-flatten`** — 직관 혼동 방지 위해 README에 기본값 명시.

## 태스크 분해 (개략 — 상세는 writing-plans, TDD)

1. **순수 resolver + parseArgs 플래그**: `prefs.ts`에 resolveX 5종 + 단위; `args.ts` parseArgs 확장 + 단위.
2. **URL 조립 + CLI 배선**: `link.ts` buildDiffViewerUrl view 옵션(기본값과 다를 때만) + 단위; `cli.ts`가 전달; 통합 스모크.
3. **뷰어 init 배선**: `main.ts`가 resolver로 init + 토글 UI sync(untracked/watch/flatten/tree-side/split), localStorage 미기록.
4. **문서**: `README.md` CLI 표 + `CLAUDE.md` 갱신.
