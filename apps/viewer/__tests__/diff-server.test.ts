import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import packageJson from "../package.json";
import { startDiffServer } from "../server/server.ts";
import {
	generateToken,
	getTokenPath,
	persistToken,
	readTokenSync,
} from "../server/token.ts";

let repo: string;
let viewerDir: string;
let cacheHome: string;
let handle: ReturnType<typeof startDiffServer>;
let base: string;

beforeEach(async () => {
	repo = mkdtempSync(join(tmpdir(), "cc-srv-repo-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	writeFileSync(join(repo, "a.txt"), "one\n");
	await $`git -C ${repo} add a.txt`;
	await $`git -C ${repo} commit -qm init`;
	writeFileSync(join(repo, "a.txt"), "two\n");

	viewerDir = mkdtempSync(join(tmpdir(), "cc-srv-view-"));
	writeFileSync(join(viewerDir, "index.html"), "<html>viewer</html>");

	cacheHome = mkdtempSync(join(tmpdir(), "cc-srv-cache-"));
	handle = startDiffServer({
		port: 0,
		viewerDir,
		env: { XDG_CACHE_HOME: cacheHome },
	});
	base = `http://127.0.0.1:${handle.server.port}`;
});

afterEach(() => {
	handle.stop();
	for (const d of [repo, viewerDir, cacheHome])
		rmSync(d, { recursive: true, force: true });
});

describe("diff server", () => {
	test("ping returns 204 with marker header", async () => {
		const res = await fetch(`${base}/api/ping`);
		expect(res.status).toBe(204);
		expect(res.headers.get("x-diffdeck")).toBe("1");
	});

	// A long-lived daemon outlives the package that spawned it, so upgrading
	// diffdeck on disk does not upgrade what is answering the port. Clients
	// (cc-statusline) diff these against the version they resolved and replace
	// the daemon on a mismatch — which needs the pid, since the incumbent is
	// detached and its spawner is long gone.
	test("ping reports the running version and pid so a client can spot a stale daemon", async () => {
		const res = await fetch(`${base}/api/ping`);
		expect(res.headers.get("x-diffdeck-version")).toBe(packageJson.version);
		expect(res.headers.get("x-diffdeck-pid")).toBe(String(process.pid));
	});

	// The mirror of the test below: binding the port is what makes the token
	// publishable, so a successful start must actually publish it. A client
	// reads this file to decide a daemon is usable — without it there is no
	// link at all, and nothing else here would notice.
	test("publishes the token once the port is really ours", () => {
		expect(readTokenSync({ XDG_CACHE_HOME: cacheHome })).toBe(handle.token);
	});

	// A token already on disk is handed out to every later daemon, so an open
	// viewer tab keeps working across a restart.
	test("reuses a token that was already issued", () => {
		const reuseCacheHome = mkdtempSync(join(tmpdir(), "cc-srv-reuse-"));
		const env = { XDG_CACHE_HOME: reuseCacheHome };
		const existing = generateToken();
		persistToken(existing, env);
		const reused = startDiffServer({ port: 0, viewerDir, env });
		try {
			expect(reused.token).toBe(existing);
		} finally {
			reused.stop();
			rmSync(reuseCacheHome, { recursive: true, force: true });
		}
	});

	// The token is the client's only signal that a daemon is usable. Issuing it
	// before the port is bound means a spawn that dies on EADDRINUSE still
	// leaves one behind, and the client then renders a link pointing at whoever
	// actually owns the port — which answers 403. Fail with nothing instead.
	test("a failed port bind leaves no token behind", () => {
		const busyCacheHome = mkdtempSync(join(tmpdir(), "cc-srv-busy-"));
		const env = { XDG_CACHE_HOME: busyCacheHome };
		try {
			expect(() =>
				startDiffServer({ port: handle.server.port, viewerDir, env }),
			).toThrow();
			expect(existsSync(getTokenPath(env))).toBe(false);
		} finally {
			rmSync(busyCacheHome, { recursive: true, force: true });
		}
	});

	test("serves index.html at / with no-store so the viewer is never stale", async () => {
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.text()).toContain("viewer");
	});

	test("api/diff rejects a bad token with 403", async () => {
		const res = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(repo)}&token=wrong`,
		);
		expect(res.status).toBe(403);
	});

	test("api/diff returns the diff with the correct token and no CORS header", async () => {
		const url = `${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}`;
		const res = await fetch(url);
		expect(res.status).toBe(200);
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
		expect(res.headers.get("content-type")).toContain("application/json");
		const files = (await res.json()) as Array<{
			name: string;
			status: string;
			newContents: string;
		}>;
		const file = files.find((f) => f.name === "a.txt");
		expect(file?.status).toBe("modified");
		expect(file?.newContents).toContain("two");
	});

	test("api/diff sets an ETag and answers a matching If-None-Match with 304", async () => {
		const url = `${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}`;
		const first = await fetch(url);
		expect(first.status).toBe(200);
		const etag = first.headers.get("etag");
		expect(etag).toBeTruthy();
		await first.text();

		const second = await fetch(url, {
			headers: { "if-none-match": etag ?? "" },
		});
		expect(second.status).toBe(304);
		// 304에도 x-diff-base는 실린다 — 클라이언트가 드롭다운 라벨을 유지한다.
		expect(second.headers.get("x-diff-base")).not.toBeNull();
		expect(await second.text()).toBe("");
	});

	test("api/diff returns 200 with a new ETag after an edit", async () => {
		const url = `${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}`;
		const first = await fetch(url);
		const etag = first.headers.get("etag");
		await first.text();
		writeFileSync(join(repo, "a.txt"), "three\n");
		const second = await fetch(url, {
			headers: { "if-none-match": etag ?? "" },
		});
		expect(second.status).toBe(200);
		expect(second.headers.get("etag")).toBeTruthy();
		expect(second.headers.get("etag")).not.toBe(etag);
		const files = (await second.json()) as Array<{ newContents: string }>;
		expect(files[0]?.newContents).toContain("three");
	});

	test("api/diff without If-None-Match keeps returning the full payload", async () => {
		const url = `${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}`;
		const first = await fetch(url);
		const firstBody = await first.text();
		// 지문이 그대로면 캐시에서 답하되, 조건부 요청이 아니므로 항상 200 본문.
		const second = await fetch(url);
		expect(second.status).toBe(200);
		expect(second.headers.get("etag")).toBe(first.headers.get("etag"));
		expect(await second.text()).toBe(firstBody);
	});

	test("api/diff rejects a non-repo path with 400", async () => {
		const plain = mkdtempSync(join(tmpdir(), "cc-srv-plain-"));
		const url = `${base}/api/diff?repo=${encodeURIComponent(plain)}&token=${handle.token}`;
		const res = await fetch(url);
		expect(res.status).toBe(400);
		rmSync(plain, { recursive: true, force: true });
	});

	test("blocks path traversal on static files", async () => {
		const res = await fetch(`${base}/../../etc/passwd`);
		expect([403, 404]).toContain(res.status);
	});

	test("blocks an un-normalized absolute path with a real 403 over the wire", async () => {
		// fetch() normalizes "/../../etc/passwd" client-side before it ever hits
		// the server, so the request above never reaches the 403 branch in
		// createHandler (it 404s on a literal "../../etc/passwd" file instead).
		// A raw socket lets us send a path Bun's URL parser won't collapse:
		// a double leading slash. `url.pathname` keeps it as "//etc/passwd", so
		// `rel` becomes the absolute path "/etc/passwd", and
		// `path.resolve(viewerRoot, "/etc/passwd")` escapes viewerRoot entirely,
		// exercising the real traversal guard.
		const response = await new Promise<string>(
			(resolvePromise, rejectPromise) => {
				let buffer = "";
				Bun.connect({
					hostname: "127.0.0.1",
					port: handle.server.port,
					socket: {
						open(socket) {
							socket.write(
								"GET //etc/passwd HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
							);
						},
						data(_socket, data) {
							buffer += data.toString();
						},
						close() {
							resolvePromise(buffer);
						},
						error(_socket, error) {
							rejectPromise(error);
						},
						connectError(_socket, error) {
							rejectPromise(error);
						},
					},
				}).catch(rejectPromise);
			},
		);

		const statusLine = response.split("\r\n")[0] ?? "";
		expect(statusLine).toContain("403");
	});

	// 커버리지 게이트는 branch를 세지 않으므로 분기 양쪽을 각각 찌른다 —
	// 한쪽만 있으면 repairCwd가 영영 안 불려도 100%로 찍힌다.
	test("cwd가 삭제됐으면 요청 처리 전에 복구를 호출한다", async () => {
		const repairCwd = mock();
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			repairCwd,
			cwdDeps: { cwd: () => "/gone", exists: () => false },
		});
		try {
			await fetch(`http://127.0.0.1:${h.server.port}/api/ping`);
			expect(repairCwd).toHaveBeenCalledTimes(1);
		} finally {
			h.stop();
		}
	});

	test("cwd가 살아있으면 복구를 호출하지 않는다", async () => {
		const repairCwd = mock();
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			repairCwd,
			cwdDeps: { cwd: () => repo, exists: () => true },
		});
		try {
			await fetch(`http://127.0.0.1:${h.server.port}/api/ping`);
			expect(repairCwd).not.toHaveBeenCalled();
		} finally {
			h.stop();
		}
	});

	// cwdDeps를 안 넘기면 REAL_CWD_DEPS(process.cwd()/existsSync)가
	// 쓰인다 — M-4로 탐지가 repairCwd 유무로 단축평가되면서, cwdDeps까지
	// 생략한 호출이 없으면 REAL_CWD_DEPS.cwd가 영영 호출되지 않아 함수
	// 커버리지가 100%에서 떨어진다(실측). 실제 cwd는 살아있으므로 복구는
	// 안 불리지만, 이 테스트의 목적은 그 경로 자체가 실행되는 것이다.
	test("repairCwd만 넘기고 cwdDeps는 생략하면 실제 process.cwd()를 쓴다", async () => {
		const repairCwd = mock();
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			repairCwd,
		});
		try {
			await fetch(`http://127.0.0.1:${h.server.port}/api/ping`);
			expect(repairCwd).not.toHaveBeenCalled();
		} finally {
			h.stop();
		}
	});

	// repairCwd를 안 넘긴 호스트는 정의상 cwd를 건드리길 원하지 않는
	// 쪽이므로 탐지 자체(isCwdAlive 호출)가 매 요청 순수 비용이 되면 안
	// 된다 — cwdDeps가 "죽었다"고 답하도록 세팅해 두고도 exists가 한
	// 번도 안 불리는 것으로 탐지가 통째로 건너뛰었음을 증명한다.
	test("repairCwd를 안 넘기면 cwd 탐지 자체를 건너뛴다", async () => {
		const exists = mock(() => false);
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			cwdDeps: { cwd: () => "/gone", exists },
		});
		try {
			const res = await fetch(`http://127.0.0.1:${h.server.port}/api/ping`);
			expect(res.status).toBe(204);
			expect(exists).not.toHaveBeenCalled();
		} finally {
			h.stop();
		}
	});
});

