import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDiffServer } from "../server/server.ts";

// build.ts를 한 번 돌려 실제 dist를 만든 뒤, 그 dist를 viewerDir로 서빙한다.
let handle: ReturnType<typeof startDiffServer>;
let base: string;
let cacheHome: string;
const distDir = join(import.meta.dir, "..", "dist", "viewer");

beforeAll(async () => {
	const proc = Bun.spawn(
		["bun", "run", join(import.meta.dir, "..", "build.ts")],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
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
