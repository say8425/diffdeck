import { expect, test } from "@playwright/test";
import { rmSync } from "node:fs";
import { launchViewer } from "./fixtures/app.ts";
import { makeFixtureRepo } from "./fixtures/repo.ts";

// 기동 cwd와 서빙 repo를 반드시 분리해야 한다. 같으면 그 디렉토리를 지웠을
// 때 repo 자체가 사라져 400이 정답이 되어버려 아무것도 증명하지 못한다.
// 여기서는 throwaway를 cwd로 주고, launchViewer가 내부에 만든 픽스처 repo를
// 서빙 대상으로 쓴다.
test("기동 디렉토리가 삭제돼도 다른 repo를 계속 서빙한다", async () => {
	const throwaway = makeFixtureRepo();
	const viewer = await launchViewer([], {}, throwaway.dir);

	try {
		const launched = new URL(viewer.url);
		const token = launched.searchParams.get("token");
		expect(token).toBeTruthy();

		// 데몬의 cwd가 사라진다 — 예방이 없으면 이 프로세스는 이 시점부터
		// 자식 프로세스를 하나도 띄우지 못해 모든 git 호출이 죽는다.
		rmSync(throwaway.dir, { recursive: true, force: true });

		const res = await fetch(
			`${launched.origin}/api/diff?repo=${encodeURIComponent(viewer.repoDir)}&token=${token}`,
		);

		expect(res.status).toBe(200);
		const files = (await res.json()) as unknown[];
		expect(files.length).toBeGreaterThan(0);
	} finally {
		await viewer.stop();
		rmSync(throwaway.dir, { recursive: true, force: true });
	}
});
