# diffdeck

로컬 git diff 뷰어(npm `@say8425/diffdeck`). Bun(런타임·번들·테스트·workspace) + TypeScript 7(Go 네이티브 tsc) 모노레포이고 lint·format은 oxlint·oxfmt다. Pierre의 `@pierre/diffs`·`@pierre/trees`를 소스맵에서 복원한 vendored 포크 위에 뷰어 앱을 얹었다. 기능과 CLI 사용법은 `README.md`에 있다.

## 구조

- `packages/` — vendored 포크(workspace로 쓰고 npm에서 받지 않는다): `path-store`(트리 순수 로직) · `theming`(테마 + shiki 테마 JSON) · `diffs`(CodeView diff 렌더 엔진) · `trees`(FileTree, vanilla 렌더)
- `apps/viewer/` — 배포되는 유일한 패키지 `@say8425/diffdeck`: `server/`(데이터 API) · `browser/`(뷰어, `main.ts`가 배선) · `index.html` · `cli.ts` + `cli/` · `build.ts` · `fonts/` · `__tests__/` · `e2e/`
- `skills/diffdeck/SKILL.md` — 배포되는 에이전트 스킬. `build.ts`가 `dist/skills/`로 복사한다. 플러그인 매니페스트는 `.claude-plugin/`·`.codex-plugin/`·`.agents/plugins/`에 있다.
- `scripts/` — 소스맵 복원 도구, css-inline Bun 플러그인, 렌더 패리티 하니스(`scripts/parity/`)
- `docs/` — README 번역 4종과 스크린샷. `docs/superpowers/`는 gitignore된 로컬 계획 문서다.

## 명령

```bash
bun install
bun run typecheck      # 패키지 4개 + apps/viewer(server·cli·build) + apps/viewer/e2e
bun test               # 유닛·통합. *.e2e.ts는 수집되지 않는다
bun run test:coverage  # 같은 스위트 + apps/viewer/{browser,cli,server} 100% 커버리지 게이트
bun run test:e2e       # Playwright + 시스템 Google Chrome. globalSetup이 build.ts를 돌린다
bun run lint           # oxlint apps/ (type-aware라 devDep oxlint-tsgolint가 필요). vendored packages/는 lint·format 대상이 아니다
bun run format         # oxfmt apps/ (CI는 format:check)
cd apps/viewer && bun run build && bun run start   # 뷰어를 직접 띄워 본다(실행한 곳의 리포 diff)
```

## 작업 규칙

- `main`에 직접 push하지 않는다. 브랜치 → PR → 사람이 리뷰·머지한다. 필수 체크 5개(lint·typecheck·test·coverage·e2e)가 초록이어야 머지된다.
- 커밋 메시지는 Conventional Commits다. release-please가 이것으로 버전·CHANGELOG·릴리스를 만든다(`feat`→minor, `fix`→patch, `!`·`BREAKING CHANGE`→major, `docs`·`chore`·`test`·`ci` 등은 릴리스 없음).
- `packages/*`에서는 import 경로와 재구성 타입만 고친다. 렌더·로직 변경은 합의된 예외일 때만 한다(`vendored-packages.md`). CodeView 엔진은 재작성하지 않는다.
- 외부 의존성은 정확한 버전으로 핀한다(`^`·`~` 금지).
- `apps/viewer/package.json`에 `dependencies`를 두지 않는다. 배포물은 런타임 코드를 전부 번들에 품는다.

## 테스트

- 커버리지 게이트는 line·function·statement만 세고 branch는 세지 않는다. `if (x) return y;`는 `return`이 한 번도 실행되지 않아도 100%다. 새 분기를 넣으면 그 분기로 들어가는 테스트를 따로 둔다.
- 커버리지 초록은 코드가 쓰인다는 증거도 아니다. 자기 테스트만 부르는 죽은 코드도 100%다.
- `apps/viewer/browser/main.ts`는 게이트 밖이다. 판단 로직은 게이트 안의 모듈에 두고 `main.ts`에는 배선만 둔다. 배선, 그리고 레이아웃·페인트·포커스 계약은 happy-dom이 볼 수 없으므로 e2e로 단언한다.
- 회귀 테스트를 세우면 구현을 되돌렸을 때 그 테스트가 실제로 실패하는지 확인한다. 다른 스펙이 지켜 준다고 가정하지 않는다.

## 주석

주석은 최소로 둔다. 틀린 주석은 주석이 없는 것보다 나쁘고, 주석이 많을수록 코드와 어긋나는 곳도 늘어난다.

- 코드만 봐서는 알 수 없고, 지우면 다음 사람이 실수하게 되는 "왜"만 짧게(보통 한두 줄) 적는다. 예: 순서가 계약인 호출, 일부러 둔 중복, 외부 제약 때문에 이상해 보이는 값, 테스트가 판별력을 갖는 전제(픽스처 크기 같은).
- 쓰지 않는 것:
  - 코드가 하는 일을 되풀이하는 설명
  - 경위, 실측 수치, 날짜, PR 번호, 줄 번호, 테스트 개수
  - `.claude/rules/`나 다른 주석의 복사
- 긴 근거는 `.claude/rules/`나 PR·커밋 메시지에 둔다. 규칙을 어기기 쉬운 자리에는 한 줄 표지와 rules 파일 이름(`server.md`처럼 이름만)을 남긴다 — 이것은 복사가 아니다.
- 코드를 바꾸면 그 근처 주석이 아직 맞는지 확인하고, 틀렸으면 고치거나 지운다.
- 남기는 것: 지시자 주석(`oxlint-disable`, `@ts-expect-error` 등), 셰뱅, 라이선스 고지.
- vendored `packages/*`의 업스트림 주석은 원본이라 건드리지 않는다. 우리가 단 `[diffdeck]` 주석은 이탈 지점마다 반드시 두고, 이 절을 따른다.

## 영역별 규칙 (`.claude/rules/`)

해당 경로의 파일을 읽으면 자동으로 로드된다. 그 영역의 파일을 열기 전에 설계를 정해야 하면 직접 읽는다.

| 파일 | 다루는 것 |
| --- | --- |
| `server.md` | 선택 축(base·head), `/api/refs`·`/api/prs`, 리포 판별, git 출력 크기와 flight 회복, blob 캐시, 프로세스 cwd |
| `viewer.md` | CodeView 수명·스크롤, 갱신과 캐시, 변경량 세기, 프리퍼런스, 빈 상태·로드 실패 |
| `viewer-toolbar.md` | 툴바 배치, 피커, 트리거 라벨과 폭, PR 칩 |
| `grab.md` | diff 선택 → 프롬프트 → 클립보드 |
| `fonts.md` | 웹폰트와 엔진 전달 |
| `vendored-packages.md` | 포크 원칙과 현재 예외, shiki 번프 |
| `testing.md` · `e2e.md` | `bun test` 함정, Playwright 함정과 판별력 |
| `ci-release.md` | 필수 체크, 릴리스, 배포 산출물 |
| `docs-sync.md` | CLI 플래그·SKILL.md·README 번역 동기화 |

## 이 문서를 고칠 때

- 이 파일에는 모든 세션에 필요한 것만 둔다. 한 영역에만 해당하는 규칙은 그 영역의 rules 파일에 쓰고, 새 영역이면 `paths`를 단 파일을 만든다.
- 계약과 그 이유만 적는다. 개수·크기·줄 번호·실측 수치는 드리프트하므로 적지 않고, 경위와 증거는 PR·커밋 메시지에 남긴다.
