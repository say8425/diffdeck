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
	repoDir: string;
	stop: () => Promise<void>;
}

/**
 * 실행마다 새 픽스처 리포와 `XDG_CACHE_HOME`을 쓴다 — 병렬·연속 실행의
 * 토큰이 섞이지 않게.
 */
export const launchViewer = async (
	flags: string[] = [],
	repoOptions: FixtureRepoOptions = {},
	// 기본은 픽스처 리포. 따로 주면 기동 cwd를 지워도 서빙 대상 리포는 남는다
	// ("cwd 삭제"와 "리포 삭제"를 가른다 — daemon-cwd.e2e.ts).
	launchCwd?: string,
	extraEnv: Record<string, string> = {},
): Promise<LaunchedViewer> => {
	const repo = makeFixtureRepo(repoOptions);
	const cacheHome = mkdtempSync(join(tmpdir(), "dd-e2e-cache-"));

	const proc = spawnLongRunning(
		"bun",
		[cliPath, "--no-open", "--port", "0", ...flags],
		{
			cwd: launchCwd ?? repo.dir,
			env: { ...process.env, XDG_CACHE_HOME: cacheHome, ...extraEnv },
		},
	);

	let url: string;
	try {
		url = await readUrlFromStdout(proc.stdout);
	} catch (err) {
		const stderr = proc.stderr().trim();
		throw new Error(
			`viewer failed to start${stderr ? `\n--- server stderr ---\n${stderr}` : "\n(server wrote nothing to stderr)"}`,
			{ cause: err },
		);
	}

	// rejection도 받는다 — .then(cb)만 쓰면 proc.exited가 reject할 때 파생
	// 프라미스가 unhandled rejection이 된다(proc.ts).
	let diedOnItsOwn = false;
	void proc.exited.then(
		() => (diedOnItsOwn = true),
		() => false,
	);

	const stop = async (): Promise<void> => {
		// 플래그와 종료 코드를 둘 다 본다. 플래그는 자식이 죽었지만 close가 아직
		// 전달되지 않은 창을, 코드는 스스로 0으로 끝난 경우를 놓친다(우리가
		// SIGINT로 끄면 code는 0이다).
		const flaggedDead = diedOnItsOwn;
		proc.kill("SIGINT");
		const code = await proc.exited;
		const stderr = proc.stderr().trim();
		const diedEarly = flaggedDead || code !== 0;
		// 죽었을 때만이 아니라 stderr가 있으면 찍는다 — 흔한 빨간불은 서버가
		// 살아 있는 채 /api/diff를 끝내지 않는 행업이다.
		if (stderr || diedEarly) {
			// throw하지 않는다 — stop()은 대개 finally에서 불려 던지면 진짜 실패를
			// 덮는다.
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

/** 펼친 파일만 shadow root에 `<pre>`가 있다 — 접힘 상태를 실제 DOM으로 읽는다. */
export const hasCode = (page: Page, fileId: string): Promise<boolean> =>
	page
		.locator("diffs-container")
		.filter({ has: page.locator(`[data-fold="${fileId}"]`) })
		.evaluate((el) => el.shadowRoot?.querySelector("pre") != null);

/**
 * 엔진이 `<pre>`에 `data-diff-type`(split | single)을 단다. 렌더 윈도우의 첫
 * 컨테이너가 `<pre>` 없는 이미지 diff일 수 있어 `<pre>`가 있는 첫 것을 본다.
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

// CodeView는 아이템 높이를 추정으로 채웠다가 측정하며 늘린다 — 정착 전에
// 비율로 스크롤하면 매번 다른 파일에 떨어진다.
export const waitForStableHeight = (scroller: Locator): Promise<void> =>
	waitForStable(() => scroller.evaluate((el) => el.scrollHeight));

// scrollTop을 대입해도 엔진이 다음 프레임에 위치를 보정할 수 있다 — 값이
// 멈춘 뒤에 앵커를 읽는다.
export const waitForStableScrollTop = (scroller: Locator): Promise<void> =>
	waitForStable(() => scroller.evaluate((el) => el.scrollTop));

export const topVisibleFileId = (page: Page): Promise<string | null> =>
	page.evaluate(() => {
		const scroller = document.getElementById("diff") as HTMLElement;
		const { top } = scroller.getBoundingClientRect();
		for (const c of document.querySelectorAll("diffs-container")) {
			// 하단이 뷰포트 상단에 정확히 닿은 파일은 보이는 것으로 치지 않는다.
			if (c.getBoundingClientRect().bottom > top + 1) {
				return (
					c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ?? null
				);
			}
		}
		return null;
	});

// 앵커 유지의 신호. 파일 하나가 뷰포트 여러 개 높이라 "보이는가"로는 비례
// 환산과 갈리지 않는다. 앵커링은 파일 상단의 뷰포트 기준 위치를 그대로
// 붙들고, 비례 환산은 고정 높이(헤더·이미지 카드) 때문에 다른 위치를 낸다.
export const anchorOffset = (page: Page, fileId: string): Promise<number> =>
	page.evaluate((id) => {
		const scroller = document.getElementById("diff") as HTMLElement;
		const container = [...document.querySelectorAll("diffs-container")].find(
			(el) => el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold === id,
		);
		// 렌더 윈도우 밖이면 NaN — 어떤 단언도 통과하지 못한다.
		if (!container) return Number.NaN;
		return Math.round(
			container.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top,
		);
	}, fileId);

// 서브픽셀 반올림 여유. 앵커를 놓치면 수백 px 벌어지므로 이 폭으로도
// 회귀가 잡힌다.
export const ANCHOR_TOLERANCE_PX = 40;

export { expect };
