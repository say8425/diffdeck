import { expect, test } from "@playwright/test";
import { rmSync } from "node:fs";
import { launchViewer } from "./fixtures/app.ts";
import { makeFixtureRepo } from "./fixtures/repo.ts";

// 기동 cwd(throwaway)와 서빙 repo를 분리한다 — 같으면 cwd를 지울 때 repo도
// 사라져 400이 정답이 되므로 아무것도 증명하지 못한다.
test("기동 디렉토리가 삭제돼도 다른 repo를 계속 서빙한다", async () => {
	const throwaway = makeFixtureRepo();
	const viewer = await launchViewer([], {}, throwaway.dir);

	try {
		const launched = new URL(viewer.url);
		const token = launched.searchParams.get("token");
		expect(token).toBeTruthy();

		rmSync(throwaway.dir, { recursive: true, force: true });

		const res = await fetch(
			`${launched.origin}/api/diff?repo=${encodeURIComponent(viewer.repoDir)}&token=${token}`,
		);

		expect(res.status).toBe(200);
		const files = (await res.json()) as unknown[];
		expect(files.length).toBeGreaterThan(0);
	} finally {
		await viewer.stop();
		throwaway.cleanup();
	}
});
