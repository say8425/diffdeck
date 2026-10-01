import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	setSystemTime,
	test,
} from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import packageJson from "../package.json";
import { createBlobCache } from "../server/blobCache.ts";
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
	test("rebuilds after an edit reuse cached blobs", async () => {
		const blobCache = createBlobCache();
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			blobCache,
		});
		try {
			const url = `http://127.0.0.1:${h.server.port}/api/diff?repo=${encodeURIComponent(repo)}&token=${h.token}`;
			expect((await fetch(url)).status).toBe(200);
			// 크기가 바뀌어 지문이 달라진다 → 재빌드
			writeFileSync(join(repo, "a.txt"), "three\n");
			expect((await fetch(url)).status).toBe(200);
			expect(blobCache.stats().hits).toBe(1);
		} finally {
			h.stop();
		}
	});

	test("base-mode rebuilds after an edit reuse cached blobs too", async () => {
		// base 모드는 서버에서 별도의 getDiffFiles 호출이라 따로 찌른다. 없는 ref는 400이라 브랜치를 세운다.
		await $`git -C ${repo} branch basepoint`;
		const blobCache = createBlobCache();
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			blobCache,
		});
		try {
			const url = `http://127.0.0.1:${h.server.port}/api/diff?repo=${encodeURIComponent(repo)}&token=${h.token}&base=basepoint`;
			expect((await fetch(url)).status).toBe(200);
			writeFileSync(join(repo, "a.txt"), "three\n");
			expect((await fetch(url)).status).toBe(200);
			expect(blobCache.stats().hits).toBe(1);
		} finally {
			h.stop();
		}
	});

	test("ping returns 204 with marker header", async () => {
		const res = await fetch(`${base}/api/ping`);
		expect(res.status).toBe(204);
		expect(res.headers.get("x-diffdeck")).toBe("1");
	});

	// A long-lived daemon outlives its package; clients (cc-statusline) compare the version and use the pid to replace a stale one.
	test("ping reports the running version and pid so a client can spot a stale daemon", async () => {
		const res = await fetch(`${base}/api/ping`);
		expect(res.headers.get("x-diffdeck-version")).toBe(packageJson.version);
		expect(res.headers.get("x-diffdeck-pid")).toBe(String(process.pid));
	});

	// Clients read the token file to decide a daemon is usable; nothing else here would notice it missing.
	test("publishes the token once the port is really ours", () => {
		expect(readTokenSync({ XDG_CACHE_HOME: cacheHome })).toBe(handle.token);
	});

	// Keeps an open viewer tab working across a daemon restart.
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

	// A token left by a spawn that died on EADDRINUSE would make clients link to whoever owns the port (403).
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
		// 304에도 x-diff-base를 싣는다 — 클라이언트가 grab 참조에 쓰는 base 이름을 유지한다.
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
		// fetch() collapses "/../" client-side, so the test above never reaches the 403 branch. A raw "//etc/passwd"
		// survives URL parsing and makes path.resolve escape viewerRoot, exercising the real traversal guard.
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

	// 커버리지 게이트는 branch를 세지 않으므로 분기 양쪽을 각각 찌른다.
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

	// 이 경로가 없으면 REAL_CWD_DEPS가 한 번도 불리지 않아 함수 커버리지가 떨어진다 — 경로를 실행하는 것이 목적이다.
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

	// cwdDeps가 "죽었다"고 답하게 해 두고도 exists가 안 불려야 탐지를 통째로 건너뛴 것이다.
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
		// .png라 이미지 게이트를 통과하고 repo 밖에 실재하는 파일이라, 탈출 가드가 사라지면 실제로 읽혀 200이 된다.
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
	// baseCache 미스에 기댄다 — 최상단 beforeEach가 테스트마다 새 repo 경로를 만들기 때문이다. repo를 beforeAll로
	// 끌어올리면 앞선 /api/diff 테스트가 캐시를 데워, 이 테스트는 조용히 diffFlight 가드만 증명한다.
	// 아래 테스트는 반대로 히트에 기대므로 둘을 공용 픽스처로 합치지 않는다(server.md).
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

	// 위 테스트는 baseFlight 가드만 증명한다. baseCache는 모듈 스코프라 기본 서버로 먼저 데우면 새 서버도 히트하고,
	// 히트는 마이크로태스크로 settle해 1ms 타이머보다 결정적으로 먼저 끝난다 — 그래야 diffFlight(지문의 git 왕복)가
	// 진짜로 타임아웃한다. baseCache를 createHandler 안으로 옮기면 이 테스트는 조용히 위와 같은 가드만 증명한다.
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