describe("api/blob", () => {
	test("rejects a bad token with 403", async () => {
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=wrong&path=a.txt&side=new`,
		);
		expect(res.status).toBe(403);
	});

	test("serves working-tree bytes for side=new with the image content-type", async () => {
		writeFileSync(
			join(repo, "shot.png"),
			Buffer.from([0x89, 0x50, 0x00, 0x47]),
		);
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=shot.png&side=new`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([
			0x89, 0x50, 0x00, 0x47,
		]);
	});

	test("serves committed bytes for side=old", async () => {
		writeFileSync(join(repo, "pic.png"), Buffer.from([0x01, 0x00, 0x01]));
		await $`git -C ${repo} add pic.png`;
		await $`git -C ${repo} commit -qm pic`;
		writeFileSync(join(repo, "pic.png"), Buffer.from([0x02, 0x00, 0x02]));
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=pic.png&side=old`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([
			0x01, 0x00, 0x01,
		]);
	});

	test("mode=base serves image bytes from the merge-base ref", async () => {
		await $`git -C ${repo} branch -M main`;
		writeFileSync(join(repo, "icon.png"), Buffer.from([0x10, 0x20]));
		await $`git -C ${repo} add icon.png`;
		await $`git -C ${repo} commit -qm icon`;
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "icon.png"), Buffer.from([0x30, 0x40]));

		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=icon.png&side=old&mode=base`,
		);
		expect(res.status).toBe(200);
		expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([
			0x10, 0x20,
		]);
	});

	test("404 for a missing side", async () => {
		writeFileSync(join(repo, "fresh.png"), Buffer.from([0x00]));
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=fresh.png&side=old`,
		);
		expect(res.status).toBe(404);
	});

	test("404 for a non-image path (blob endpoint is image-only)", async () => {
		// a.txt는 커밋돼 있고 워킹트리에도 존재하지만, 이미지가 아니므로 거부.
		for (const side of ["old", "new"]) {
			const res = await fetch(
				`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=a.txt&side=${side}`,
			);
			expect(res.status).toBe(404);
		}
	});

	test("404 for an image-suffixed path escaping the repo", async () => {
		// isImagePath 게이트를 통과하는 확장자 + repo 밖에 "실재하는" 파일로
		// getFileBytes의 경로 탈출 가드를 겨냥한다 — 가드가 사라지면 이 파일이
		// 실제로 읽혀 200이 나오므로 진짜 회귀망이 된다.
		const outside = join(repo, "..", "outside-secret.png");
		writeFileSync(outside, Buffer.from([0x89, 0x00]));
		try {
			const res = await fetch(
				`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=${encodeURIComponent("../outside-secret.png")}&side=new`,
			);
			expect(res.status).toBe(404);
		} finally {
			rmSync(outside, { force: true });
		}
	});

	test("404 for an empty path", async () => {
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=&side=old`,
		);
		expect(res.status).toBe(404);
	});

	test("400 for a non-repo path", async () => {
		const plain = mkdtempSync(join(tmpdir(), "cc-srv-plain2-"));
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(plain)}&token=${handle.token}&path=a.txt&side=new`,
		);
		expect(res.status).toBe(400);
		rmSync(plain, { recursive: true, force: true });
	});

	test("404 for a path escaping the repo", async () => {
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=${encodeURIComponent("../../etc/passwd")}&side=new`,
		);
		expect(res.status).toBe(404);
	});
});

