# diffdeck Plan 2 — viewer + server 앱 이관 설계

**날짜**: 2026-07-10
**상태**: 설계 확정 (writing-plans 대기)
**선행**: Plan 1 Foundation 완료 — `@diffdeck/{path-store,theming,diffs,trees}` 포크됨, 타입체크·렌더 검증 완료.

## 목표

cc-statusline에 임베드된 로컬 diff 뷰어의 두 서브시스템(`src/viewer`, `src/diff-server`)을
diffdeck 레포의 단일 앱 `apps/viewer`로 이관하고, **기능 동등성**을 확보한다. 포크된
`@diffdeck/diffs`·`@diffdeck/trees`를 실제로 소비하는 첫 애플리케이션을 세워, 뷰어가 서버를 통해
브라우저에서 동작함을 자동 검증으로 증명한다.

## 범위 (What)

이관 대상은 cc-statusline worktree 기준:

- `src/viewer/` — 뷰어 프론트엔드(자기완결적). 외부 의존: `@pierre/diffs`·`@pierre/trees` +
  `../diff-server/diff.ts`의 `DiffFile` **타입**뿐. 구성: `main.ts`, `copyButton.ts`, `drag.ts`,
  `fileOrder.ts`, `imageCard.ts`, `imageDiff.ts`, `largeFile.ts`, `prefs.ts`, `index.html`,
  `search/{findBar,highlight,highlightDom,searchIndex}.ts`.
- `src/diff-server/` — 데이터 서버(완전 자기완결적, `@pierre` 의존 없음). 구성: `config.ts`,
  `diff.ts`, `ensure.ts`, `imageTypes.ts`, `link.ts`, `mapLimit.ts`, `server.ts`, `token.ts`.
- 테스트 14개: `diff-{command,config,ensure,link,server,token}.test.ts`, `map-limit.test.ts`,
  `viewer-{drag,file-order,highlight,image-diff,large-file,prefs,search-index}.test.ts`.

## 비목표 (Non-goals)

- **cc-statusline은 건드리지 않는다.** 컷오버(`bunx @say8425/diffdeck`로 전환)는 Plan 5.
- **CLI 엔트리(`bin/diffdeck.ts`) 미포함.** 데몬·토큰·URL을 감싸는 정식 CLI는 Plan 5.
- **리브랜딩 미포함.** `cc-statusline:` localStorage 키 접두사, `x-cc-statusline` HTTP 헤더/ping
  마커 등 브랜딩 문자열은 **verbatim 유지**(테스트가 참조, faithful 이관 원칙). 리브랜딩은 후속 Plan.
- **로직 오버홀 미포함.** Foundation 원칙 계승: import 경로 재작성 외 렌더/로직 변경 금지.
- **de-preact·커플링 하드닝 미포함** (각각 Plan 3·4).

## 아키텍처 (How)

### 디렉터리 레이아웃 — 단일 앱 `apps/viewer` (`@diffdeck/viewer`)

```
apps/viewer/
├── server/            ← src/diff-server/ 8파일 (import 무변경 이관)
├── browser/           ← src/viewer/ 프론트 (import-rewrite 이관)
│   └── search/        ← findBar·highlight·highlightDom·searchIndex
├── index.html         ← src/viewer/index.html (script src="/main.js" 유지)
├── build.ts           ← browser 번들(css-inline 플러그인) + 정적 자산 복사
├── serve.ts           ← 검증·수동 실행용 최소 dev 엔트리
├── css-inline.d.ts    ← `declare module "*.css?inline"` ambient 선언
├── tsconfig.json      ← @diffdeck/* 소비, css-inline.d.ts 포함
└── package.json       ← @diffdeck/viewer, deps: @diffdeck/{diffs,trees}
```

**경계 근거**: viewer는 diff-server의 `DiffFile` 타입 하나만 가로질러 참조하고, 서버는 빌드된
viewer 번들을 서빙하는 단일 프로세스 관계다. 두 디렉터리를 한 앱에 두면 `DiffFile`은 앱 내부
상대 import(`../server/diff.ts`)로 유지되어 워크스페이스 엣지가 생기지 않고, 빌드가 1회로 끝난다.

### 의존 관계

- `apps/viewer` (`@diffdeck/viewer`)
  - browser → `@diffdeck/diffs`, `@diffdeck/trees` (workspace:*)
  - server → 외부 의존 없음 (Bun 빌트인만)
  - devDep → `@types/bun`

### 이관 메커닉

1. **server/ 이관**: 8파일을 그대로 복사. `@pierre` import가 없으므로 소스 무변경.
   상호 import(`./diff.ts` 등)는 상대 경로라 그대로 동작.
2. **browser/ 이관 (import-rewrite만)**:
   - `main.ts`: `@pierre/diffs` → `@diffdeck/diffs`, `@pierre/trees` → `@diffdeck/trees` (2줄).
     `../diff-server/diff.ts` → `../server/diff.ts` (앱 내 상대 경로 조정).
   - `search/searchIndex.ts`: `@pierre/diffs` → `@diffdeck/diffs` (1줄).
   - 나머지 파일은 로컬 상대 import뿐이라 무변경.
   - 문자열 치환은 substring replace로 subpath(`@pierre/diffs/...`)까지 포괄 (Foundation 교훈).
