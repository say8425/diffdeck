import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getPrs,
	type GhRunner,
	PR_LIST_LIMIT,
	parsePrList,
	readOriginUrl,
	remoteOwner,
	runGh,
} from "../server/prs.ts";

const pr = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
	number: 1,
	title: "feat: one",
	headRefName: "feat/one",
	state: "OPEN",
	isDraft: false,
	url: "https://github.com/o/r/pull/1",
	isCrossRepository: false,
	...over,
});

const parse = (list: unknown[]): ReturnType<typeof parsePrList> =>
	parsePrList(JSON.stringify(list));

describe("parsePrList", () => {
	test("maps each GitHub state to one of four", () => {
		const out = parse([
			pr({ number: 1, headRefName: "a" }),
			pr({ number: 2, headRefName: "b", isDraft: true }),
			pr({ number: 3, headRefName: "c", state: "MERGED" }),
			pr({ number: 4, headRefName: "d", state: "CLOSED" }),
		]);
		expect(out.a?.state).toBe("open");
		expect(out.b?.state).toBe("draft");
		expect(out.c?.state).toBe("merged");
		expect(out.d?.state).toBe("closed");
	});

	test("keeps only the fields the viewer shows", () => {
		expect(parse([pr()])["feat/one"]).toEqual({
			number: 1,
			title: "feat: one",
			state: "open",
			url: "https://github.com/o/r/pull/1",
		});
	});

	// 닫고 다시 올린 브랜치: 목록은 최신순이라 새 PR이 먼저 오지만, 순서가
	// 뒤집혀도 열린 PR이 이겨야 한다.
	test("an open PR beats a finished one on the same branch, in either order", () => {
		const closedFirst = parse([
			pr({ number: 9, state: "CLOSED" }),
			pr({ number: 8 }),
		]);
		expect(closedFirst["feat/one"]?.number).toBe(8);
		const openFirst = parse([
			pr({ number: 8 }),
			pr({ number: 9, state: "CLOSED" }),
		]);
		expect(openFirst["feat/one"]?.number).toBe(8);
	});

	test("between two finished PRs the most recent (first listed) wins", () => {
		const out = parse([
			pr({ number: 5, state: "MERGED" }),
			pr({ number: 3, state: "CLOSED" }),
		]);
		expect(out["feat/one"]?.number).toBe(5);
	});

	test("between two open PRs the first listed wins", () => {
		const out = parse([pr({ number: 5 }), pr({ number: 3, isDraft: true })]);
		expect(out["feat/one"]?.number).toBe(5);
	});

	// 포크의 `main`에서 올린 PR이 우리 `main` 행에 붙으면 안 된다.
	test("skips PRs from someone else's fork", () => {
		const fork = pr({
			headRefName: "main",
			isCrossRepository: true,
			headRepositoryOwner: { login: "stranger" },
		});
		expect(parsePrList(JSON.stringify([fork])).main).toBeUndefined();
		expect(parsePrList(JSON.stringify([fork]), "me").main).toBeUndefined();
	});

	// 포크 워크플로에서는 내 PR이 전부 cross-repository로 온다 — 빼면 그
	// 사용자에게는 PR 표시가 통째로 사라진다.
	test("keeps PRs from my own fork (origin's owner)", () => {
		const mine = pr({
			isCrossRepository: true,
			headRepositoryOwner: { login: "me" },
		});
		expect(parsePrList(JSON.stringify([mine]), "me")["feat/one"]?.number).toBe(
			1,
		);
	});

	test("a cross-repo PR without a readable owner is skipped", () => {
		for (const headRepositoryOwner of [undefined, null, "me", { login: 1 }]) {
			const odd = pr({ isCrossRepository: true, headRepositoryOwner });
			expect(
				parsePrList(JSON.stringify([odd]), "me")["feat/one"],
			).toBeUndefined();
		}
	});

	test("skips entries it cannot read", () => {
		const out = parse([
			null,
			"x",
			pr({ state: "WEIRD" }),
			pr({ number: "1" }),
			pr({ title: 1 }),
			pr({ headRefName: null }),
			pr({ url: undefined }),
		]);
		expect(Object.keys(out)).toEqual([]);
	});

	test("returns nothing for output that is not a JSON array", () => {
		expect(Object.keys(parsePrList(""))).toEqual([]);
		expect(Object.keys(parsePrList("not json"))).toEqual([]);
		expect(Object.keys(parsePrList('{"a":1}'))).toEqual([]);
	});

	// 브랜치 이름은 사용자가 정한다 — 프로토타입 키도 평범한 이름이어야 한다.
	test("a branch named like a prototype key is an ordinary entry", () => {
		const out = parse([
			pr({ headRefName: "__proto__", number: 2 }),
			pr({ headRefName: "constructor", number: 3 }),
		]);
		expect(Object.hasOwn(out, "__proto__")).toBe(true);
		// 타입상 `out.constructor`는 Function이라 문자열 키로 읽는다.
		const name: string = "constructor";
		expect(out[name]?.number).toBe(3);
		expect(JSON.parse(JSON.stringify(out)).constructor.number).toBe(3);
	});
});

