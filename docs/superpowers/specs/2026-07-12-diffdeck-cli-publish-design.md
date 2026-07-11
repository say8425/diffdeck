# diffdeck Plan 5 — CLI + Publish Prep 설계

**날짜**: 2026-07-12
**상태**: 설계 (writing-plans 대기)
**선행**: Plan 1-4 완료. `apps/viewer`가 포크 패키지(`@diffdeck/{diffs,trees,path-store,theming}`)를 소비하는 vanilla 뷰어 + self-contained diff 서버. `apps/viewer/serve.ts`는 검증용 임시 부트스트랩(브라우저 미오픈, dist 선빌드 필요).

## 목표

diffdeck을 **`bunx @say8425/diffdeck`로 실행 가능한 독립 CLI 제품**으로 만든다. 임의의 git repo에서 실행하면 diff 서버를 띄우고 브라우저로 뷰어를 연다. npm 배포에 필요한 모든 준비(번들·package.json·문서)를 갖추되, **실제 `npm publish`는 사용자 확인 게이트**(outward-facing)로 남긴다.

## 아키텍처

- **`apps/viewer`가 배포 패키지 `@say8425/diffdeck`이 된다** (현재 `@diffdeck/viewer`, private). 서버·뷰어·CLI가 전부 여기 있고, 포크 패키지는 **build-time에 dist로 번들**되므로 배포물은 self-contained(런타임 `@diffdeck/*` 의존 0, git·gh 외부 도구만 사용). cc-statusline 배포 패턴(`bin`+`files:[dist]`+`publishConfig` npmjs+`target:"bun"` 번들)을 그대로 따른다.
- **런타임**: Bun (cc-statusline과 동일). bin은 bun 스크립트. `bunx`가 bun으로 실행.
- **repo 전달**: 서버는 이미 repo-agnostic — repo를 URL 쿼리(`?repo=<path>&token=<token>`)로 per-request 받음(뷰어 `main.ts`가 읽음). CLI는 `cwd`를 repo로 브라우저 URL에 넣는다.

## 컴포넌트 (What)

### 1. CLI 엔트리 `apps/viewer/cli.ts`

- **인자 파싱**(순수 함수 `parseArgs(argv): {port?, open, help, version}`로 분리해 TDD): `--port <n>`(기본 `DIFFDECK_PORT` env → 49573), `--no-open`(브라우저 자동 오픈 비활성), `--help`, `--version`.
- **URL 조립**(순수 함수 `buildViewerUrl(port, repo, token): string`으로 분리해 TDD): `http://127.0.0.1:<port>/?repo=<encoded cwd>&token=<token>`.
- **동작**: `startDiffServer({port, viewerDir})` 호출(viewerDir = 번들된 `dist/viewer`), 토큰 획득, URL 출력, `--no-open`이 아니면 브라우저 자동 오픈(크로스플랫폼: macOS `open` / linux `xdg-open` / win `cmd /c start` — `Bun.spawn`, 순수 함수 `openerCommand(platform, url): string[]`로 분리해 TDD), SIGINT에서 graceful stop.
- **저중요**: `--help`/`--version`은 즉시 출력 후 exit. 서버 시작 실패(포트 점유 등)는 명확한 에러 메시지 + 비정상 exit.

### 2. 번들 빌드 (`apps/viewer/build.ts` 확장)

- 기존 뷰어 번들(`dist/viewer/main.js` + `dist/viewer/index.html`)에 더해 **CLI 번들** 추가: `cli.ts` → `dist/cli.js`(`target:"bun"`, minify 불필요). 서버 소스(`server/*.ts`)는 이 번들에 포함됨(cli가 import). 산출 레이아웃:
  ```
  dist/
    cli.js              # bin 엔트리 (서버 + CLI 번들, target bun)
    viewer/
      main.js           # 브라우저 뷰어 (포크 패키지 번들 포함)
      index.html
  ```
- `cli.ts`는 런타임에 `viewerDir = ${import.meta.dir}/viewer`(= `dist/viewer`)로 해석.

### 3. 최소 리브랜딩 (user-facing surface만)

독립 제품이 cc-statusline 브랜드 env/cache/header를 노출하면 혼란스러우므로 **CLI가 노출하는 표면만** 리브랜딩(전체 provenance 주석 리브랜딩은 비목표):
- `server/config.ts`: `CC_STATUSLINE_DIFF_PORT`→`DIFFDECK_PORT`, `CC_STATUSLINE_DIFF_DISABLE`→`DIFFDECK_DISABLE`, `getCacheDir`의 `"cc-statusline"`→`"diffdeck"`(토큰 경로 `~/.cache/diffdeck/`).
- `server/server.ts`: `/api/ping` 응답 헤더 `x-cc-statusline`→`x-diffdeck`.
- 관련 테스트(diff-config·server) 갱신.
- **비목표**: 내부 주석·변수명의 "Pierre"/"cc-statusline" provenance 흔적 전면 정리는 별도(YAGNI). diffdeck 독립 token 경로라 cc-statusline과 충돌 없음.

### 4. 배포용 package.json (`apps/viewer/package.json`)

