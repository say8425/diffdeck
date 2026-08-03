// Playwright fixtures: spawn the built CLI (`dist/cli.js`, via the real `bun`
// binary — see fixtures/proc.ts) against a fresh `makeFixtureRepo()` temp
// repo, capture its printed (tokened) viewer URL, and tear both down
// afterwards. Mirrors the spawn + readUrlFromStdout pattern from
// apps/viewer/__tests__/cli-smoke.test.ts.
import {
	expect,
	type Locator,
	type Page,
	test as base,
} from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { spawnLongRunning } from "./proc.ts";
import { type FixtureRepoOptions, makeFixtureRepo } from "./repo.ts";

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, "..", "..", "dist", "cli.js");

const readUrlFromStdout = async (stream: Readable): Promise<string> => {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of stream) {
		buffer += decoder.decode(chunk as Buffer, { stream: true });
		const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?\S+/);
		if (match) return match[0];
	}
	throw new Error(`CLI did not print a viewer URL. stdout so far:\n${buffer}`);
};

export interface LaunchedViewer {
	url: string;
	/** 픽스처 리포 경로 — watch 스펙이 구동 후 워킹트리를 편집할 때 쓴다. */
	repoDir: string;
	stop: () => Promise<void>;
}

/**
 * Spawn `dist/cli.js` (with `--no-open --port 0` plus any extra `flags`)
 * against a fresh fixture repo and a per-launch `XDG_CACHE_HOME` (so tokens
 * across parallel/serial launches never collide). Tasks 7-8 use this factory
 * directly to test non-default flag combinations; `viewerUrl` below is the
 * common no-flag case shared across a whole worker.
 */
export const launchViewer = async (
	flags: string[] = [],
	repoOptions: FixtureRepoOptions = {},
): Promise<LaunchedViewer> => {
	const repo = makeFixtureRepo(repoOptions);
	const cacheHome = mkdtempSync(join(tmpdir(), "dd-e2e-cache-"));

	const proc = spawnLongRunning(
		"bun",
		[cliPath, "--no-open", "--port", "0", ...flags],
		{
			cwd: repo.dir,
			env: { ...process.env, XDG_CACHE_HOME: cacheHome },
		},
	);

	// 기동 실패를 원인과 함께 던진다 — 예전엔 readUrlFromStdout의 타임아웃만
	// 보이고 서버가 왜 못 떴는지는 stderr에 남아 그대로 버려졌다.
	let url: string;
	try {
		url = await readUrlFromStdout(proc.stdout);
	} catch (err) {
		const stderr = proc.stderr().trim();
		throw new Error(
			`viewer failed to start: ${String(err)}${stderr ? `\n--- server stderr ---\n${stderr}` : "\n(server wrote nothing to stderr)"}`,
		);
	}

	// 서버가 우리가 끄기 "전에" 스스로 죽었는지 표시해 둔다. 실제로 관측된
	// 실패 모드가 그것이다 — 기동은 정상이고 요청 몇 개를 처리한 뒤 /api/diff
	// 도중 죽어, 화면이 "Loading…"에 고착된다. 그 경우 stderr가 유일한 단서인데
	// 예전엔 읽히지 않고 버려졌다.
	// 두 번째 인자로 rejection도 받는다 — .then(cb)만 쓰면 파생 프라미스에
	// 핸들러가 없어, proc.exited가 reject할 때 unhandled rejection이 된다
	// (proc.ts가 원본 프라미스에 대해 문서화해 둔 바로 그 함정).
	let diedOnItsOwn = false;
	void proc.exited.then(
		() => {
			diedOnItsOwn = true;
		},
		() => {},
	);

	const stop = async (): Promise<void> => {
		// 플래그와 종료 코드를 둘 다 본다 — 어느 쪽도 단독으로 완전하지 않다.
		// 플래그는 자식이 죽었지만 libuv가 아직 close를 전달하지 않은 창을
		// 놓치고, 코드 검사는 자식이 0으로 스스로 죽은 경우를 놓친다. SIGINT로
		// 우리가 죽이면 code는 null → 0이므로 code !== 0은 자기 사망의 독립
		// 증거다.
		const flaggedDead = diedOnItsOwn;
		proc.kill("SIGINT");
		const code = await proc.exited;
		const stderr = proc.stderr().trim();
		const diedEarly = flaggedDead || code !== 0;
		// 게이트가 "죽었을 때"가 아니라 "할 말이 있을 때"인 이유: 실제로 겪는
		// 빨간불은 서버가 **살아 있는 채로** /api/diff를 안 끝내는 행업이라
		// 죽음 게이트로는 아무것도 안 나온다. 조용한 서버면 이 블록은 침묵한다.
		if (stderr || diedEarly) {
			// throw하지 않는다 — stop()은 대개 finally에서 불리므로 던지면 진짜
			// 실패를 덮는다. Playwright가 테스트 출력에 실어 주므로 그걸로 족하다.
			const how = diedEarly
				? `서버가 stop() 전에 스스로 종료했다 (code ${code})`
				: "서버는 살아 있었지만 stderr에 출력이 있다";
			console.error(
				`[launchViewer] ${how}.${stderr ? `\n--- server stderr ---\n${stderr}` : "\n(stderr 비어 있음)"}`,
			);
		}
		repo.cleanup();
		rmSync(cacheHome, { recursive: true, force: true });
	};

	return { url, repoDir: repo.dir, stop };
};

/**
 * Does the diff item for `fileId` currently render its code body? A rendered
 * (expanded) file's `<diffs-container>` shadow root contains a `<pre>`; a
 * header-only (folded) one doesn't. Shared by the tree-fold-sync specs, which
 * all assert fold state through this same real-DOM signal.
 */