3. **build.ts (css-inline 필수)**: 포크 패키지가 `../style.css?inline`을 import하므로, cc-statusline
   빌드와 달리 `scripts/css-inline-plugin.ts`의 `cssInlineBundlerPlugin`을 반드시 attach한다
   (패리티 하니스 build.ts가 이미 검증한 패턴). 산출: `browser/main.ts` → `dist/main.js`(browser
   target, minify) + `index.html`을 dist 루트로 복사. 서버의 `viewerDir`은 이 dist를 가리킴.
4. **`*.css?inline` ambient 선언 (day-1)**: 앱 tsconfig가 포크 패키지 `src/**`를 include하지
   않으므로 ambient 선언이 안 보인다. `apps/viewer/css-inline.d.ts`에
   `declare module "*.css?inline" { const css: string; export default css; }`를 두고 tsconfig에
   포함시킨다.
5. **serve.ts (검증용 dev 엔트리)**: `startDiffServer({ port, viewerDir })`만 부트스트랩하는 최소
   엔트리. 정식 데몬·스폰·토큰·URL CLI는 Plan 5. `ensure.ts`/`link.ts`/`config.ts`는 verbatim
   이관하되 실제 재배선(`--diff-server` 플래그·`Bun.main` → diffdeck 엔트리로 re-point)은 Plan 5.
   이 파일들의 테스트는 spawn fn 주입 방식이라 이관만으로 green.

### 데이터 흐름 (동등성 유지)

statusline이 spawn한다는 점만 빼면 cc-statusline과 동일:
`서버 기동(serve.ts/테스트) → GET /api/diff?repo&token&mode&untracked → getDiffFiles(파일별 old/new
JSON) → 브라우저 parseDiffFromFile → CodeView 렌더`. 이미지: `GET /api/blob?path&side&mode`(토큰
보호, 이미지 경로 전용). 정적: `GET /` → index.html, `GET /main.js` → 번들. 403(토큰)·404(비이미지
blob)·경로 탐색 가드 전부 유지.

## 검증 전략

1. **유닛 테스트 이식** — 14개 전부 diffdeck로 이관, import 경로를 앱 구조(`../server/`,
   `../browser/`)로 조정, `bun test` 전부 green. `diff-server.test.ts`는 이미 403·경로 탐색 가드를
   커버.
2. **서버 스모크 통합 테스트 (신규)** — 실제 서버를 기동해 새 앱 구조에서 서빙이 동작함을 증명:
   - `startDiffServer` → `GET /api/diff`(실 git repo fixture) → 200 + JSON + `x-diff-base` 헤더.
   - `GET /api/blob`(이미지 경로) → 200 + 올바른 content-type; 비이미지 → 404.
   - `GET /` → index.html 200; `GET /main.js` → 번들 200 (빌드 산출물 서빙 경로 검증).
   - 토큰 불일치 → 403.
3. **패리티 하니스 유지** — `scripts/parity/`는 포크 패키지 렌더 회귀 감지용으로 존치(변경 없음).

## 태스크 분해 (개략 — 상세는 writing-plans)

1. 앱 스캐폴드: `package.json`·`tsconfig.json`·`css-inline.d.ts`, 워크스페이스 인식, `bun install`.
2. server/ 이관 (8파일 무변경) + 서버 6개 테스트 이식, green.
3. browser/ 이관 (import-rewrite) + 뷰어 8개 테스트 이식, green.
4. build.ts(css-inline) + serve.ts + index.html 배선, 번들 산출·서버 서빙 확인.
5. 서버 스모크 통합 테스트 신규 작성.
6. 루트 `typecheck`·`lint`·`format`·`test` 스크립트에 앱 반영, 전체 green.

## 불변 제약 (Foundation 계승)

- CodeView(diffs) 재작성 금지 — blackbox 사용.
- 포크·이관 코드는 import 경로만 수정, 렌더/로직 변경 금지.
- 외부 deps 정확 버전 핀(캐럿 금지).
- 루트 typecheck는 패키지·앱별 tsconfig 루프(혼합 preact/react JSX라 flat 불가).
- 라이선스·NOTICE 보존.

## 리스크 & 완화

- **css?inline 미배선 → 빈 렌더**: Foundation에서 겪은 실패. build.ts의 css-inline 플러그인 +
  ambient 선언을 태스크 1·4에서 명시적으로 배선하고, 서버 스모크가 `/main.js` 서빙을 검증.
- **`DiffFile` 타입 경로 어긋남**: 앱 내 상대 import(`../server/diff.ts`)로 단순화, typecheck가 잡음.
- **브랜딩 문자열 혼재**: verbatim 유지로 테스트 정합 보장, 리브랜딩은 후속 Plan으로 명확히 분리.
