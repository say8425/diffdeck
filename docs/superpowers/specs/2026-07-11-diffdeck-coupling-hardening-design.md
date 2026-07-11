# diffdeck Plan 4 — 커플링 하드닝 설계

**날짜**: 2026-07-11
**상태**: 설계 확정 (writing-plans 대기)
**선행**: Plan 1 Foundation + Plan 2(viewer 앱) + Plan 3(de-preact) 완료. trees는 vanilla, preact 제거됨. `apps/viewer`가 `@diffdeck/{diffs,trees}`를 소비.

## 목표

diffdeck이 vendored 엔진(`@diffdeck/diffs`·`@diffdeck/trees`)의 **내부 마크업/정렬 규칙에 암묵적으로 결합**한 지점들을 **명시적·테스트된 계약으로 승격**하고, 미사용 데드코드(react 어댑터)를 제거한다. 포크의 원래 동기("이미 많이 개조 — 헤더 폴드·복사 버튼·이미지 카드·인앱 검색·flatten을 pierre 내부 마크업에 결합해 얹어 씀")를 안정화한다: 엔진 마크업이 바뀌면 **뷰어가 조용히 깨지는 대신 canary 테스트가 시끄럽게 실패**하도록.

## 범위 (What) — 3개 독립 스레드

### A. diffs 내부 마크업 계약화 (상수 + canary)

`apps/viewer/browser`가 `@diffdeck/diffs`의 내부 DOM에 하드코딩 결합한 문자열:
- `diffs-container` — CodeView가 파일별로 렌더하는 커스텀 엘리먼트 태그 (main.ts:36,147,159,205; imageCard.ts:9,80)
- `data-diffs-header` — 파일 헤더 바(폴드·이미지카드 앵커) (main.ts:35,65,211,215; imageCard.ts:82)
- `data-fold` — 폴드 상태 속성 (main.ts:37,72,149)
- `data-title` — 헤더 내 파일명 노드(copy 버튼 주입점, shadow DOM) (main.ts:171)
- shadow DOM 순회(`composedPath`, `shadowRoot`, `querySelector('#diffs-…')`)

**계약화**: 이 문자열들을 `@diffdeck/diffs`가 **공개 상수로 export**(예: `DIFFS_CONTAINER_TAG`, `DIFFS_HEADER_ATTR`, `DIFFS_FOLD_ATTR`, `DIFFS_TITLE_ATTR`). 뷰어는 리터럴 대신 상수를 import. **canary 테스트**: diffs 엔진이 실제로 그 태그/속성을 emit하는지 렌더 어서션(엔진 내부 변경 시 실패). 상수는 엔진 렌더 코드가 실제 쓰는 값과 **single source**여야 함(상수를 export만 하고 엔진은 여전히 리터럴을 쓰면 계약이 거짓 → 엔진 렌더도 상수를 참조하도록, 또는 canary가 리터럴↔상수 일치를 보장).

### B. 정렬 comparator 단일화

`apps/viewer/browser/fileOrder.ts`의 `sortFilesLikeTree`는 `path-store/src/sort.ts`의 규칙(디렉터리 우선 + 대소문자 무시 자연 정렬)을 **손으로 복제**(파일 주석에 명시). path-store는 `compareSegmentValues`/`comparePreparedPaths` 등을 export하지만 **plain path-string 리스트용 comparator는 없음**.

**단일화**: path-store(또는 trees)가 **공개 path-string tree-order comparator**를 export(예: `comparePathsInTreeOrder(a: string, b: string): number` 또는 `sortPathsInTreeOrder(paths: string[]): string[]`) — 내부적으로 기존 `compareSegmentValues` + 디렉터리-우선 로직 재사용. 뷰어는 이를 import해 `fileOrder.ts`의 복제 로직을 **삭제**. 기존 `viewer-file-order.test.ts`는 단일화된 comparator로 repoint(동일 순서 보장). 이로써 뷰어 트리 순서와 diff 아이템 순서가 엔진과 **드리프트 불가**.

### C. react 어댑터 데드코드 제거

`packages/diffs/src/react/`(CodeView.tsx·File.tsx·FileDiff.tsx·MultiFileDiff.tsx·PatchDiff.tsx·Virtualizer.tsx·WorkerPoolContext.tsx 등 ~13파일)과 `packages/trees/src/react/`(FileTree.tsx·useFileTree*.ts·jsx.d.ts 6파일)은 각 `index.ts`에서 **미export**(소비자 없음, 데드). `react` dep은 diffs·trees·theming의 package.json에 어댑터 전용으로 존재.