describe("diff server base mode", () => {
	test("mode=base diffs against the base branch and sets X-Diff-Base", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "c.txt"), "committed on branch\n");
		await $`git -C ${repo} add c.txt`;
		await $`git -C ${repo} commit -qm branch-commit`;

		const url = `${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}&mode=base`;
		const res = await fetch(url);
		expect(res.status).toBe(200);
		expect(res.headers.get("x-diff-base")).toBe("main");
		const files = (await res.json()) as Array<{ name: string; status: string }>;
		expect(files.some((f) => f.name === "c.txt" && f.status === "added")).toBe(
			true,
		);
	});

	test("working mode still sets X-Diff-Base for the dropdown label", async () => {
		await $`git -C ${repo} branch -M main`;
		const url = `${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}`;
		const res = await fetch(url);
		expect(res.status).toBe(200);
		expect(res.headers.get("x-diff-base")).toBe("main");
	});
});

describe("diff server summary", () => {
	test("api/summary rejects a bad token", async () => {
		const res = await fetch(
			`${base}/api/summary?repo=${encodeURIComponent(repo)}&token=nope`,
		);
		expect(res.status).toBe(403);
	});

	test("api/summary rejects a non-repo path", async () => {
		const res = await fetch(
			`${base}/api/summary?repo=${encodeURIComponent(viewerDir)}&token=${handle.token}`,
		);
		expect(res.status).toBe(400);
	});

	test("api/summary reports counts for the fixture repo", async () => {
		await $`git -C ${repo} branch -M main`;
		const res = await fetch(
			`${base}/api/summary?repo=${encodeURIComponent(repo)}&token=${handle.token}`,
		);
		expect(res.status).toBe(200);
		const s = (await res.json()) as {
			branch: string;
			base: string;
			workingFiles: number;
		};
		// beforeEach 픽스처는 a.txt를 워킹트리에서 수정해 둔다.
		expect(s.branch).toBe("main");
		expect(s.base).toBe("main");
		expect(s.workingFiles).toBe(1);
	});
});

