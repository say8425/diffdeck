# diffdeck viewer + server 앱 이관 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cc-statusline의 `src/viewer`·`src/diff-server`를 diffdeck 단일 앱 `apps/viewer`로 faithful 이관하고, 14개 유닛 테스트 + 빌드-번들 서빙 통합 테스트로 기능 동등성을 증명한다.

**Architecture:** 단일 앱 `apps/viewer`에 `server/`(데이터 서버, vendored 의존 없음)와 `browser/`(뷰어 프론트, `@diffdeck/diffs`·`@diffdeck/trees` 소비)를 두고, `build.ts`가 css-inline 번들러 플러그인으로 브라우저 번들을 `dist/`에 만들고, `serve.ts`/서버가 그 dist를 서빙한다. 이관은 import 경로 재작성 외 로직 무변경(Foundation 원칙).

**Tech Stack:** Bun(런타임·번들·테스트·workspace), TypeScript 6, oxlint/oxfmt, `@diffdeck/{diffs,trees}`(vendored 포크).

## Global Constraints

- **cc-statusline은 수정 금지.** 이 Plan은 diffdeck 레포(`~/dev/diffdeck`)에서만 파일을 만든다. 컷오버는 Plan 5.
- **로직 무변경(faithful 이관).** 소스는 verbatim 복사 후 **import 경로만** 재작성. 렌더·HTTP·git 로직 변경 금지.
- **리브랜딩 금지.** `cc-statusline:` localStorage 키 접두사, `x-cc-statusline` 헤더/ping 마커, `CC_STATUSLINE_DIFF_*` env 이름, 테스트의 `cc-srv-*` 임시 디렉터리 접두사 등 브랜딩 문자열은 **verbatim 유지**. 리브랜딩은 후속 Plan.
- **외부 deps 정확 버전 핀**(캐럿 금지). vendored 패키지는 `workspace:*`.
- **browser/는 root typecheck 루프에서 제외.** `@diffdeck/diffs`·`@diffdeck/trees`를 import하는 코드를 앱 tsconfig로 typecheck하면 vendored 엔진의 react/preact JSX + Window 전역 augmentation이 앱 config로 끌려와 실패한다(실증 확인). 이는 기존 `scripts/parity/` 하니스가 typecheck 루프에서 빠진 것과 동일한 벽이며, 선례를 따른다. 앱은 **server/·serve.ts·build.ts만** typecheck한다(vendored 의존 없음 → clean). browser/의 타입 안전성은 (a) cc-statusline에서 이미 `@pierre` 선언 대비 typecheck됐던 코드의 verbatim 복사라는 점, (b) 이식된 유닛 테스트로 담보한다. 선언 기반 앱 typecheck는 패키지 빌드가 생기는 Plan 4/5로 미룬다.
- **라이선스·NOTICE 보존**(이 Plan은 새 패키지를 추가하지 않으므로 변경 없음).

**이관 소스 루트 (모든 `cp`의 원본):**
`/Users/penguin/dev/cc-statusline/.claude/worktrees/statusline-model-display`
아래에서 `$SRC`로 표기. 각 Task 시작 시 `SRC=/Users/penguin/dev/cc-statusline/.claude/worktrees/statusline-model-display` 를 셸에 설정한다.

**모든 명령의 작업 디렉터리:** `/Users/penguin/dev/diffdeck` (아래에서 `$DD`). 절대경로를 쓰거나 각 명령 앞에서 `cd /Users/penguin/dev/diffdeck` 한다.

---

## File Structure

```
apps/viewer/
├── package.json          # @diffdeck/viewer, deps: @diffdeck/{diffs,trees} (Task 1)
├── tsconfig.json         # server/·serve.ts·build.ts만 include (Task 1)
├── server/               # src/diff-server/ 8파일 verbatim (Task 1)
│   ├── config.ts  diff.ts  ensure.ts  imageTypes.ts
│   └── link.ts    mapLimit.ts  server.ts  token.ts
├── browser/              # src/viewer/ 프론트, import-rewrite (Task 2)
│   ├── main.ts  copyButton.ts  drag.ts  fileOrder.ts
│   ├── imageCard.ts  imageDiff.ts  largeFile.ts  prefs.ts
│   └── search/{findBar,highlight,highlightDom,searchIndex}.ts
├── index.html            # src/viewer/index.html verbatim (Task 2)
├── build.ts              # 브라우저 번들(css-inline) + index.html→dist (Task 3)
├── serve.ts              # startDiffServer 부트스트랩 (Task 3)
├── dist/                 # 빌드 산출물 (gitignored; build.ts가 생성)
└── __tests__/            # 이식 테스트 14개 + 통합 1개
    ├── (Task 1) diff-command diff-config diff-ensure diff-link
    │            diff-server diff-token map-limit .test.ts
    ├── (Task 2) viewer-drag viewer-file-order viewer-highlight
    │            viewer-image-diff viewer-large-file viewer-prefs
    │            viewer-search-index .test.ts
    └── (Task 3) built-serving.test.ts
```

