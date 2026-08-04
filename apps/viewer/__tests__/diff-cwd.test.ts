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

	// 이 계약이 이 모듈의 존재 이유다. existsSync(".")/statSync(".")는
	// 디렉토리가 unlink돼도 프로세스가 쥔 cwd 파일 디스크립터가 inode를
	// 살려두므로 둘 다 true를 반환한다(실측) — 오염을 원리적으로 못 잡는다.
	// 반드시 process.cwd()가 주는 "스테일 경로 문자열"을 검사해야 한다.
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
	// 홈·캐시·temp는 전부 사용자가 지울 수 있어 재오염이 가능하다.
	// 루트만 unlink가 원천 불가하다.
	test("파일시스템 루트다", () => {
		expect(SAFE_CWD).toBe("/");
	});
});