describe("remoteOwner", () => {
	test.each([
		["git@github.com:acme/api.git", "acme"],
		["https://github.com/acme/api", "acme"],
		["https://github.com/acme/api.git/", "acme"],
		["ssh://git@ghe.corp.example/acme/api.git", "acme"],
		["  https://github.com/acme/api.git\n", "acme"],
	])("%s → %s", (url, owner) => {
		expect(remoteOwner(url)).toBe(owner);
	});

	test("no owner in an empty or bare URL", () => {
		expect(remoteOwner("")).toBeNull();
		expect(remoteOwner("api")).toBeNull();
	});
});

describe("getPrs", () => {
	const noOrigin = (): Promise<string> => Promise.resolve("");

	test("asks gh for recent PRs of every state in one call", async () => {
		const calls: Array<{ repo: string; args: readonly string[] }> = [];
		const run: GhRunner = (repo, args) => {
			calls.push({ repo, args });
			return Promise.resolve(JSON.stringify([pr()]));
		};
		const out = await getPrs("/r", run, noOrigin);
		expect(out?.["feat/one"]?.number).toBe(1);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.repo).toBe("/r");
		expect(calls[0]?.args.slice(0, 6)).toEqual([
			"pr",
			"list",
			"--state",
			"all",
			"--limit",
			String(PR_LIST_LIMIT),
		]);
		expect(calls[0]?.args.at(-1)).toContain("isCrossRepository");
		expect(calls[0]?.args.at(-1)).toContain("headRepositoryOwner");
	});

	test("keeps my fork's PRs by reading origin's owner", async () => {
		const run: GhRunner = () =>
			Promise.resolve(
				JSON.stringify([
					pr({ isCrossRepository: true, headRepositoryOwner: { login: "me" } }),
				]),
			);
		const out = await getPrs("/r", run, () =>
			Promise.resolve("git@github.com:me/api.git\n"),
		);
		expect(out?.["feat/one"]?.number).toBe(1);
	});

	// "PR 없음"과 "못 받음"을 가른다 — 서버가 실패를 짧게만 캐시하는 근거.
	test("a failed gh is null, not an empty map", async () => {
		expect(
			await getPrs("/r", () => Promise.resolve(null), noOrigin),
		).toBeNull();
	});

	test("reads origin with git", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dd-prs-origin-"));
		try {
			execFileSync("git", ["-C", dir, "init", "-q"]);
			execFileSync("git", [
				"-C",
				dir,
				"remote",
				"add",
				"origin",
				"git@github.com:acme/api.git",
			]);
			expect((await readOriginUrl(dir)).trim()).toBe(
				"git@github.com:acme/api.git",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("runGh", () => {
	// gh가 실패로 끝나면(여기선 git 리포가 아닌 곳) 출력을 믿지 않는다.
	// gh가 설치돼 있지 않은 환경에서도 스폰이 던져 같은 빈 결과가 된다.
	test("a failing gh yields null", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dd-prs-"));
		try {
			expect(await runGh(dir, ["pr", "list"])).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a spawn that throws yields null", async () => {
		expect(
			await runGh(join(tmpdir(), "dd-no-such-dir-xyz"), ["--version"]),
		).toBeNull();
	});

	test("a gh that succeeds yields its stdout", async () => {
		// `gh --version`은 인증도 리포도 필요 없다. gh가 없는 환경이면 null이라
		// 이 단언만 건너뛴다(스폰 실패 경로는 바로 위 테스트가 덮는다).
		const out = await runGh(tmpdir(), ["--version"]);
		if (out !== null) expect(out).toContain("gh version");
	});

	test("real getPrs never throws", async () => {
		const dir = mkdtempSync(join(tmpdir(), "dd-prs-"));
		try {
			expect(await getPrs(dir)).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