**Import 경로 재작성 규칙 (전 Task 공통):**
- `@pierre/diffs` → `@diffdeck/diffs`
- `@pierre/trees` → `@diffdeck/trees`
- `../diff-server/` → `../server/` (테스트·browser/main.ts에서)
- `../viewer/` → `../browser/` (테스트에서)

---

## Task 1: 앱 스캐폴드 + server/ 이관 + 서버 테스트

**Files:**
- Create: `apps/viewer/package.json`
- Create: `apps/viewer/tsconfig.json`
- Create: `apps/viewer/server/{config,diff,ensure,imageTypes,link,mapLimit,server,token}.ts` (verbatim 복사)
- Create: `apps/viewer/__tests__/{diff-command,diff-config,diff-ensure,diff-link,diff-server,diff-token,map-limit}.test.ts` (복사 + 경로 재작성)
- Modify: `package.json` (루트 `typecheck` 스크립트에 앱 tsconfig 추가)

**Interfaces:**
- Produces: `apps/viewer/server/server.ts` → `startDiffServer(opts: { port; viewerDir; env?; idleTimeoutMs? }): DiffServerHandle` (Task 3·통합 테스트가 소비). `apps/viewer/server/config.ts` → `resolveDiffPort(env?): number` (Task 3 serve.ts가 소비). 이 시그니처들은 verbatim 복사되므로 원본과 동일.

- [ ] **Step 1: 앱 스캐폴드 생성**

`apps/viewer/package.json`:
```json
{
	"name": "@diffdeck/viewer",
	"version": "0.0.0",
	"private": true,
	"type": "module",
	"dependencies": {
		"@diffdeck/diffs": "workspace:*",
		"@diffdeck/trees": "workspace:*"
	}
}
```

`apps/viewer/tsconfig.json` (browser/ 제외 — Global Constraints 참조):
```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["server/**/*.ts", "serve.ts", "build.ts"]
}
```
(`serve.ts`·`build.ts`는 Task 3에서 생성된다. tsconfig `include`의 리터럴 항목은 glob으로 취급되어 부재 시 조용히 무시되므로 지금 넣어도 무해하다.)

- [ ] **Step 2: server/ 8파일 verbatim 복사**

```bash
cd /Users/penguin/dev/diffdeck
SRC=/Users/penguin/dev/cc-statusline/.claude/worktrees/statusline-model-display
mkdir -p apps/viewer/server
cp "$SRC"/src/diff-server/*.ts apps/viewer/server/
ls apps/viewer/server/
```
Expected: `config.ts diff.ts ensure.ts imageTypes.ts link.ts mapLimit.ts server.ts token.ts` (8파일). 이 파일들은 `@pierre` import·`../` 외부 import이 없어 **소스 수정 불필요**(내부 상호 import은 `./`).

- [ ] **Step 3: 서버 테스트 7개 복사 + 경로 재작성 (RED 준비)**

```bash
cd /Users/penguin/dev/diffdeck
SRC=/Users/penguin/dev/cc-statusline/.claude/worktrees/statusline-model-display
mkdir -p apps/viewer/__tests__
for t in diff-command diff-config diff-ensure diff-link diff-server diff-token map-limit; do
  cp "$SRC/src/__tests__/$t.test.ts" apps/viewer/__tests__/
done
# 유일한 재작성: ../diff-server/ → ../server/
sed -i '' 's#\.\./diff-server/#../server/#g' apps/viewer/__tests__/*.test.ts
grep -rn "from \"\.\./" apps/viewer/__tests__/*.test.ts | grep -v "\.\./server/" || echo "OK: 남은 ../ import은 전부 ../server/"
```
Expected: 모든 상대 import이 `../server/`를 가리킴 (그 외 `../` import 없음 → "OK" 출력).

- [ ] **Step 4: 서버 테스트 실행 (green 확인)**