// HTTP 헤더 값은 latin1이라 비ASCII base 이름을 그대로 실으면 Response 생성이 throw해 응답 전체가 500이 된다.
describe("diff server non-latin1 base name", () => {
	// 원격 없이 origin/HEAD → origin/<한글> 참조만 세워 hermetic하게 만든다(resolveBaseRef가 이걸 읽는다).
	// refname은 ${보간}으로 넘긴다 — Bun `$`에 비ASCII를 리터럴로 적으면 뭉개져 한글이 아닌 브랜치로 조용히 통과한다(testing.md).
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

describe("diff server prs route", () => {
	const PRS = {
		"feat/x": {
			number: 7,
			title: "feat: x",
			state: "open",
			url: "https://github.com/o/r/pull/7",
		},
	} as const;

	test("rejects a request without the token", async () => {
		const res = await fetch(`${base}/api/prs?repo=${encodeURIComponent(repo)}`);
		expect(res.status).toBe(403);
	});

	test("rejects a path that is not a git repository", async () => {
		const res = await fetch(
			`${base}/api/prs?repo=${encodeURIComponent(viewerDir)}&token=${handle.token}`,
		);
		expect(res.status).toBe(400);
	});

	// GH_REPO가 있으면 gh가 픽스처의 원격 부재를 무시하고 그 리포의 실제 PR을 답한다(testing.md).
	test.skipIf(Boolean(process.env.GH_REPO))(
		"without a GitHub remote the real lister answers no PRs",
		async () => {
			const res = await fetch(
				`${base}/api/prs?repo=${encodeURIComponent(repo)}&token=${handle.token}`,
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({});
		},
	);

	// 실패를 성공만큼 캐시하면 기동 순간의 끊김 한 번이 1분 동안 PR 표시를 지운다.
	test("a failed lookup is cached briefly, a successful one for a minute", async () => {
		let calls = 0;
		const listPrs = mock(() =>
			Promise.resolve((calls++ === 0 ? null : PRS) as typeof PRS | null),
		);
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			listPrs,
		});
		const url = `http://127.0.0.1:${h.server.port}/api/prs?repo=${encodeURIComponent(repo)}&token=${h.token}`;
		const t0 = Date.now();
		try {
			expect(await (await fetch(url)).json()).toEqual({});
			setSystemTime(new Date(t0 + 5_000));
			await fetch(url);
			expect(listPrs).toHaveBeenCalledTimes(1);
			setSystemTime(new Date(t0 + 11_000));
			expect(await (await fetch(url)).json()).toEqual(PRS);
			expect(listPrs).toHaveBeenCalledTimes(2);
			setSystemTime(new Date(t0 + 40_000));
			await fetch(url);
			expect(listPrs).toHaveBeenCalledTimes(2);
		} finally {
			setSystemTime();
			h.stop();
		}
	});

	// `gh`는 네트워크를 탄다 — 폴·focus·피커 열림마다 부르면 GitHub에 매번 간다.
	test("answers from the lister and caches it across requests", async () => {
		const listPrs = mock(() => Promise.resolve(PRS));
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			listPrs,
		});
		try {
			const url = `http://127.0.0.1:${h.server.port}/api/prs?repo=${encodeURIComponent(repo)}&token=${h.token}`;
			const first = await fetch(url);
			expect(first.status).toBe(200);
			expect(await first.json()).toEqual(PRS);
			expect((await fetch(url)).status).toBe(200);
			expect(listPrs).toHaveBeenCalledTimes(1);
			expect(listPrs).toHaveBeenCalledWith(repo);
		} finally {
			h.stop();
		}
	});

	test("a lister that never settles answers 503 instead of hanging", async () => {
		const h = startDiffServer({
			port: 0,
			viewerDir,
			env: { XDG_CACHE_HOME: cacheHome },
			flightTimeoutMs: 1,
			listPrs: () => new Promise(() => {}),
		});
		try {
			const res = await fetch(
				`http://127.0.0.1:${h.server.port}/api/prs?repo=${encodeURIComponent(repo)}&token=${h.token}`,
			);
			expect(res.status).toBe(503);
		} finally {
			h.stop();
		}
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

	// 보안 경계: `-`로 시작하는 ref가 git diff에 닿으면 --output=<path>로 아무 파일이나 쓴다 — verifyBaseRef가 먼저 끊는다(server.md).
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

// e2e 픽스처는 늘 base 커밋을 만들어 unborn HEAD(새 프로젝트에서 처음 켠 상태)를 원리적으로 못 만든다 — 여기서 지킨다.
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

	// 기본 요청이 보내는 값이다. unborn에서는 rev-parse --verify HEAD가 실패해, 검증을 태우면 첫 화면이 실패 카드가 된다.
	test("base=HEAD serves the working tree instead of refusing", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(unborn)}&token=${token}&untracked=1&base=HEAD`,
		);
		expect(res.status).toBe(200);
		const files = (await res.json()) as Array<{ name: string }>;
		expect(files.map((f) => f.name)).toContain("a.txt");
	});

	test("base=HEAD matches what the legacy mode=working wire returned", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const q = `repo=${encodeURIComponent(unborn)}&token=${token}&untracked=1`;
		const viaBase = await fetch(`${base}/api/diff?${q}&base=HEAD`);
		const viaMode = await fetch(`${base}/api/diff?${q}&mode=working`);
		expect(await viaBase.json()).toEqual(await viaMode.json());
	});
});

// 클라이언트는 unknown-base일 때만 저장된 base를 버리므로 같은 400이라도 표식으로 종류가 갈려야 한다.
describe("diff server 400 kinds are distinguishable", () => {
	test("an unknown base ref is marked so the client can drop its preference", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${token}&base=no-such-branch`,
		);
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("unknown-base");
	});

	test("a non-repository carries its own marker, not unknown-base", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(
			`${base}/api/diff?repo=${encodeURIComponent(viewerDir)}&token=${token}&base=main`,
		);
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("not-a-repo");
	});

	// 라우트마다 판정이 갈리면 이미지·요약·피커가 diff와 다른 실패 이유를 말한다.
	test.each(["diff", "summary", "refs", "prs", "blob"])(
		"/api/%s marks a missing directory as repo-missing",
		async (route) => {
			const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
			const gone = join(viewerDir, "no-such-dir");
			const res = await fetch(
				`${base}/api/${route}?repo=${encodeURIComponent(gone)}&token=${token}&path=a.png`,
			);
			expect(res.status).toBe(400);
			expect(res.headers.get("x-diff-error")).toBe("repo-missing");
		},
	);

	test("a request without repo is marked no-repo", async () => {
		const token = readTokenSync({ XDG_CACHE_HOME: cacheHome });
		const res = await fetch(`${base}/api/diff?token=${token}`);
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("no-repo");
	});
});

