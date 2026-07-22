// Playwright fixtures: spawn the built CLI (`dist/cli.js`, via the real `bun`
// binary — see fixtures/proc.ts) against a fresh `makeFixtureRepo()` temp
// repo, capture its printed (tokened) viewer URL, and tear both down
// afterwards. Mirrors the spawn + readUrlFromStdout pattern from
// apps/viewer/__tests__/cli-smoke.test.ts.
import { test as base } from "@playwright/test";
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

	const url = await readUrlFromStdout(proc.stdout);

	const stop = async (): Promise<void> => {
		proc.kill("SIGINT");
		await proc.exited;
		repo.cleanup();
		rmSync(cacheHome, { recursive: true, force: true });
	};

	return { url, repoDir: repo.dir, stop };
};

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

export { expect } from "@playwright/test";