**제거**: 두 `react/` 디렉터리 삭제 + 세 package.json에서 `react` devDep/optional peer 제거 + react JSX tsconfig 정리(어댑터 삭제 후 diffs는 react JSX override 불필요; vanilla CodeView가 JSX를 쓰는지 확인 후 조정). 삭제 전 각 파일의 live importer 0 확인(닫힌 클러스터 검증). theming의 react 의존이 실제 코드 참조인지(테마 훅?) vs 순수 devDep인지 확인 후 판단.

## 비목표 (Non-goals)

- **CodeView(diffs) vanilla 엔진 로직 변경 금지** — 상수 참조 배선 외 렌더 로직 오버홀 금지(Foundation 원칙 계승).
- **trees 뷰 추가 리팩터 금지** — Plan 3 결과 유지. (Plan 3의 watch-재렌더 포커스 미복원 등 Minor는 여기서 다루지 않음 — 별도.)
- **cc-statusline·CLI·배포 미포함** (Plan 5).
- **새 기능 없음** — 순수 하드닝/정리.
- 마크업 계약을 **과도하게 일반화하지 않음** — 뷰어가 실제 결합한 문자열만 상수화(YAGNI).

## 검증 전략

1. **canary 테스트(A)**: diffs 엔진을 fixture로 렌더 → `DIFFS_CONTAINER_TAG`/`*_ATTR` 상수 값이 실제 DOM에 나타나는지 어서션. 엔진이 마크업을 바꾸면 실패. (happy-dom; per-file registrator.) 상수와 엔진 리터럴의 일치도 어서션.
2. **comparator 동치 테스트(B)**: 단일화된 comparator가 기존 `sortFilesLikeTree`와 **동일 순서**를 내는지(기존 `viewer-file-order.test.ts` 케이스 + 트리 fixture) — 회귀 0 보장.
3. **데드코드 제거 게이트(C)**: 삭제 후 `bun run typecheck`(5→조정된 configs) green, `bun test` 전체 green, viewer/parity 빌드 성공, `grep -rn "src/react" ` live importer 0, react dep 잔존 0.
4. **전체 회귀**: 뷰어 빌드(10.49MB급) + parity 빌드 유지.

## 태스크 분해 (개략 — 상세는 writing-plans, TDD)

1. **diffs 마크업 상수 export + canary**: diffs가 `DIFFS_CONTAINER_TAG`·`DIFFS_HEADER_ATTR`·`DIFFS_FOLD_ATTR`·`DIFFS_TITLE_ATTR` export(엔진 렌더가 참조하는 single source), canary 렌더 테스트.
2. **뷰어를 상수로 배선**: `main.ts`·`imageCard.ts`의 리터럴을 diffs 상수 import로 치환. 기존 뷰어 테스트 green 유지.
3. **path-string comparator 노출**: path-store(또는 trees)에 `comparePathsInTreeOrder`/`sortPathsInTreeOrder` + 단위 테스트(기존 sort 원시자 재사용).
4. **뷰어 comparator 단일화**: `fileOrder.ts` 복제 삭제 → 공개 comparator 재사용, `viewer-file-order.test.ts` repoint(동일 순서).
5. **react 어댑터 제거**: `diffs/src/react`·`trees/src/react` 삭제, react dep 제거(diffs·trees·theming), tsconfig JSX 정리, 전체 게이트 green.

## 불변 제약 (계승)

- 엔진(CodeView·컨트롤러) 재작성 금지 — 상수 배선만.
- 외부 deps 정확 버전 핀. react 제거는 어댑터가 유일 소비처일 때만.
- 라이선스·NOTICE 보존.
- 패키지별 tsconfig 루프 유지(react 제거 후 diffs JSX 재점검).

## 리스크 & 완화

- **상수가 계약의 single source가 아니면 canary가 거짓 안심**: 엔진 렌더 코드가 상수를 참조하도록 배선하거나(선호), 최소한 canary가 "엔진 리터럴 == export 상수"를 어서션.
- **react 제거가 diffs vanilla 빌드/JSX를 깸**: 삭제 전 vanilla CodeView가 react JSX에 의존하지 않음을 확인(별도 vanilla 렌더 경로). tsconfig의 react override가 어댑터 전용이었는지 검증 후 정리.
- **theming의 react 참조가 코드 의존일 수 있음**: 삭제 전 theming/src에서 react import 실사용 여부 grep — 순수 devDep이면 제거, 코드 참조면 그 부분만 남기고 flag.
- **comparator 동치 미보장**: 동치 테스트로 기존 순서 100% 재현 확인 후에만 복제 삭제.