describe("head selection over HTTP", () => {
	const diffUrl = (query: string): string =>
		`${base}/api/diff?repo=${encodeURIComponent(repo)}&token=${handle.token}&${query}`;

	test("views the branch's committed content, not the working tree", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feat`;
		writeFileSync(join(repo, "a.txt"), "three\n");
		await $`git -C ${repo} commit -qam feat`;
		await $`git -C ${repo} checkout -q main`;

		const res = await fetch(diffUrl("base=main&head=feat"));
		expect(res.status).toBe(200);
		const files = (await res.json()) as {
			name: string;
			newContents: string;
		}[];
		expect(files.map((f) => f.name)).toEqual(["a.txt"]);
		expect(files[0]?.newContents).toBe("three\n");
	});

	// 표식을 base와 가르는 것은 클라이언트의 복구가 다르기 때문이다. 게이트는 branch를 세지 않아 이 400 경로로 일부러 들어간다.
	test("an unknown head ref is refused with its own marker", async () => {
		const res = await fetch(diffUrl("head=no-such-branch"));
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("unknown-head");
	});

	// 보안 경계: head도 git diff의 인자로 가므로 `-`로 시작하면 --output=<path>가 된다 — verifyBaseRef가 먼저 끊는다.
	test("a head that looks like an option never reaches git", async () => {
		const res = await fetch(
			diffUrl(`head=${encodeURIComponent("--output=/tmp/diffdeck-pwned")}`),
		);
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("unknown-head");
		expect(existsSync("/tmp/diffdeck-pwned")).toBe(false);
	});

	// 라우트마다 따로 찌른다 — 게이트는 branch를 세지 않아 head 해석 호출 줄만 지나가도 초록이다.
	test("summary refuses an unknown head with the same marker", async () => {
		const res = await fetch(
			`${base}/api/summary?repo=${encodeURIComponent(repo)}&token=${handle.token}&head=no-such-branch`,
		);
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("unknown-head");
	});

	// blob은 이미지 전용이라 경로가 .png여야 head 해석까지 도달한다(아니면 그 전에 404다).
	test("blob refuses an unknown head with the same marker", async () => {
		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=logo.png&side=new&head=no-such-branch`,
		);
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("unknown-head");
	});

	// getFileBytes 유닛은 라우트가 head를 넘기는 배선까지는 보지 못한다.
	test("blob reads the new side from the head revision", async () => {
		await $`git -C ${repo} branch -M main`;
		await $`git -C ${repo} checkout -qb feat`;
		writeFileSync(join(repo, "logo.png"), "from the branch\n");
		await $`git -C ${repo} add logo.png`;
		await $`git -C ${repo} commit -qm feat`;
		await $`git -C ${repo} checkout -q main`;
		writeFileSync(join(repo, "logo.png"), "uncommitted\n");

		const res = await fetch(
			`${base}/api/blob?repo=${encodeURIComponent(repo)}&token=${handle.token}&path=logo.png&side=new&base=main&head=feat`,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("from the branch\n");
	});
});