export const hasCode = (page: Page, fileId: string): Promise<boolean> =>
	page
		.locator("diffs-container")
		.filter({ has: page.locator(`[data-fold="${fileId}"]`) })
		.evaluate((el) => el.shadowRoot?.querySelector("pre") != null);

/**
 * Which diff style is currently on screen? The engine's `createPreElement`
 * tags the `<pre>` with `data-diff-type="split"` in split mode and `"single"`
 * in unified. The head of the render window can be an image diff (a card with
 * no `<pre>`), so this scans for the first container that actually has one.
 * Returns null when nothing is rendered at all.
 */
export const renderedDiffType = (page: Page): Promise<string | null> =>
	page.evaluate(() => {
		for (const c of document.querySelectorAll("diffs-container")) {
			const pre = c.shadowRoot?.querySelector("pre");
			if (pre) return pre.getAttribute("data-diff-type");
		}
		return null;
	});

type WorkerFixtures = {
	viewerUrl: string;
};

export const test = base.extend<object, WorkerFixtures>({
	viewerUrl: [
		// Playwright inspects this function's source to know which fixtures it
		// depends on, so the first param must literally be a destructuring
		// pattern (even an empty one) — a named param throws at registration.
		async ({}, use) => {
			const { url, stop } = await launchViewer([]);
			await use(url);
			await stop();
		},
		{ scope: "worker" },
	],
});

// 어떤 수치가 정착할 때까지 기다린다 — sleep 대신 "연속 두 번 같은 값".
const waitForStable = async (
	read: () => Promise<number>,
	requirePositive = true,
): Promise<void> => {
	let last = Number.NaN;
	await expect
		.poll(
			async () => {
				const value = await read();
				const stable = (!requirePositive || value > 0) && value === last;
				last = value;
				return stable;
			},
			{ timeout: 15_000, intervals: [100] },
		)
		.toBe(true);
};

// 초기 레이아웃 정착. CodeView는 아이템 높이를 추정으로 먼저 채우고 실제
// 측정되는 대로 늘려가므로, 정착 전에 "높이의 절반"으로 스크롤하면 같은
// 비율이라도 매번 다른 파일에 떨어진다 — 그 창에서는 엔진이 잡는 앵커와
// 아래 topVisibleFileId()가 DOM rect로 읽는 앵커가 어긋난다.
export const waitForStableHeight = (scroller: Locator): Promise<void> =>
	waitForStable(() => scroller.evaluate((el) => el.scrollHeight));

// 스크롤 위치 정착. scrollTop을 직접 대입해도 엔진은 다음 프레임에 자기
// 페이지드 스크롤 모델로 위치를 보정할 수 있다. 보정 전에 앵커를 샘플링하면
// 그 뒤 뷰포트가 움직여 앵커가 화면 밖으로 나갈 수 있으므로, 값이 멈춘 뒤에
// 읽는다.
export const waitForStableScrollTop = (scroller: Locator): Promise<void> =>
	waitForStable(() => scroller.evaluate((el) => el.scrollTop));

// 뷰포트 최상단에 걸친 첫 diff 컨테이너의 파일 id. 스크롤 컨테이너와
// 컨테이너들의 실제 rect를 비교해 구한다 (가상화로 렌더 윈도우 밖 파일은
// DOM에 없지만, 최상단 파일은 반드시 있다).
export const topVisibleFileId = (page: Page): Promise<string | null> =>
	page.evaluate(() => {
		const scroller = document.getElementById("diff") as HTMLElement;
		const { top } = scroller.getBoundingClientRect();
		for (const c of document.querySelectorAll("diffs-container")) {
			// 1px 여유: 최상단 파일의 하단 경계가 뷰포트 상단에 정확히 닿은
			// 경우를 "보인다"로 세지 않는다.
			if (c.getBoundingClientRect().bottom > top + 1) {
				return (
					c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ?? null
				);
			}
		}
		return null;
	});

// 한 파일의 상단이 스크롤 뷰포트 상단으로부터 몇 px 떨어져 있는지.
//
// 이게 "앵커됐다"와 "그냥 비례로 늘어났다"를 가르는 신호다. 파일 하나가
// 뷰포트 여러 개 높이라 "뷰포트 안에 있다"만으로는 둘을 구분할 수 없다 —
// 엔진이 앵커를 놓치고 scrollTop을 높이 비율로만 환산해도 같은 파일 안에
// 떨어질 가능성이 높기 때문. 반면 아이템 앵커링은 그 파일의 상단을 뷰포트
// 기준 같은 위치에 정확히 붙들어 둔다. 두 예측은 실제로 갈린다: 헤더·이미지
// 카드처럼 스타일에 따라 줄지 않는 고정 높이가 섞여 있어 전체 높이는
// 균일하게 스케일되지 않는다.
export const anchorOffset = (page: Page, fileId: string): Promise<number> =>
	page.evaluate((id) => {
		const scroller = document.getElementById("diff") as HTMLElement;
		const container = [...document.querySelectorAll("diffs-container")].find(
			(el) => el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold === id,
		);
		// 렌더 윈도우 밖으로 밀려나 아예 없으면 NaN — 단언이 통과할 수 없다.
		if (!container) return Number.NaN;
		return Math.round(
			container.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top,
		);
	}, fileId);

// 앵커 유지 허용 오차(px). 실측은 전환 전후가 정확히 일치했지만(-100 → -100),
// 서브픽셀 반올림 여지를 둔다. 비례 스케일로 어긋나면 수백 px씩 벌어지므로
// 이 폭으로도 회귀는 확실히 잡힌다.
export const ANCHOR_TOLERANCE_PX = 40;

export { expect };
