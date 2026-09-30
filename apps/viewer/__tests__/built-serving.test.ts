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

	// index.html의 @font-face가 가리키는 파일이 빌드 산출물에 전부 있어야 한다.
	// 빠지면 화면은 조용히 시스템 폰트로 떨어져 유닛·e2e 어느 쪽도 깨지지 않을
	// 수 있다(e2e fonts 스펙은 실제 로드까지 보지만 여기가 더 싸고 직접적이다).
	test("every font the page asks for is served as font/woff2", async () => {
		const html = await (await fetch(`${base}/`)).text();
		const urls = [...html.matchAll(/url\("(fonts\/[^"]+)"\)/g)].map(
			(m) => m[1],
		);
		expect(urls.length).toBeGreaterThanOrEqual(6);
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
