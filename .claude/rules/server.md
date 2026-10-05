---
paths:
  - "apps/viewer/server/**"
  - "apps/viewer/cli.ts"
  - "apps/viewer/cli/**"
  - "apps/viewer/__tests__/diff-*.test.ts"
  - "apps/viewer/__tests__/git-*.test.ts"
  - "apps/viewer/__tests__/prs.test.ts"
  - "apps/viewer/__tests__/repo-check.test.ts"
  - "apps/viewer/e2e/self-heal.e2e.ts"
  - "apps/viewer/e2e/daemon-cwd.e2e.ts"
---

# 뷰어 서버 (`apps/viewer/server/`)와 CLI

## 선택 축: base와 head

- 쿼리는 `selection.ts`의 `parseSelection` 한 곳에서만 해석한다. `/api/diff`·`/api/blob`·`/api/summary`가 각자 해석하면 텍스트 diff와 이미지 카드가 다른 기준을 본다.
- base(무엇과 견주나): `base=<ref>` 또는 `base=@auto`. 없으면 레거시 `mode=working|base`를 읽고, `base`가 있으면 `mode`는 무시한다. `@auto` 표식은 실제로 `auto`라는 브랜치와 구별하려는 것이다. 레거시 `mode`는 지우지 않는다 — `link.ts`가 만드는 외부 링크가 아직 `mode=`를 쓴다.
- `base=HEAD`는 `parseBase`가 head 종류로 정규화한다. 중복처럼 보여도 지우지 않는다: 커밋이 없는 리포에서 `rev-parse --verify HEAD`가 실패해 첫 화면이 실패 카드가 되고, `head`와 `ref:HEAD`는 서로 다른 캐시 슬롯이라 prewarm이 데운 항목을 아무도 쓰지 않게 된다.
- head(무엇을 보나): `head=<ref>`. 없거나 비면 워킹트리다.
  - 커밋된 head를 보는데 base가 워킹트리면 `parseSelection`이 base를 auto로 올린다. 그대로 두면 `git diff <rev> <rev>`가 되어 에러 없이 빈 화면이 된다. 사용자가 고른 진짜 base는 그대로 둔다. 같은 규칙이 브라우저 피커(`applyPick`)에도 있으니 바꿀 때 둘 다 바꾼다.
  - `head=HEAD`는 정규화하지 않는다 — 커밋된 HEAD를 보는 것이라 미커밋 변경이 빠진다.
  - 갈림점은 `merge-base(base, head)`로 잰다. 워크트리의 HEAD로 재면 base가 그 사이 만든 파일이 "head에서 삭제됨"으로 섞인다.
  - 커밋된 head에는 untracked가 없다(토글이 켜져 있어도 건너뛴다). 그때 `/api/summary`의 `workingFiles`·`untrackedFiles`는 0이 아니라 `null`이다 — 재지 않은 값을 0으로 적으면 카드가 "볼 것이 없다"고 주장한다.
