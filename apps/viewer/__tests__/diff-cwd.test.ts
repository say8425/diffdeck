import { describe, expect, test } from "bun:test";
import { isCwdAlive, SAFE_CWD } from "../server/cwd.ts";

describe("isCwdAlive", () => {
	test("살아있는 cwd 경로에 true", () => {
		expect(
			isCwdAlive({ cwd: () => "/live", exists: (p) => p === "/live" }),
		).toBe(true);
	});

	test("삭제된 cwd 경로에 false", () => {
		expect(isCwdAlive({ cwd: () => "/gone", exists: () => false })).toBe(false);
	});

	// existsSync(".")·statSync(".")는 열린 cwd 디스크립터 때문에 디렉토리가 지워져도 true다(server.md).
	test('"." 이 아니라 해석된 cwd 경로를 검사한다', () => {
		const seen: string[] = [];
		isCwdAlive({
			cwd: () => "/x",
			exists: (p) => {
				seen.push(p);
				return true;
			},
		});
		expect(seen).toEqual(["/x"]);
	});

	// 커버리지 게이트가 branch를 세지 않으므로 이 분기를 일부러 찌른다.
	test("cwd()가 throw하면 죽은 것으로 판정한다", () => {
		expect(
			isCwdAlive({
				cwd: () => {
					throw new Error("ENOENT: uv_cwd");
				},
				exists: () => true,
			}),
		).toBe(false);
	});
});

describe("SAFE_CWD", () => {
	// 홈·캐시·temp는 사용자가 지울 수 있다. 루트만 지워질 수 없다.
	test("파일시스템 루트다", () => {
		expect(SAFE_CWD).toBe("/");
	});
});
