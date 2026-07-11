# diffdeck

로컬 diff 뷰어 (Bun/TypeScript 모노레포). `@pierre/diffs`·`@pierre/trees`를 소스맵에서 복원해 vendored 포크한 렌더링 엔진 기반.

## WHAT

```
diffdeck/
├── packages/               # 포크한 pierre 패키지 (vendored, npm 설치 안 함)
│   ├── path-store/         # @diffdeck/path-store — 트리 순수 로직 (flatten·sort·projection·store), 18 src, deps 없음
│   ├── theming/            # @diffdeck/theming — 테마 시스템 + 테마 데이터, 15 src + themes/*.json 10개
│   ├── diffs/              # @diffdeck/diffs — CodeView diff 렌더 엔진, 170 src (CodeView.ts 3,563줄)
│   └── trees/              # @diffdeck/trees — FileTree 엔진, 52 src (preact 렌더 스킨 포함)
├── apps/
│   └── viewer/             # @diffdeck/viewer — server/(데이터 API) + browser/(뷰어 프론트) + build.ts·serve.ts
├── bin/                    # (Plan 5) diffdeck CLI 엔트리 예정
├── scripts/
│   ├── extract-sources.ts       # 소스맵 sourcesContent → 원본 TS 복원 도구 (Foundation 일회성)
│   ├── extract-sources.test.ts  # (비-hermetic: ~/dev/cc-statusline/node_modules 참조 — CI 전 gate 필요)
│   ├── css-inline-plugin.ts     # *.css?inline import용 Bun 플러그인 (런타임/번들러 2분리)
│   └── parity/                  # 포크 렌더 패리티 하니스 (fixture·smoke test·main·build)
├── tsconfig.base.json      # 공유 base (jsxImportSource: preact, @diffdeck/* path alias)
├── .oxlintrc.json / .oxfmtrc.json
├── NOTICE                  # pierre (Apache-2.0) 유래 고지
└── package.json            # Bun workspace 루트 (workspaces: packages/*, apps/*)
```

**기술 스택**: Bun (런타임·번들·테스트·workspace), TypeScript 6, oxlint/oxfmt

**패키지 의존 그래프**:
- `path-store` → (없음)
- `theming` → shiki, @shikijs/themes
- `diffs` → theming, shiki, @shikijs/transformers, diff, hast-util-to-html, lru_map
- `trees` → path-store, theming, **preact**, preact-render-to-string

**포크 provenance**: 원본 `@pierre/*`의 dist `.js.map` `sourcesContent`에 주석 포함 원본 TS가 전량 존재 → `scripts/extract-sources.ts`로 복원 후 `@pierre/*` import를 `@diffdeck/*`로 rewrite. `@pierre/path-store`는 npm 미배포지만 trees dist에 번들되어 함께 복원됨. `@pierre/theme`(테마 데이터)는 코드가 아니라 shiki 테마 JSON 10개라 `theming/themes/`에 그대로 vendored. 전부 Apache-2.0.

## WHY

cc-statusline에 포함됐던 로컬 diff 뷰어를 독립 제품으로 분리 + pierre 포크:

1. **업스트림 리스크** — `@pierre/diffs`는 churn이 크고(7개월 84버전), `@pierre/trees`는 pre-1.0 beta라 내부 마크업이 정당하게 바뀔 수 있음.
2. **이미 많이 개조** — 헤더 폴드·복사 버튼·이미지 카드·인앱 검색·flatten UX를 pierre 내부 마크업(shadow DOM data 속성·sprite id)에 결합해 얹어 씀.

→ 소스 복원해 vendored 포크, 업스트림과 완전 결별. 내부 마크업 결합을 diffdeck 자체의 안정 계약으로 승격.

설계·조사 근거(요약): CodeView는 이미 프레임워크 무관 vanilla 27k줄 엔진(faithful 재작성 4~8개월, 이득 0 → 재작성 금지). 혼합 기술은 얕음 — vanilla가 아닌 건 trees 렌더 스킨의 preact 6파일뿐. 대체 라이브러리 조사 결과 pierre 품질 대체재 없음.

## HOW

### 개발

```bash
bun install
bun run typecheck   # 4패키지 각자 tsconfig로 (혼합 JSX라 flat 불가 — 패키지별 루프)
bun test
bun run lint
bun run format
```

### 렌더 패리티 하니스

포크한 CodeView+FileTree가 실제 렌더되는지 확인:

```bash
bun run scripts/parity/build.ts                 # css-inline 플러그인으로 번들
cd scripts/parity && python3 -m http.server 8099 # http://127.0.0.1:8099/index.html
```

### 수정 시 주의사항

- **CodeView(diffs) 재작성 금지** — 27k줄 vendored 엔진을 blackbox로 사용. 가상화·shiki 스트리밍·shadow DOM 등 상용급 난이도, 재작성 이득 없음.
- **포크 패키지는 import 경로 + 재구성 타입만 수정** — 렌더/로직 변경 금지 (Foundation 원칙). 오버홀은 별도 plan에서.
- **JSX 설정**: `tsconfig.base.json`은 preact JSX. diffs는 패키지 tsconfig에서 react로 override(react 어댑터 때문), trees는 per-file `@jsxImportSource` pragma 사용. 그래서 루트 typecheck는 flat이 아니라 패키지별 루프.
- **외부 deps는 정확 버전 핀** (캐럿 금지). vendored 패키지는 workspace 내부.
- **preact는 trees에만** — Plan 3(de-preact)에서 vanilla로 포팅 후 제거 예정.
- **react는 하드 런타임 의존 아님** — diffs/trees의 미사용 react 어댑터용 devDep/optional peer. 데드코드는 후속 plan에서 제거.
- **라이선스**: 각 `packages/*/LICENSE`(Apache-2.0) + `packages/trees/NOTICE.md`(headless-tree MIT 유래) + 최상위 `NOTICE` 보존. 파일 수정 사실 고지 유지.
- **`*.css?inline` ambient 선언**: 소비자(앱)의 tsconfig가 패키지 `src/**`를 glob include하지 않으면 안 보임 — Plan 2 앱 tsconfig에서 배선 필요.

### 로드맵 (각각 별도 sub-plan)

- **Plan 1 — Foundation** ✅: 4패키지 포크, 타입체크·렌더 검증.
- **Plan 2 — viewer + server 앱** ✅: `apps/viewer`로 이관(server/·browser/), 14 유닛 테스트 + 빌드-번들 서빙 통합 테스트로 동등성 검증. browser/는 vendored JSX 벽 때문에 typecheck 루프 제외(패리티 하니스와 동일, Plan 4/5서 선언 기반으로 해소).
- **Plan 3 — de-preact 실용판**: trees preact 6파일 → vanilla (가상화·DnD·rename·sticky·SSR 제외, read-only 대응), preact 제거.
- **Plan 4 — 커플링 하드닝**: 내부 마크업 계약화, 정렬 comparator 단일화, canary 테스트, 상수 export.
- **Plan 5 — CLI + 컷오버 + 배포**: `bin/diffdeck.ts`(데몬·토큰·URL), npm `@say8425/diffdeck` 배포, cc-statusline이 `bunx @say8425/diffdeck`로 전환.