- 사용자가 고른 base·head는 `verifyBaseRef`(`diff.ts`)를 통과시킨다. 보안 경계다: Bun `$`도 `Bun.spawn` 인자 배열도 git의 옵션 파싱을 막지 않아서, `-`로 시작하는 ref가 `git diff`에 닿으면 `--output=<path>`로 아무 파일이나 쓸 수 있다. `rev-parse --verify`가 옵션 꼴을 거부하더라도 `-` 접두 검사를 따로 둔다.
- `verifyBaseRef`는 짧은 이름을 브랜치의 전체 refname으로 고정해 git에 넘긴다(`refs/heads/` → `refs/remotes/` → 이름 그대로). git은 같은 이름이면 태그를 브랜치보다 먼저 해석하는데 피커가 고르는 것은 브랜치다. auto base(`resolveBaseRef`)도 같은 이유로 전체 refname을 쓴다. wire·URL은 짧은 이름 그대로다. 회귀망은 `diff-server.test.ts`의 동명 브랜치·태그 픽스처다(태그를 브랜치와 다른 커밋에 붙여야 판별력이 있다).
- 존재하지 않거나 옵션 꼴인 ref는 400이고 `x-diff-error`가 `unknown-base`/`unknown-head`로 어느 축인지 가른다. 조용히 auto로 바꾸지 않는다(고르지 않은 기준의 diff가 에러보다 나쁘다). 브라우저 목록과 대조하지는 않으므로 존재하는 태그·SHA·`HEAD~1`은 통과한다.
- `git diff`의 ref 인자 뒤에는 `--`를 붙인다. ref 이름이 트래킹된 경로(`docs`·`src`)와 같으면 git이 `ambiguous argument`로 죽는데, 출력을 버리는 호출이라 "변경 없음" 화면이 된다. 회귀망은 `diff-command.test.ts`의 "브랜치 이름 = 트래킹된 디렉토리 이름" 픽스처다(평범한 `feat`/`main` 픽스처로는 원리적으로 못 잡는다). `summary.ts`의 카드 카운트용 `diff --name-only`도 같은 계약인데 그쪽은 회귀 테스트가 없다.
- `selectionCacheKey`에는 flight가 실제로 읽는 입력을 빠짐없이, 그것만 넣는다. 해석된 base ref는 이름으로 넣는다(OID를 넣으면 커밋마다 슬롯이 늘어 LRU가 헛돈다 — 내용 변화는 head rev를 포함한 지문이 잡는다). 워킹트리 뷰의 키에는 해석된 auto ref를 넣지 않는다(origin/HEAD가 움직일 때마다 캐시가 날아간다).

## `/api/refs` (`refs.ts`)

- git 호출 두 번: `for-each-ref`(필드 구분자 NUL — refname에 `|`가 들어갈 수 있다)와 `worktree list --porcelain -z`.
- `for-each-ref` 출력은 레코드 사이에 개행이 하나 끼므로 필드마다 선행 개행 하나만 벗기고, 후행 빈 항목은 정확히 하나만 벗긴다(전부 벗기면 빈 `symref` 레코드가 사라진다).
- 죽은 워크트리(`prunable`)와 `bare`는 목록에서 뺀다. git은 디렉토리가 지워진 워크트리도 브랜치와 함께 계속 내보낸다.
- 리포 루트는 `parseRepoRoot`가 `worktree list` 원본의 첫 레코드에서 읽는다. 걸러낸 `parseWorktreeList` 결과를 쓰면 bare 리포에서 첫 항목이 링크된 워크트리가 된다.

## `/api/prs` (`prs.ts`)

- `gh pr list --state all --limit 100 --json …` 한 번으로 받아 head 브랜치 이름별로 묶는다. 브랜치마다 `gh pr view`를 부르지 않는다.
- 한 브랜치에 여럿이면 열린 PR(draft 포함)이 이기고, 같은 부류에서는 먼저 온 것(최신)이 이긴다.
- 남의 포크 PR(`isCrossRepository`)은 빼되, `headRepositoryOwner.login`이 `origin` 소유자(`remoteOwner`)와 같으면 남긴다 — 포크 워크플로에서는 내 PR이 전부 cross-repository로 온다.
- 결과 맵은 `Object.create(null)`이다. 브랜치 이름이 `__proto__`일 수 있다.
- 실패는 던지지 않고 빈 결과를 준다(부가 정보다). 서버 안에서는 "PR 없음"(`{}`)과 "못 받음"(`null`)을 구별해 성공은 60초, 실패는 `PRS_FAILURE_TTL_MS`(10초)만 캐시한다. `gh`는 10초 타임아웃으로 띄운다.
- `/api/refs`에 합치지 않는다 — refs는 watch 폴마다 돌고 `gh`는 네트워크를 탄다.

## 리포 판별 (`repoCheck.ts`)

- 다섯 라우트(diff·summary·refs·prs·blob)가 요청마다 flight보다 먼저 `classifyRepo`를 부르고, 결과를 `x-diff-error`에 싣는다: `no-repo`·`repo-missing`·`not-a-repo`·`unsafe-repo`·`no-worktree`·`git-unavailable`.
- `repo-missing`은 git보다 먼저 `existsSync`로 본다(git은 없는 경로에도 128을 낸다). `unsafe-repo`는 stderr의 `safe.directory`로 가른다(로캘 무관).
- `not-a-repo`의 응답 본문만 옛 문자열을 유지한다(외부 소비자가 있다). 기계가 읽을 곳은 표식이다.