describe("diff server flight timeout", () => {
	// await-flight.test.ts는 손으로 만든 SingleFlightTimeoutError가 503으로
	// 바뀌는 것을, single-flight.test.ts는 진짜 타임아웃이 그 에러를 낳는
	// 것을 각각 단위로 증명한다. 이 테스트는 그 둘을 실제 서버 위에서 이어
	// 붙인다 — createHandler의 flightTimeoutMs 훅(테스트 전용, CLI 표면에는
	// 없음)으로 baseFlight/diffFlight 타임아웃을 몇 ms로 낮추면, 정상적인
	// git 서브프로세스 왕복조차 그보다 오래 걸려 진짜 타임아웃이 걸리고,
	// 그 결과가 손으로 만든 Response가 아니라 실제 HTTP 응답으로 도착하는지
	// 검증한다.
	//
	// 이 테스트는 baseCache **미스**에 기댄다 — 보장의 근거는 "이 describe에서
	// 처음 등장"이 아니라 **테스트마다 유일한 repo 경로**다: 파일 최상단
	// beforeEach가 매번 mkdtempSync로 새 디렉터리를 만들고, baseCache는 그
	// 경로로 키가 갈리므로(server.ts) 이전 어떤 테스트도 이 repo에 대한
	// 항목을 남길 수 없다. 이 표현이 중요한 이유: repo를 beforeAll로 끌어올려
	// 여러 테스트가 공유하게 "최적화"하면(그래야 describe-position 논리는
	// 안 깨진다는 착각이 들 수 있다) 이 파일의 앞선 /api/diff 테스트 ~20개가
	// 그 공유 repo의 baseCache를 먼저 데워 버려, 이 테스트가 조용히
	// diffFlight 가드로 미끄러져도 여전히 통과한다 — "유일한 repo 경로"라고
	// 못박아야 그 리팩터가 이 불변식을 깬다는 게 보인다. 아래 두 번째
	// 테스트는 정반대로 baseCache **히트**가 있어야만 성립한다 — 둘을
	// 하나의 공유 beforeEach/픽스처로 "정리"하면 둘 다 조용히 깨진다.
	test("api/diff answers a real flight timeout with a real 503 + Retry-After over HTTP", async () => {
		const timeoutCacheHome = mkdtempSync(join(tmpdir(), "cc-srv-timeout-"));
		const timeoutHandle = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: timeoutCacheHome },
			flightTimeoutMs: 1,
		});
		try {
			const timeoutBase = `http://127.0.0.1:${timeoutHandle.server.port}`;
			const res = await fetch(
				`${timeoutBase}/api/diff?repo=${encodeURIComponent(repo)}&token=${timeoutHandle.token}`,
			);
			expect(res.status).toBe(503);
			expect(res.headers.get("retry-after")).toBe("1");
			expect(await res.text()).toBe("diff pipeline busy, retry shortly");
		} finally {
			timeoutHandle.stop();
			rmSync(timeoutCacheHome, { recursive: true, force: true });
		}
	});

	// 위 테스트가 증명하는 건 baseFlight 가드뿐이다: flightTimeoutMs:1에서는
	// /api/diff가 먼저 await하는 baseFlight가 항상 이 타이밍에 지므로,
	// diffFlight의 가드(server.ts 두 번째 awaitFlight)는 한 번도 실행되지
	// 않는다. singleFlight.ts의 자체 docstring이 기록한 실측 never-settle은
	// baseFlight(gh pr view)가 아니라 diffFlight(diff.ts의
	// BUILD_CONCURRENCY=8 git 버스트)다 — 실제로 걸렸던 적 없는 쪽만 증명하고
	// 실제로 걸렸던 쪽은 미검증으로 남기는 건 순서가 거꾸로다.
	//
	// baseCache는 server.ts에서 여전히 모듈 전역 싱글턴이므로(diffCache와
	// 달리 createHandler 안으로 옮기지 않았다 — 플라이트와는 별개 관심사),
	// 아래에서 새로 띄우는 flightTimeoutMs:1 서버도 그 항목을 그대로 본다.
	// 먼저 기본 타임아웃 서버로 같은 repo를 정상 요청해 baseCache를 데우면:
	// resolveBaseCached의 fn()은 캐시 히트일 때 `await` 없이 동기적으로
	// `return hit.value`하므로(server.ts:96-103, resolveBaseCached 정의) 그
	// 반환 프라미스는 마이크로태스크에서 즉시 settle하고, 마이크로태스크
	// 큐는 어떤 매크로태스크(1ms 타이머 포함)보다도 항상 먼저 비므로 —
	// baseFlight는 결정적으로(레이스가 아니라) 이긴다. 그러면 handler는
	// diffFlight로 진입하고, 그 fn()은 첫 줄에서 repoFingerprint(진짜 git
	// 서브프로세스 왕복)를 await하므로 1ms를 반드시 넘겨 **두 번째** 가드가
	// 진짜로 타임아웃한다.
	test("api/diff answers a real diffFlight timeout (not baseFlight) with a real 503", async () => {
		const warm = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}`,
		);
		expect(warm.status).toBe(200);
		await warm.text();

		const timeoutCacheHome = mkdtempSync(join(tmpdir(), "cc-srv-timeout2-"));
		const timeoutHandle = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: timeoutCacheHome },
			flightTimeoutMs: 1,
		});
		try {
			const timeoutBase = `http://127.0.0.1:${timeoutHandle.server.port}`;
			const res = await fetch(
				`${timeoutBase}/api/diff?repo=${encodeURIComponent(repo)}&token=${timeoutHandle.token}`,
			);
			expect(res.status).toBe(503);
			expect(res.headers.get("retry-after")).toBe("1");
			expect(await res.text()).toBe("diff pipeline busy, retry shortly");
		} finally {
			timeoutHandle.stop();
			rmSync(timeoutCacheHome, { recursive: true, force: true });
		}
	});
});

