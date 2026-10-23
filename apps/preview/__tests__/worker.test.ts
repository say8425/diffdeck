import { describe, expect, test } from "bun:test";
import { type SnapshotManifest, snapshotKey } from "../snapshot.ts";
import worker, { type Env } from "../worker.ts";

const ORIGIN = "https://pr-1-diffdeck-preview.example.workers.dev";

const MANIFEST: SnapshotManifest = {
	repo: "/home/runner/work/diffdeck/diffdeck",
	base: "@auto",
	entries: {
		"/api/ping": {
			status: 204,
			headers: { "x-diffdeck": "1", "x-diffdeck-version": "1.7.1" },
			file: null,
		},
		"/api/diff": {
			status: 200,
			headers: {
				"content-type": "application/json; charset=utf-8",
				etag: '"abc"',
				"x-diff-base": "main",
			},
			file: "4.bin",
		},
		"/api/summary": {
			status: 200,
			headers: { "content-type": "application/json; charset=utf-8" },
			file: "3.bin",
		},
		"/api/blob:new:img/a.png": {
			status: 200,
			headers: { "content-type": "image/png" },
			file: "5.bin",
		},
	},
};

const fakeEnv = (files: Record<string, string>): Env & { seen: string[] } => {
	const seen: string[] = [];
	return {
		seen,
		ASSETS: {
			fetch: (request: Request) => {
				const { pathname } = new URL(request.url);
				seen.push(pathname);
				if (pathname === "/_snapshot/manifest.json") {
					return Promise.resolve(Response.json(MANIFEST));
				}
				const body = files[pathname];
				return Promise.resolve(
					body === undefined
						? new Response("asset not found", { status: 404 })
						: new Response(body),
				);
			},
		},
	};
};

const call = (path: string, env: Env, init?: RequestInit) =>
	worker.fetch(new Request(`${ORIGIN}${path}`, init), env);

describe("snapshotKey", () => {
	test("drops repo, token, base, and untracked from API routes", () => {
		expect(
			snapshotKey(
				new URL(`${ORIGIN}/api/diff?repo=/r&token=t&base=main&untracked=1`),
			),
		).toBe("/api/diff");
	});
	test("keys a blob by side and path, defaulting to the new side", () => {
		expect(
			snapshotKey(new URL(`${ORIGIN}/api/blob?path=a.png&side=old&v=9`)),
		).toBe("/api/blob:old:a.png");
		expect(snapshotKey(new URL(`${ORIGIN}/api/blob?path=a.png`))).toBe(
			"/api/blob:new:a.png",
		);
	});
	test("has no key for a blob without a path or an unknown route", () => {
		expect(snapshotKey(new URL(`${ORIGIN}/api/blob`))).toBeNull();
		expect(snapshotKey(new URL(`${ORIGIN}/api/nope`))).toBeNull();
	});
});

describe("preview worker", () => {
	test("sends a bare visit to the viewer URL for the recorded repo and base", async () => {
		const res = await call("/", fakeEnv({}));
		expect(res.status).toBe(302);
		const to = new URL(res.headers.get("location") ?? "");
		expect(to.origin).toBe(ORIGIN);
		expect(to.searchParams.get("repo")).toBe(MANIFEST.repo);
		expect(to.searchParams.get("base")).toBe("@auto");
		expect(to.searchParams.get("token")).toBe("preview");
	});

	test("serves static assets, including the viewer page once it has a repo", async () => {
		const env = fakeEnv({ "/": "<html>", "/main.js": "js" });
		expect(await (await call("/main.js", env)).text()).toBe("js");
		const page = await call(`/?repo=${encodeURIComponent(MANIFEST.repo)}`, env);
		expect(page.status).toBe(200);
		expect(await page.text()).toBe("<html>");
	});

	test("replays a recorded response with its headers and body", async () => {
		const res = await call(
			"/api/diff?repo=/r&token=preview&base=@auto&untracked=0",
			fakeEnv({ "/_snapshot/4.bin": "[]" }),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("etag")).toBe('"abc"');
		expect(res.headers.get("x-diff-base")).toBe("main");
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.text()).toBe("[]");
	});

	test("answers a matching if-none-match with 304 and keeps the base header", async () => {
		const env = fakeEnv({});
		const res = await call("/api/diff?base=@auto", env, {
			headers: { "if-none-match": '"abc"' },
		});
		expect(res.status).toBe(304);
		expect(res.headers.get("etag")).toBe('"abc"');
		expect(res.headers.get("x-diff-base")).toBe("main");
		expect(env.seen).not.toContain("/_snapshot/4.bin");
	});

	test("a 304 for an entry without a base header carries only the etag", async () => {
		const env = fakeEnv({});
		const original = MANIFEST.entries["/api/diff"].headers;
		MANIFEST.entries["/api/diff"].headers = { etag: '"abc"' };
		try {
			const res = await call("/api/diff", env, {
				headers: { "if-none-match": '"abc"' },
			});
			expect(res.status).toBe(304);
			expect(res.headers.has("x-diff-base")).toBe(false);
		} finally {
			MANIFEST.entries["/api/diff"].headers = original;
		}
	});

	test("replays a bodiless entry without reading a file", async () => {
		const env = fakeEnv({});
		const res = await call("/api/ping", env);
		expect(res.status).toBe(204);
		expect(res.headers.get("x-diffdeck-version")).toBe("1.7.1");
		expect(env.seen).toEqual(["/_snapshot/manifest.json"]);
	});

	test("replays an image blob by side and path", async () => {
		const res = await call(
			"/api/blob?path=img%2Fa.png&side=new&mode=base&v=1",
			fakeEnv({ "/_snapshot/5.bin": "png" }),
		);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(await res.text()).toBe("png");
	});

	test("refuses a picked head the way the server refuses an unknown one", async () => {
		const env = fakeEnv({});
		const res = await call("/api/diff?head=feat-x", env);
		expect(res.status).toBe(400);
		expect(res.headers.get("x-diff-error")).toBe("unknown-head");
		expect(env.seen).toEqual([]);
	});

	test("404s an API request the snapshot did not record", async () => {
		const env = fakeEnv({});
		expect((await call("/api/blob?path=b.png", env)).status).toBe(404);
		expect((await call("/api/refs", env)).status).toBe(404);
		expect((await call("/api/nope", env)).status).toBe(404);
	});

	test("fails loudly when the manifest is missing", async () => {
		const env: Env = {
			ASSETS: {
				fetch: () => Promise.resolve(new Response("no", { status: 404 })),
			},
		};
		const error = await call("/", env).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("snapshot manifest: 404");
	});
});
