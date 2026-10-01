---
paths:
  - "bunfig.toml"
  - "**/*.test.ts"
  - "**/__tests__/**"
  - "scripts/parity/preload.ts"
  - "scripts/css-inline-plugin.ts"
---

# 유닛·통합 테스트 (`bun test`)

- `bunfig.toml`의 preload는 `scripts/parity/preload.ts` 하나다. css-inline 플러그인의 런타임 변형(`cssInlineRuntimePlugin`)을 등록해 포크 패키지의 `import styles from "../style.css?inline"`이 실제 CSS 텍스트로 풀리게 한다. 빌드는 같은 모듈의 번들러 변형(`cssInlineBundlerPlugin`)을 쓴다.
- happy-dom 전역 등록을 preload에 넣지 않는다. 테스트 런 전체의 fetch·URL·Response 등이 happy-dom 구현으로 바뀌어, 실제 HTTP 서버를 띄우는 테스트(diff-server·built-serving 등)가 무더기로 죽는다. DOM이 필요한 테스트 파일만 맨 위에서 `import "./happydom";`으로 켠다(`packages/trees/src/__tests__/`와 `apps/viewer/__tests__/`에 각자의 등록 모듈이 있다).
- `bun test`는 모든 파일을 한 프로세스에서 돌리므로 파일 단위 등록도 다른 파일로 샌다. `apps/viewer/__tests__/happydom.ts`가 등록 직후 네이티브 네트워크 전역을 되돌리는 이유다 — 그 목록을 줄이지 않는다.
- Bun `$` 템플릿에 비ASCII를 **리터럴**로 적으면 `uAE30…` 같은 ASCII로 뭉개진다(Bun 1.3.12에서 실측). 한글 브랜치·파일명은 `${보간}`으로 넘긴다 — 리터럴로 쓰면 한글이 아닌 이름을 만들고 조용히 통과한다.
- git 출력 행업 회귀망(`git-output`·`git-large-output`·`git-cat-file-batch`)은 Bun 1.3.x에서만 판별력이 있다(CI `test-bun13` 잡). 그 잡은 `bun install` 없이 돌므로 이 파일들은 설치 없이 도는 상태를 유지한다(내장 모듈과 로컬 파일만 쓴다).
- 실제 `gh`를 부르는 서버 테스트 케이스는 `GH_REPO`가 설정된 환경에서 건너뛴다(그때 `gh`는 픽스처의 원격 부재를 무시하고 그 리포의 PR을 답한다).