// HTTP 헤더 값은 latin1이다. git은 refname에 비ASCII를 허용하므로 base 브랜치
// 이름이 한글/일본어/중국어이면 x-diff-base를 실은 Response 생성이 throw하고
// 응답 전체가 500이 된다(Bun 1.3.12 실측). 클라의 fetchDiffOnce는 비-503
// non-ok를 terminal로 매핑해 재시도 없이 "Failed to load diff."를 띄우므로,
// 그런 리포는 diff가 아예 뜨지 않는다. 이 리포는 이미 korean-filename.e2e.ts를
// 갖고 있어 비ASCII git 식별자는 범위 안이다.
describe("diff server non-latin1 base name", () => {
	// 원격 없이 refs만 세워 hermetic하게 만든다: origin/HEAD -> origin/<한글>.
	// resolveBaseRef의 defaultBranchName 갈래가 이걸 읽어 base를 낸다.
	//
	// refname을 반드시 ${보간}으로 넘길 것 — Bun 1.3.12의 $ 템플릿에 비ASCII를
	// 리터럴로 적으면 "uAE30uB2A5" 같은 ASCII 텍스트로 뭉개져(실측: 코드포인트
	// 75 41 45 33 30 …) 한글이 아닌 브랜치가 만들어지고, 테스트가 조용히
	// 아무것도 검증하지 않게 된다.
	const KOREAN_BRANCH = "기능";
	const setUpKoreanBase = async (): Promise<void> => {
		const head = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
		const ref = `refs/remotes/origin/${KOREAN_BRANCH}`;
		await $`git -C ${repo} update-ref ${ref} ${head}`;
		await $`git -C ${repo} symbolic-ref refs/remotes/origin/HEAD ${ref}`;
	};

	test("serves the diff instead of 500 when the base branch is non-latin1", async () => {
		await setUpKoreanBase();
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		expect(res.status).toBe(200);
	});

	test("reports the non-latin1 base name so the client can render it", async () => {
		await setUpKoreanBase();
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		expect(decodeURIComponent(res.headers.get("x-diff-base") ?? "")).toBe(
			KOREAN_BRANCH,
		);
	});
});

