import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDiffServer } from "../server/server.ts";

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
		expect(body.length).toBeGreaterThan(10_000);
		expect(body).toContain("tree");
	});

	// 폰트 파일이 빠지면 화면이 에러 없이 시스템 폰트로 떨어진다.
	test("every font the page asks for is served as font/woff2", async () => {
		const html = await (await fetch(`${base}/`)).text();
		const urls = [...html.matchAll(/url\("(fonts\/[^"]+)"\)/g)].map(
			(m) => m[1],
		);
		// Pretendard · JetBrains Mono 정체·이탤릭 · D2Coding
		expect(new Set(urls).size).toBe(4);
		for (const u of new Set(urls)) {
			const res = await fetch(`${base}/${u}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("font/woff2");
			expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(10_000);
		}
	});

	// OFL은 폰트를 배포할 때 라이선스 원문을 함께 싣도록 요구한다.
	test("each bundled font ships with its license", async () => {
		for (const name of ["Pretendard", "JetBrainsMono", "D2Coding"]) {
			const res = await fetch(`${base}/fonts/OFL-${name}.txt`);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain("SIL OPEN FONT LICENSE");
		}
	});

	test("GET /missing.js returns 404", async () => {
		const res = await fetch(`${base}/missing.js`);
		expect(res.status).toBe(404);
	});
});
