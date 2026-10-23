---
paths:
  - "apps/preview/**"
  - ".github/workflows/preview.yml"
---

# PR 프리뷰 (`apps/preview/`, `preview.yml`)

PR마다 그 브랜치의 뷰어를 Cloudflare Worker로 띄우고 URL을 PR 댓글로 단다. 뷰어는 `git`을 부르는 로컬 서버가 있어야 그려지므로, 서버 대신 녹화본을 재생한다.

## 녹화와 재생

- 녹화(`record.ts`, 진입부 `cli.ts`): CI가 빌드한 뷰어와 체크아웃한 PR 브랜치로 `startDiffServer`를 임시 포트에 띄우고, 뷰어가 첫 화면에서 부르는 API(ping·refs·prs·summary·diff, 그리고 diff에 든 이미지의 blob)를 불러 `site/_snapshot/`에 담는다. 응답을 손으로 만들지 않는다 — 프리뷰가 그 커밋의 서버 동작을 보여야 한다. 실패 응답(400 등)도 그대로 담는다.
- 재생(`worker.ts`): `/api/*`는 `snapshotKey`(`snapshot.ts`)로 녹화본을 찾아 상태·헤더·본문을 돌려준다. 나머지는 정적 에셋이다. 맨 주소(`repo` 없음)는 녹화한 `repo`·`base`를 실은 뷰어 URL로 리디렉션한다.
- 스냅숏은 선택 하나만 담는다. 그래서 키에서 `repo`·`token`·`base`·`untracked`를 버린다(깨끗한 체크아웃이라 untracked가 결과를 바꾸지 않는다). `head`가 붙은 요청은 404다 — 피커로 고른 브랜치에 녹화본을 주면 고른 것과 다른 비교를 보여 준다.
- 녹화하는 쿼리는 뷰어(`main.ts`의 fetch, `imageDiff.ts`의 `blobUrl`)가 보내는 것과 같은 축이어야 한다. 뷰어가 새 API나 새 선택 축을 쓰게 되면 `record.ts`와 `snapshotKey`도 고친다. 어긋나면 프리뷰에서만 404가 난다.
- 녹화기는 토큰 파일을 임시 `XDG_CACHE_HOME`에 쓴다. 사용자의 캐시 디렉터리를 건드리지 않는다.

## 워크플로 (`preview.yml`)

- PR(같은 리포의 브랜치)은 `wrangler preview --name pr-<번호>`로 Workers Preview를 만들고 댓글 하나를 갱신한다(`gh pr comment --edit-last --create-if-none`). 닫히면 `wrangler preview delete`로 지운다. `main` 푸시와 `workflow_dispatch`(main)는 `wrangler deploy`로 본 Worker를 갱신한다. main에는 PR이 없어 base를 `HEAD~1`로 녹화한다(마지막 머지 커밋).
- 체크아웃은 머지 커밋이 아니라 브랜치(`head_ref`)다. 뷰어 라벨과 auto base(`gh pr view`)가 브랜치 이름을 읽는다. `fetch-depth: 0`이어야 `origin/main`이 생긴다.
- 시크릿 `CLOUDFLARE_API_TOKEN`(Workers Scripts 편집 권한)·`CLOUDFLARE_ACCOUNT_ID`가 없으면 `gate` 잡이 배포를 건너뛴다. 포크 PR도 시크릿이 오지 않아 건너뛴다. `pull_request_target`으로 우회하지 않는다 — 남의 코드를 토큰과 함께 돌리게 된다.
- 필수 체크가 아니다(룰셋에 넣지 않는다). Cloudflare 장애가 머지를 막으면 안 된다.
- wrangler는 devDep에 넣지 않고 `bunx wrangler@$WRANGLER_VERSION`(정확한 버전)으로 부른다. devDep이면 모든 잡의 `bun install`이 workerd까지 받는다. Workers Previews는 Wrangler 4.135.0 이상이고 open beta다.
- 정적 에셋은 파일 하나 25MiB가 상한이다. 빌드한 `main.js`가 가장 크다.

## 확인

- 로컬: `cd apps/viewer && bun run build`, 루트에서 `bun apps/preview/cli.ts`, 그다음 `bunx wrangler@<버전> dev --config apps/preview/wrangler.jsonc`. 로그인 없이 돈다.
- `cli.ts`는 커버리지 게이트 밖이다(`bunfig.toml`). 워크플로가 PR마다 실행한다.