describe("diff server refs route", () => {
	test("rejects a request without the token", async () => {
		const res = await fetch(
			`${base}/api/refs?repo=${encodeURIComponent(repo)}`,
		);
		expect(res.status).toBe(403);
	});

	test("rejects a path that is not a git repository", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/refs?repo=${encodeURIComponent(viewerDir)}&token=${token}`,
		);
		expect(res.status).toBe(400);
	});

	test("lists the current worktree and its branch", async () => {
		await $`git -C ${repo} branch -M main`;
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/refs?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			worktrees: Array<{ branch: string | null }>;
			refs: Array<{ name: string; worktreePath: string | null }>;
			defaultBranch: string | null;
		};
		expect(body.worktrees.map((w) => w.branch)).toEqual(["main"]);
		const main = body.refs.find((r) => r.name === "main");
		expect(main?.worktreePath).not.toBeNull();
	});
});

describe("diff server caller-supplied base", () => {
	const tok = (): string =>
		readTokenSync({ XDG_CACHE_HOME: cacheHome }) as string;

	const diff = (query: string): Promise<Response> =>
		fetch(
			`${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${tok()}&${query}`,
		);

	test("compares against the branch the caller names", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feature`;
		writeFileSync(join(repo, "c.txt"), "on the branch\n");
		await $`git -C ${repo} add c.txt`;
		await $`git -C ${repo} commit -qm branch-work`;

		const res = await diff("base=main");
		expect(res.status).toBe(200);
		expect(decodeURIComponent(res.headers.get("x-diff-base") ?? "")).toBe(
			"main",
		);
		const files = (await res.json()) as Array<{ name: string }>;
		expect(files.map((f) => f.name)).toContain("c.txt");
	});

	// 조용히 auto로 흘려보내면 사용자가 고르지 않은 기준의 diff를 보여주게 된다.
	test("refuses a base that does not exist instead of falling back", async () => {
		const res = await diff("base=no-such-branch");
		expect(res.status).toBe(400);
	});

	// Bun의 $는 셸을 이스케이프하지 git의 옵션 파싱을 막지 않는다. 첫 글자가
	// "-"인 ref가 git diff에 도달하면 --output=<path>로 임의의 파일을 만들거나
	// 비울 수 있다. refExists(rev-parse --verify)가 옵션 꼴을 거부하는 것이
	// 그 통로를 닫는다.
	test("refuses an option-shaped base and writes nothing", async () => {
		const victim = join(cacheHome, "pwned.txt");
		const res = await diff(`base=${encodeURIComponent(`--output=${victim}`)}`);
		expect(res.status).toBe(400);
		expect(existsSync(victim)).toBe(false);
	});

	test("base=HEAD shows the same files as the default working view", async () => {
		const withHead = await diff("base=HEAD");
		const plain = await diff("untracked=0");
		expect(await withHead.json()).toEqual(await plain.json());
	});
});

