---
paths:
  - ".github/**"
  - "release-please-config.json"
  - ".release-please-manifest.json"
  - "CHANGELOG.md"
  - ".claude-plugin/**"
  - ".codex-plugin/**"
  - ".agents/**"
  - "package.json"
  - "apps/viewer/package.json"
  - "apps/viewer/build.ts"
---

# CI와 릴리스

## PR 체크 (`.github/workflows/pr-check.yml`)

- 잡 6개(lint — format:check 스텝 포함 · typecheck · test · coverage · e2e · test-bun13)가 `main` 룰셋의 필수 체크다. 잡 이름을 바꾸거나 지우면 룰셋도 같이 고친다 — 룰셋은 이름으로 기다려서, 없어진 이름 때문에 모든 PR이 막힌다. 룰셋: `gh api repos/say8425/diffdeck/rulesets/18998573`.
- 우회자(`bypass_actors`)가 없어 관리자도 빨간 CI로 머지하지 못한다. `strict`(최신 `main` 포함 요구)는 끈다 — 켜면 머지마다 열린 PR의 e2e를 다시 돌려야 한다. flake는 `gh run rerun <id> --failed`로 다시 돌린다.
- Bun 버전을 고정하는 잡은 `test-bun13`(1.3.14)뿐이고, 나머지는 setup-bun 기본값(최신)을 따른다. 루트 `package.json`에 `packageManager`나 `engines.bun`을 넣으면 그 다섯 잡의 Bun이 조용히 바뀐다.
- `test-bun13`은 최신 Bun에서는 보이지 않는 `$` 행업 회귀망을 돈다. 이 잡에는 `bun install`을 넣지 않는다 — 최신 Bun이 lockfile 포맷을 바꾸는 날 회귀와 무관하게 빨개진다. 지원 하한이 Bun 1.4 이상이 되면 잡과 룰셋 항목을 함께 지운다.
- 나머지 잡은 `bun install --frozen-lockfile`로 설치한다. e2e 잡은 Node를 고정하고 `playwright install --with-deps chrome`으로 실제 Chrome을 깐다(`channel: "chrome"`). 실패하면 `apps/viewer/test-results/`를 아티팩트로 올린다.
- e2e는 골라 돌리지 않고 전부 돈다 — 어느 계약이 깨질지 미리 알 수 없다.

## 릴리스 (release-please → npm)

- `release.yml`의 release-please(배포 패키지는 `apps/viewer` 하나)가 conventional commits로 릴리스 PR을 만든다. 사람이 머지하면 릴리스·태그가 생기고 publish 잡이 `apps/viewer`에서 `bun run build` + `npm publish --provenance --access public`을 돈다.
- 릴리스 PR은 자동 머지하지 않는다. 릴리스는 npm 배포라 사람의 리뷰를 거치고, `GITHUB_TOKEN`으로 머지하면 그 push가 워크플로를 트리거하지 않아 publish가 돌지 않는다.
- 릴리스 PR의 CI는 `action_required`로 멈춰 있다(release-please가 `GITHUB_TOKEN`으로 푸시한다). 사람이 `gh run rerun <id>`로 돌려야 필수 체크가 채워진다. id 찾기: `gh api "repos/say8425/diffdeck/actions/runs?head_sha=$(gh pr view <N> --json headRefOid -q .headRefOid)" --jq '.workflow_runs[0].id'`.
- 게이트는 `== 'true'`로 비교한다. action은 아무것도 만들지 않아도 `"false"` 문자열을 내보내고, GHA는 비어 있지 않은 문자열을 참으로 본다.
- `changelog-path`는 `"/CHANGELOG.md"`다. 앞의 `/`가 패키지 접두를 생략해 레포 루트를 가리킨다(문서화되지 않은 `addPath()` 동작 — `extra-files`의 `/.claude-plugin/plugin.json`·`/.codex-plugin/plugin.json`이 같은 방식으로 bump된다). `../CHANGELOG.md`는 설정 시점엔 조용하다가 릴리스 실행 중에 throw한다. CHANGELOG를 옮길 때는 `git mv`를 같은 커밋에 넣는다(release-please는 새로 만들 뿐 옮기지 않는다).
- publish 인증은 trusted publishing(OIDC, 토큰 없음)이다. Node ≥ 22.14 + npm ≥ 11.5.1과 `id-token: write`가 필요하다. npm에 등록된 trusted publisher는 org `say8425`, repo `diffdeck`, workflow `release.yml`이다.
- 저장소 설정 "Allow GitHub Actions to create and approve pull requests"가 켜져 있어야 릴리스 PR이 만들어진다(꺼져 있으면 PR 생성 단계에서만 실패한다). 다시 켜기: `gh api -X PUT repos/say8425/diffdeck/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`.

## 배포 산출물

- `dist/cli.js`(셰뱅 `#!/usr/bin/env bun` + 실행권한, `// @bun` 마커는 그 다음 줄) · `dist/viewer/`(`main.js`·`worker.js`·`index.html`·`fonts/`) · `dist/skills/diffdeck/SKILL.md`.
- `apps/viewer/package.json`에는 `dependencies`가 없다. `cli.js`는 Bun과 node 빌트인만 쓰고, `main.js`는 shiki와 문법을 전부 품는다(`worker.js`는 엔진만 들고 문법은 풀이 postMessage로 보낸다). 새 런타임 import를 넣으면 `bun run build` 뒤 산출물에 실제로 들어갔는지 확인한다 — external로 남으면 사용자 환경에는 없다. 미니파이 번들은 사실상 한 줄이라 `grep -c`가 아니라 `grep -o … | wc -l`로 센다.
- npm은 `files`와 무관하게 `README.md`·`package.json`을 싣는다. `apps/viewer/README.md`가 npm 패키지 페이지다.