```bash
cd /Users/penguin/dev/diffdeck
bun test apps/viewer/__tests__/ 2>&1 | tail -15
```
Expected: `0 fail`. (복사 직후 원본 로직·테스트가 그대로이므로 통과해야 한다. 실패하면 이관이 뭔가 깨뜨린 것 — 경로 재작성 오타 등을 조사.)

- [ ] **Step 5: 루트 typecheck에 앱 추가 + server-only typecheck 확인**

루트 `package.json`의 `typecheck` 스크립트 끝에 ` && tsc --noEmit -p apps/viewer/tsconfig.json`를 추가. 전체 값:
```json
"typecheck": "tsc --noEmit -p packages/path-store/tsconfig.json && tsc --noEmit -p packages/theming/tsconfig.json && tsc --noEmit -p packages/diffs/tsconfig.json && tsc --noEmit -p packages/trees/tsconfig.json && tsc --noEmit -p apps/viewer/tsconfig.json"
```
그런 다음:
```bash
cd /Users/penguin/dev/diffdeck
bun install
bun run typecheck 2>&1 | tail -8
```
Expected: 에러 없음(빈 출력 또는 스크립트 명령 echo만). server/ 파일은 vendored 의존이 없어 clean 통과해야 한다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/package.json apps/viewer/tsconfig.json apps/viewer/server apps/viewer/__tests__ package.json bun.lock
git commit -m "feat(viewer): scaffold app + migrate diff-server + server tests"
```

---

## Task 2: browser/ 이관 + 뷰어 테스트

**Files:**
- Create: `apps/viewer/browser/{main,copyButton,drag,fileOrder,imageCard,imageDiff,largeFile,prefs}.ts` + `browser/search/{findBar,highlight,highlightDom,searchIndex}.ts` (복사 + import-rewrite)
- Create: `apps/viewer/index.html` (verbatim 복사)
- Create: `apps/viewer/__tests__/{viewer-drag,viewer-file-order,viewer-highlight,viewer-image-diff,viewer-large-file,viewer-prefs,viewer-search-index}.test.ts` (복사 + 경로 재작성)

**Interfaces:**
- Consumes: `apps/viewer/server/diff.ts`의 `DiffFile` 타입(Task 1), `apps/viewer/server/imageTypes.ts`(뷰어 이미지 테스트).
- Produces: `apps/viewer/browser/main.ts` — 브라우저 엔트리(Task 3 build.ts가 번들 entrypoint로 소비).

- [ ] **Step 1: browser/ 소스 복사**

```bash
cd /Users/penguin/dev/diffdeck
SRC=/Users/penguin/dev/cc-statusline/.claude/worktrees/statusline-model-display
mkdir -p apps/viewer/browser/search
cp "$SRC"/src/viewer/*.ts apps/viewer/browser/
cp "$SRC"/src/viewer/search/*.ts apps/viewer/browser/search/
cp "$SRC"/src/viewer/index.html apps/viewer/index.html
ls apps/viewer/browser apps/viewer/browser/search
```
Expected: browser/에 8개 `.ts`(main·copyButton·drag·fileOrder·imageCard·imageDiff·largeFile·prefs), search/에 4개(findBar·highlight·highlightDom·searchIndex).

- [ ] **Step 2: import 경로 재작성 (main.ts 3줄 + searchIndex.ts 1줄)**

```bash
cd /Users/penguin/dev/diffdeck
sed -i '' \
  -e 's#@pierre/diffs#@diffdeck/diffs#g' \
  -e 's#@pierre/trees#@diffdeck/trees#g' \
  -e 's#\.\./diff-server/#../server/#g' \
  apps/viewer/browser/main.ts
sed -i '' 's#@pierre/diffs#@diffdeck/diffs#g' apps/viewer/browser/search/searchIndex.ts
echo "--- main.ts 상단 import 확인 ---"
sed -n '1,3p' apps/viewer/browser/main.ts
echo "--- searchIndex.ts 첫 type import 확인 ---"
grep -n "@diffdeck/diffs" apps/viewer/browser/search/searchIndex.ts
echo "--- 잔여 @pierre 없어야 함 ---"
grep -rn "@pierre" apps/viewer/browser/ || echo "OK: @pierre 없음"
```
Expected 결과:
```
import { CodeView, parseDiffFromFile } from "@diffdeck/diffs";
import { FileTree } from "@diffdeck/trees";
import type { DiffFile } from "../server/diff.ts";
```
그리고 `searchIndex.ts`에 `import type { FileDiffMetadata } from "@diffdeck/diffs";`, 잔여 `@pierre` 없음("OK"). (`fileOrder.ts` 1행의 `@pierre/trees`는 주석이라 무해하게 치환됨 — 무관.)

- [ ] **Step 3: 뷰어 테스트 7개 복사 + 경로 재작성 (RED 준비)**

```bash
cd /Users/penguin/dev/diffdeck
SRC=/Users/penguin/dev/cc-statusline/.claude/worktrees/statusline-model-display
for t in viewer-drag viewer-file-order viewer-highlight viewer-image-diff viewer-large-file viewer-prefs viewer-search-index; do
  cp "$SRC/src/__tests__/$t.test.ts" apps/viewer/__tests__/
done
sed -i '' \
  -e 's#\.\./viewer/#../browser/#g' \
  -e 's#\.\./diff-server/#../server/#g' \
  -e 's#@pierre/diffs#@diffdeck/diffs#g' \
  apps/viewer/__tests__/viewer-*.test.ts
grep -rn "@pierre\|\.\./viewer/\|\.\./diff-server/" apps/viewer/__tests__/viewer-*.test.ts || echo "OK: 옛 경로 없음"
```
Expected: 옛 경로(`@pierre`, `../viewer/`, `../diff-server/`) 잔여 없음("OK").

- [ ] **Step 4: 전체 테스트 실행 (14개 green 확인)**

```bash
cd /Users/penguin/dev/diffdeck
bun test apps/viewer/__tests__/ 2>&1 | tail -15
```
Expected: `0 fail`. (bunfig.toml이 이미 `scripts/parity/preload.ts`로 css-inline 런타임 플러그인을 전역 등록하므로, 런타임에 CSS를 당기는 import이 있어도 해소된다. 실제로 이식 테스트는 `import type`(searchIndex) 또는 순수 로컬이라 CSS 런타임 로드는 없다.)

- [ ] **Step 5: 커밋**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/browser apps/viewer/index.html apps/viewer/__tests__
git commit -m "feat(viewer): migrate browser frontend + viewer tests"
```

---

## Task 3: build.ts + serve.ts + 빌드-번들 서빙 통합 테스트

**Files:**
- Create: `apps/viewer/build.ts`
- Create: `apps/viewer/serve.ts`
- Create: `apps/viewer/__tests__/built-serving.test.ts`
- Modify: `.gitignore` (이미 `dist/`가 있으면 무변경 — 확인만)

**Interfaces:**
- Consumes: `cssInlineBundlerPlugin`(`scripts/css-inline-plugin.ts`), `startDiffServer`·`resolveDiffPort`(Task 1 server/).
- Produces: `apps/viewer/dist/main.js`, `apps/viewer/dist/index.html`(build.ts 산출). `serve.ts`(수동 실행 엔트리).

- [ ] **Step 1: build.ts 작성**

`apps/viewer/build.ts`:
```ts
// 브라우저 뷰어 번들 빌드. 포크 패키지(@diffdeck/diffs·trees)가 `../style.css?inline`을
// import하므로 css-inline 번들러 플러그인을 반드시 attach한다(패리티 하니스 build.ts와 동일
// 패턴). 산출: dist/main.js(minify) + dist/index.html(복사). 서버의 viewerDir가 이 dist.
import { cssInlineBundlerPlugin } from "../../scripts/css-inline-plugin.ts";

const outdir = `${import.meta.dir}/dist`;

const result = await Bun.build({
	entrypoints: [`${import.meta.dir}/browser/main.ts`],
	target: "browser",
	outdir,
	minify: true,
	plugins: [cssInlineBundlerPlugin],
});

for (const log of result.logs) console.log(log);
if (!result.success) {
	console.error("viewer build failed");
	process.exit(1);
}

await Bun.write(`${outdir}/index.html`, Bun.file(`${import.meta.dir}/index.html`));

const [entry] = result.outputs;
console.log(
	`viewer build: ${entry?.path} (${((entry?.size ?? 0) / 1_000_000).toFixed(2)} MB)`,
);
```
(`Bun.build`의 기본 naming은 `[name].[ext]` → 엔트리 `main.ts`가 `dist/main.js`로 나온다. index.html이 참조하는 `/main.js`와 일치.)

- [ ] **Step 2: 빌드 실행 (산출물 확인)**

```bash
cd /Users/penguin/dev/diffdeck
bun run apps/viewer/build.ts
ls -la apps/viewer/dist/
```
Expected: `viewer build: .../dist/main.js (N.NN MB)` 출력, `dist/`에 `main.js`와 `index.html` 존재.

- [ ] **Step 3: serve.ts 작성**

`apps/viewer/serve.ts`:
```ts
// 검증·수동 실행용 최소 dev 엔트리. 정식 CLI(데몬·토큰·URL·spawn)는 Plan 5.
// 실행 전 `bun run apps/viewer/build.ts`로 dist를 만들어 둘 것.
import { resolveDiffPort } from "./server/config.ts";
import { startDiffServer } from "./server/server.ts";

const handle = startDiffServer({
	port: resolveDiffPort(),
	viewerDir: `${import.meta.dir}/dist`,
});
console.log(
	`diffdeck viewer: http://127.0.0.1:${handle.server.port}  (token ${handle.token})`,
);
```

- [ ] **Step 4: built-serving 통합 테스트 작성 (RED)**

이 테스트만이 새로운 표면 — **빌드된 실제 번들을 서버가 서빙**하는 것 — 을 검증한다(엔드포인트 로직 자체는 이식된 `diff-server.test.ts`가 이미 커버). `apps/viewer/__tests__/built-serving.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDiffPort } from "../server/config.ts";
import { startDiffServer } from "../server/server.ts";

// build.ts를 한 번 돌려 실제 dist를 만든 뒤, 그 dist를 viewerDir로 서빙한다.
let handle: ReturnType<typeof startDiffServer>;
let base: string;
let cacheHome: string;
const distDir = join(import.meta.dir, "..", "dist");

beforeAll(async () => {
	const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "build.ts")], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	if (code !== 0) throw new Error(`build.ts failed with code ${code}`);

	cacheHome = mkdtempSync(join(tmpdir(), "dd-built-cache-"));
	handle = startDiffServer({
		port: 0,
		viewerDir: distDir,
		env: { XDG_CACHE_HOME: cacheHome },
		idleTimeoutMs: 0,
	});
	base = `http://127.0.0.1:${handle.server.port}`;
});

afterAll(() => {
	handle.stop();
	rmSync(cacheHome, { recursive: true, force: true });
});

describe("built bundle serving", () => {
	test("GET / serves the built index.html", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.text()).toContain("/main.js");
	});

	test("GET /main.js serves the built browser bundle", async () => {
		const res = await fetch(`${base}/main.js`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body.length).toBeGreaterThan(10_000); // minified 번들은 수십 KB+
		// 번들 안에 뷰어 고유 문자열이 살아있는지(트리마운트 id) 확인.
		expect(body).toContain("tree");
	});

	test("GET /missing.js returns 404", async () => {
		const res = await fetch(`${base}/missing.js`);
		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 5: 통합 테스트 실행 (green)**

```bash
cd /Users/penguin/dev/diffdeck
bun test apps/viewer/__tests__/built-serving.test.ts 2>&1 | tail -15
```
Expected: `0 fail`, 3 pass. (실패 시: build 산출 경로·naming, index.html의 `/main.js` 참조, viewerDir 정적 서빙 경로를 조사.)

- [ ] **Step 6: serve.ts·build.ts typecheck 확인**

```bash
cd /Users/penguin/dev/diffdeck
bun run typecheck 2>&1 | tail -8
```
Expected: 에러 없음. (이제 `serve.ts`·`build.ts`도 앱 tsconfig include에 실제 파일로 잡혀 typecheck된다. 둘 다 vendored 의존이 없어 clean.)

- [ ] **Step 7: 커밋**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/build.ts apps/viewer/serve.ts apps/viewer/__tests__/built-serving.test.ts
git commit -m "feat(viewer): build + serve entry + built-bundle serving test"
```

---

## Task 4: 문서 갱신 + 전체 스위트 green

**Files:**
- Modify: `README.md` (apps/ 상태를 "in progress" → viewer/server 이관 완료로 갱신)
- Modify: `CLAUDE.md` (apps/viewer 구조 반영, 로드맵 Plan 2 ✅)

**Interfaces:** 없음(문서·검증).

- [ ] **Step 1: 전체 스위트 green 확인 (문서 갱신 전 기준선)**

```bash
cd /Users/penguin/dev/diffdeck
bun run typecheck && bun run lint && bun run format:check && bun test 2>&1 | tail -20
```
Expected: 네 명령 모두 성공(`0 fail`). lint/format 글로브는 이미 `apps/`를 포함(`oxlint packages/ apps/ bin/`). 만약 `format:check`가 이식 파일의 포맷 불일치를 지적하면 `bun run format`로 정규화 후 재확인하고, 그 변경을 이 Task 커밋에 포함한다.

- [ ] **Step 2: README.md 갱신**

`README.md`의 Architecture 코드블록에서
```
apps/           viewer + server app (in progress)
```
을 다음으로 교체:
```
apps/viewer/    diff-server (data API) + browser viewer, built with the css-inline plugin
```
그리고 Features 섹션 끝의 문장
> The interactive viewer chrome that wraps this engine — click-to-fold, copy-path, in-app search, watch/auto-refresh, and working-tree-vs-base modes — comes from the [cc-statusline](https://github.com/say8425/cc-statusline) viewer and is being migrated into diffdeck's `apps/`.

에서 `and is being migrated into diffdeck's` `apps/`.` 를 `and now lives in diffdeck's` `apps/viewer/`.`로 수정(이관 완료 반영).

- [ ] **Step 3: CLAUDE.md 갱신**

`CLAUDE.md`의 WHAT 트리에서
```
├── apps/                   # (Plan 2) viewer + server 앱 이관 예정
```
을 다음으로 교체:
```
├── apps/
│   └── viewer/             # @diffdeck/viewer — server/(데이터 API) + browser/(뷰어 프론트) + build.ts·serve.ts
```
그리고 로드맵 섹션의
```
- **Plan 2 — viewer + server 앱**: cc-statusline의 `src/viewer`·`src/diff-server`를 `apps/`로 이관, 기능 동등성.
```
을
```
- **Plan 2 — viewer + server 앱** ✅: `apps/viewer`로 이관(server/·browser/), 14 유닛 테스트 + 빌드-번들 서빙 통합 테스트로 동등성 검증. browser/는 vendored JSX 벽 때문에 typecheck 루프 제외(패리티 하니스와 동일, Plan 4/5서 선언 기반으로 해소).
```
로 교체.

- [ ] **Step 4: 최종 확인 + 커밋**

```bash
cd /Users/penguin/dev/diffdeck
bun run typecheck && bun run lint && bun run format:check && bun test 2>&1 | tail -8
git add README.md CLAUDE.md
git commit -m "docs: reflect Plan 2 viewer+server migration into apps/viewer"
```
Expected: 전부 green, 커밋 완료.

---

## Self-Review

**1. Spec coverage:**
- 단일 앱 `apps/viewer`(server/+browser/+build.ts+serve.ts) → Task 1·2·3. ✅
- `DiffFile` 앱 내부 상대 import(`../server/diff.ts`) → Task 2 Step 2. ✅
- import-rewrite만(`@pierre`→`@diffdeck`, 경로) → Task 1 Step 3, Task 2 Step 2·3. ✅
- build.ts css-inline 번들러 플러그인 → Task 3 Step 1. ✅
- 14개 유닛 테스트 이식 green → Task 1 Step 4(7개) + Task 2 Step 4(누적 14개). ✅
- 서버 스모크(빌드-번들 서빙, 나머지는 이식된 diff-server.test.ts가 커버) → Task 3 Step 4. ✅
- 패리티 하니스 존치 → 건드리지 않음(변경 없음). ✅
- non-goal(cc-statusline 무변경·CLI 없음·리브랜딩 없음) → Global Constraints. ✅
- **스펙 수정점**: 스펙의 "browser typecheck + css?inline ambient decl" 항목은 vendored 엔진 JSX 벽 때문에 실현 불가(실증 확인)라, "server-only typecheck + browser 제외(패리티 선례)"로 대체. Global Constraints·Task 4 Step 3에 명시. css?inline ambient decl은 browser 미-typecheck로 불필요해져 제거.

**2. Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드 블록은 실제 내용(신규 파일 전문 또는 verbatim 복사 + 정확한 find→replace). ✅

**3. Type consistency:** `startDiffServer(opts)`·`resolveDiffPort(env?)`·`DiffFile` 시그니처는 전부 verbatim 복사된 원본이라 Task 간 일치. build.ts 산출 `dist/main.js`는 index.html의 `/main.js` 참조·serve.ts/통합테스트의 `viewerDir=dist`와 일치. ✅