- `name` `@diffdeck/viewer`→`@say8425/diffdeck`, `private` 제거, `version` `0.1.0`(초기 pre-1.0 release), `bin` `{"diffdeck":"dist/cli.js"}`, `files` `["dist"]`, `type:"module"`, `publishConfig` `{"registry":"https://registry.npmjs.org"}`, `repository`(github say8425/diffdeck), `description`.
- **`@diffdeck/*` deps를 `devDependencies`로 이동** — build-time 전용(dist에 번들됨), 배포물엔 런타임 의존 0(`workspace:*`는 npm 배포 시 유효하지 않으므로 반드시 번들). `files:["dist"]`가 소스 제외, dist만 배포.
- `scripts`: `build`(bun build.ts), `start`(bun cli.ts) 등 로컬 편의.

### 5. 스모크 테스트 (integration)

- 빌드 후 `dist/cli.js`를 임시 git repo cwd에서 `--no-open --port <ephemeral>`로 spawn → `/api/ping`(x-diffdeck 헤더)·`/api/diff`(토큰 포함)·`/`(index.html) 응답 검증 → graceful stop. (기존 `diff-server.test.ts` built-serving 통합 패턴 재사용.)
- 순수 함수(`parseArgs`·`buildViewerUrl`·`openerCommand`)는 단위 테스트.

### 6. 문서

- `README`에 CLI 설치·사용(`bunx @say8425/diffdeck`, 플래그) 섹션 추가.
- `docs/RELEASE.md`(또는 README 섹션)에 **배포 체크리스트**: build → `bun publish`(사용자가 npm 로그인 상태에서 실행). 실제 publish는 자동화하지 않음.

## 비목표 (Non-goals)

- **실제 `npm publish` 실행** — outward-facing이라 사용자 확인 게이트. 자동 publish 금지.
- **cc-statusline `bunx @say8425/diffdeck` cutover PR 생성 금지** — 사용자가 로컬 사용성 테스트 후 직접 PR(사용자 명시 제약).
- 전체 provenance 리브랜딩(주석·비-CLI 변수) — user-facing 표면만.
- 엔진 로직 변경 — 계승된 불변 제약.
- 뷰어 신기능 — 순수 패키징.

## 검증 전략

1. 순수 함수 단위 테스트: `parseArgs`(플래그 조합·기본값), `buildViewerUrl`(인코딩), `openerCommand`(플랫폼별).
2. 통합 스모크: 빌드된 `dist/cli.js`가 임시 repo에서 서버를 띄우고 3개 엔드포인트 응답 + graceful stop.
3. 리브랜딩 회귀: `DIFFDECK_PORT`/`DIFFDECK_DISABLE`/`~/.cache/diffdeck`/`x-diffdeck`가 반영되고 기존 서버 테스트 green.
4. 전체 게이트: `bun run typecheck` EXIT 0, `bun test` green, 뷰어+CLI 빌드 성공. 배포물 self-contained 확인(`files:["dist"]`, dist에 `workspace:*` 미포함).
5. **수동(사용자)**: `bun publish --dry-run`으로 배포물 내용 확인 후 실제 publish는 사용자 승인 시.

## 태스크 분해 (개략 — 상세는 writing-plans, TDD)

1. **최소 리브랜딩**: config.ts env/cache + server.ts ping 헤더 → diffdeck, 테스트 갱신.
2. **CLI 순수 헬퍼**: `parseArgs`·`buildViewerUrl`·`openerCommand` + 단위 테스트.
3. **CLI 엔트리 + 빌드**: `cli.ts`(헬퍼 조립 + startDiffServer + 브라우저 오픈 + SIGINT), build.ts에 `dist/cli.js` 번들 추가.
4. **배포 package.json**: `apps/viewer/package.json`→`@say8425/diffdeck`(bin·files·version·deps→devDeps·publishConfig), 통합 스모크 테스트.
5. **문서 + dry-run**: README CLI 섹션 + 배포 체크리스트, `bun publish --dry-run`으로 배포물 검증(실제 publish는 사용자 게이트).

## 불변 제약 (계승)

- 엔진(CodeView·컨트롤러) 재작성 금지.
- 외부 deps 정확 버전 핀.
- 라이선스·NOTICE 보존.
- 패키지별 tsconfig 루프 유지.
- vendored `packages/**` 편집은 Bash patch(포맷 훅 우회) — 단 Plan 5는 주로 `apps/viewer/**`(repo-formatted, Edit OK) 대상.

## 리스크 & 완화

- **배포물에 `workspace:*` 잔존 → npm publish 실패**: deps를 devDeps로 옮기고 `files:["dist"]`로 소스 제외, `bun publish --dry-run`으로 tarball 내용 검증.
- **CLI가 번들 dist/viewer를 못 찾음**: `import.meta.dir` 상대 해석 + 스모크 테스트가 실제 빌드 산출물로 검증.
- **리브랜딩이 cc-statusline 통합을 깸**: diffdeck은 독립 token/cache라 무관. 단 기존 서버 테스트가 새 env/header를 기대하도록 동반 갱신.
- **브라우저 자동 오픈이 headless/CI에서 실패**: `--no-open` 플래그 + 오픈은 best-effort(실패해도 URL은 출력, 서버는 계속).