## Bun `$`와 git 출력 크기

- Bun 1.3.x의 `$`는 64KB가 넘는 stdout을 받으면 resolve도 reject도 없이 영원히 pending일 수 있다(호출이 겹치면 거의 확정, 1.4.0에서 수정). 출력이 리포 크기를 따라 커질 수 있는 git 호출은 `gitOutput.ts`의 `gitBytes`/`gitText`(`Bun.spawn`)로 쓴다. `$`는 `rev-parse`·`merge-base`처럼 출력이 작은 호출에만 남긴다. 되돌리지 않는다.
- 그 회귀망은 Bun 1.3.x에서만 판별력이 있어 1.4 이상에서 도는 CI는 행업을 잡지 못한다(`testing.md`). `summary.ts`와 `worktree list`가 `$`로 돌아가는 것은 어떤 테스트도 잡지 못한다.
- 서버 코드는 npm 패키지를 import하지 않는다(지금은 Bun과 node 빌트인만 쓴다). `cli.js`가 Bun과 node 빌트인만 쓰는 배포 계약이다(`ci-release.md`).
- flight가 매달려도 회복하는 장치 셋은 함께여야 동작한다: ① `singleFlight`가 flight를 타임아웃과 race해 키를 풀고(`SingleFlightTimeoutError`), ② `awaitFlight`가 타임아웃만 503 + `Retry-After`로 바꾸고(다른 에러는 다시 던진다), ③ 브라우저 `fetchDiff`가 503·네트워크 실패를 한 번 재시도한다(403·400은 재시도하지 않는다). 키를 풀지 않으면 재시도가 같은 죽은 프라미스에 합류한다. 회귀망은 `diff-server.test.ts`의 실제 HTTP 503 경로와 `self-heal.e2e.ts`다.
- 큰 출력의 `$`를 전부 옮겼어도 flight 타임아웃은 지우지 않는다. 원인을 가리지 않는 안전망이다(예: base 해석의 `gh pr view`는 네트워크를 기다린다).
- `Retry-After`(1초)와 브라우저의 `RETRY_DELAYS_MS`는 같은 값으로 맞춰 둔다 — fetch는 `Retry-After`를 저절로 지키지 않는다.
- `/api/diff`는 base 해석 flight와 diff flight를 순서대로 기다린다. 두 타임아웃의 합(45+45초)이 `Bun.serve`의 `idleTimeout`(120초)보다 작아야 한다.
- 재시도 횟수를 늘리거나 prewarm을 동시에 돌리지 않는다. 큰 blob이 많은 diff는 파일별 git 프로세스가 `BUILD_CONCURRENCY`(호출당 상한)만큼 뜨므로, 시도가 겹치면 프로세스가 배로 늘어난다.
- flight 밖에서 도는 호출은 이 보호를 받지 않는다: `classifyRepo`, 사용자가 고른 base·head의 `verifyBaseRef`, `getRepoSummary`, `getFileBytes`.

## blob 캐시 (`blobCache.ts`)와 프리페치

