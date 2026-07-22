import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