// 커밋이 하나도 없는 리포(unborn HEAD)는 diffdeck을 새 프로젝트에서 처음
// 켜는 경로다. e2e 픽스처는 항상 base 커밋을 만들므로 이 상태를 원리적으로
// 만들 수 없어, 여기서 지킨다.
describe("diff server unborn HEAD", () => {
	let unborn: string;

	beforeEach(async () => {
		unborn = mkdtempSync(join(tmpdir(), "cc-srv-unborn-"));
		await $`git -C ${unborn} init -q`;
		await $`git -C ${unborn} config user.email t@t.co`;
		await $`git -C ${unborn} config user.name test`;
		writeFileSync(join(unborn, "a.txt"), "first file, never committed\n");
	});

	afterEach(() => rmSync(unborn, { recursive: true, force: true }));

	// 피커의 "Working tree" 행이 보내는 값이다. rev-parse --verify HEAD가
	// unborn에서 실패하므로, 검증을 그대로 태우면 첫 화면이 실패 카드가 된다.
	test("base=HEAD serves the working tree instead of refusing", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(unborn)}&token=${token}&untracked=1&base=HEAD`,
		);
		expect(res.status).toBe(200);
		const files = (await res.json()) as Array<{ name: string }>;
		expect(files.map((f) => f.name)).toContain("a.txt");
	});

	// 레거시 wire가 내던 것과 같은 결과여야 한다 — 옛 링크와 새 기본값이
	// 같은 화면을 보는 것이 이 값의 존재 이유다.
	test("base=HEAD matches what the legacy mode=working wire returned", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const q = `repo=${encodeURIComponent(unborn)}&token=${token}&untracked=1`;
		const viaBase = await fetch(`${base}/api/diff?${q}&base=HEAD`);
		const viaMode = await fetch(`${base}/api/diff?${q}&mode=working`);
		expect(await viaBase.json()).toEqual(await viaMode.json());
	});
});