- 목록은 `git diff --raw -z --no-abbrev`(`parseRawZ`)로 뽑아 파일마다 blob OID를 얻고, 그 OID로 old 쪽(head 모드면 new 쪽도) 바이트를 재사용한다.
- 키는 전체 OID이고, 값도 그 OID로 읽는다(`git show <oid>`). 이름(`HEAD`·브랜치·`HEAD:<path>`)으로 읽으면 목록과 읽기 사이에 ref가 움직일 때 새 내용이 옛 OID 아래 세션 내내 남는다.
- `git show`가 0으로 끝났을 때만 저장한다(`gitRun`). 서브모듈(gitlink) OID는 키로 쓰지 않는다. 워킹트리 모드의 new 쪽은 캐시하지 않는다(디스크가 진실이다).
- OID는 캐시 키로만 쓴다. 무엇을 읽을지는 파일 상태가 정하고, `blobsToRead`는 `buildFile`과 같은 조건이어야 한다.
- 캐시가 돌려주는 배열은 저장본 그 자체다 — 호출자가 고치면 캐시가 오염된다.
- 캐시에 없는 작은 blob은 `cat-file --batch` 한 번으로 미리 읽는다(`gitCatFileBatch`). 배치 출력은 한 버퍼에 오르므로 큰 blob은 넣지 않는다: `cat-file --batch-check`(`gitCatFileSizes`)로 크기를 재고 `pickForBatch`가 `PREFETCH_LIMITS` 안의 것만 고른다.
- 배치 결과는 캐시가 아니라 그 빌드용 맵으로 넘기고, 실제로 쓸 때 캐시에 넣는다. 캐시 확인은 `has()`로 한다(hit/miss 통계와 LRU를 흔들지 않는다). 배치 리더는 헤더의 크기로 내용을 자르고(내용에 개행·NUL이 있다), 없는 객체를 빈 바이트로 담지 않으며, 담는 바이트는 복사본이다(배치 버퍼 전체를 붙잡지 않는다). 배치에 없는 것만 OID로 파일별 `git show`를 한다.
- 캐시는 `createHandler`마다 하나다(prewarm과 `/api/diff`가 공유한다).

## 테스트 전제로 고정된 구조

- `server.ts`의 `baseCache`는 모듈 스코프에 둔다(`diffCache`처럼 `createHandler` 안으로 옮기지 않는다). `diff-server.test.ts`의 "diffFlight 타임아웃" 테스트는 다른 서버가 데운 항목을 봐야 diffFlight까지 도달한다 — 옮기면 실패하지 않고 조용히 다른 가드만 증명한다. 그 테스트와 짝 테스트는 정반대 조건(캐시 미스/히트)에 기대므로 공용 픽스처로 합치지 않는다.

## 프로세스 cwd

- cwd가 삭제된 프로세스는 자식 프로세스를 띄울 수 없다(OS 제약이라 `.cwd(repo)`도 `Bun.spawn`도 `ENOENT: posix_spawn`으로 죽는다). cc-statusline이 띄운 장수 데몬이 기동한 워크트리가 지워진 뒤에도 계속 도는 경우다. 그래서 `cli.ts`는 `repo`를 읽은 직후 `toSafeCwd()`로 `/`로 옮긴다(먼저 옮기면 `repo`가 `/`가 된다).
- `startDiffServer`는 라이브러리라 `chdir`하지 않는다. `repairCwd`가 주입됐을 때만 요청 진입부에서 `isCwdAlive`로 감지하고 복구를 부른다(주입이 없으면 감지도 하지 않는다).
- 감지는 `existsSync(process.cwd())`이고, `process.cwd()`가 throw해도 죽은 것으로 본다. `existsSync(".")`·`statSync(".")`는 열린 cwd 디스크립터 때문에 항상 true다.
- 모든 git·gh 호출은 repo를 명시적으로 조준한다(`git -C <repo>` 또는 `cwd: repo`). cwd에 기대는 호출을 새로 만들지 않는다. 같은 이유로 `cfg.viewerDir`은 절대경로여야 하고(chdir 뒤에 resolve된다), `/api/blob`(`getFileBytes`)의 경로 탈출 가드와 실제 읽기는 둘 다 `repo`를 기준으로 푼다 — 한쪽만 cwd 기준이 되면 가드가 엇나간다.
- 회귀망: `daemon-cwd.e2e.ts`는 예방과 자가회복 중 하나만 살아 있어도 통과한다. 각각은 `cli-run.test.ts`(예방)와 `diff-server.test.ts`(자가회복)가 지킨다.
- 증상: repo와 무관하게 모든 라우트가 400 `could not run git`(`x-diff-error: git-unavailable`)인데 `/api/ping`은 204다. 403이면 토큰·포트 문제다.

## 기동 prewarm

`cli.ts`는 서버를 띄운 뒤 `prewarmDiff`(`prewarm.ts`)로 `/api/diff`를 working·base 순으로 한 번씩 불러 캐시를 데운다(best-effort, 실패해도 무시). 동시에 부르지 않는다(위 `BUILD_CONCURRENCY` 이유).
