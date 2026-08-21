import { describe, expect, test } from "bun:test";
import { buildBaseRows, filterBaseRows } from "../browser/refPicker/model.ts";
import type { RefRecord } from "../server/refs.ts";

const ref = (name: string, kind: "local" | "remote" = "local"): RefRecord => ({
	name,
	kind,
	worktreePath: null,
});

describe("buildBaseRows", () => {
	test("offers the working tree first, before any branch", () => {
		const rows = buildBaseRows([ref("main")], null, null);
		expect(rows[0]).toEqual({
			value: "HEAD",
			label: "Working tree",
			kind: "working",
			section: "uncommitted",
			tag: null,
			note: null,
		});
	});

	// merge-base(HEAD, HEAD) === HEAD라서 이 값이 오늘의 워킹트리 뷰와 같다.
	test("the working tree row carries HEAD as its wire value", () => {
		expect(buildBaseRows([], null, null)[0]?.value).toBe("HEAD");
	});

	test("keeps local branches ahead of remote ones", () => {
		const rows = buildBaseRows(
			[ref("origin/main", "remote"), ref("develop"), ref("main")],
			null,
			null,
		);
		expect(rows.slice(1).map((r) => r.kind)).toEqual([
			"local",
			"local",
			"remote",
		]);
	});

	test("tags the default branch so the usual choice is findable", () => {
		const rows = buildBaseRows([ref("main"), ref("develop")], "main", null);
		expect(rows.find((r) => r.value === "main")?.tag).toBe("default");
		expect(rows.find((r) => r.value === "develop")?.tag).toBeNull();
	});

	// 자기 자신과 견주면 언제나 비어 보인다. 막지는 않되 왜 그런지 읽히도록
	// 표시한다 — 조용한 빈 화면이 이 기능에서 가장 큰 위험이다.
	test("marks the branch this worktree has checked out", () => {
		const rows = buildBaseRows(
			[ref("main"), ref("feature")],
			"main",
			"feature",
		);
		expect(rows.find((r) => r.value === "feature")?.tag).toBe("HEAD");
	});

	test("prefers the default tag when a branch is both default and checked out", () => {
		const rows = buildBaseRows([ref("main")], "main", "main");
		expect(rows.find((r) => r.value === "main")?.tag).toBe("default");
	});
});

describe("filterBaseRows", () => {
	const rows = buildBaseRows(
		[ref("main"), ref("feat/grab-popover"), ref("origin/main", "remote")],
		"main",
		null,
	);

	test("an empty query keeps every row", () => {
		expect(filterBaseRows(rows, "")).toHaveLength(rows.length);
	});

	test("matches anywhere in the name, not just the start", () => {
		expect(filterBaseRows(rows, "grab").map((r) => r.value)).toEqual([
			"feat/grab-popover",
		]);
	});

	test("ignores case so typing is cheap", () => {
		expect(filterBaseRows(rows, "GRAB")).toHaveLength(1);
	});

	test("keeps the working tree row reachable by name", () => {
		expect(filterBaseRows(rows, "work").map((r) => r.kind)).toEqual([
			"working",
		]);
	});

	test("returns nothing when the query matches nothing", () => {
		expect(filterBaseRows(rows, "zzz")).toEqual([]);
	});

	test("trims surrounding whitespace before matching", () => {
		expect(filterBaseRows(rows, "  grab  ")).toHaveLength(1);
	});
});

describe("buildBaseRows sections", () => {
	test("puts the working tree in its own section, branches in another", () => {
		const rows = buildBaseRows([ref("main"), ref("o/m", "remote")], null, null);
		expect(rows.map((r) => r.section)).toEqual([
			"uncommitted",
			"branches",
			"branches",
		]);
	});
});

describe("buildBaseRows notes", () => {
	// 목록에서 미리 보여야 "골랐더니 비어 있더라"가 안 생긴다.
	test("says the working tree is empty before you pick it", () => {
		const rows = buildBaseRows([], null, null, { working: 0, base: null });
		expect(rows[0]?.note).toBe("nothing yet");
	});

	test("counts uncommitted files when there are some", () => {
		const rows = buildBaseRows([], null, null, { working: 3, base: null });
		expect(rows[0]?.note).toBe("3 file(s)");
	});

	test("says nothing when the count is unknown", () => {
		expect(buildBaseRows([], null, null)[0]?.note).toBeNull();
	});

	// 개수는 공짜인 자리에만 붙는다 — 서버가 이미 아는 그 비교 하나다.
	// 브랜치마다 붙이려면 브랜치당 git 호출이 하나씩 더 든다.
	test("attaches the known count only to the branch it was measured against", () => {
		const rows = buildBaseRows([ref("main"), ref("develop")], "main", null, {
			working: 0,
			base: { name: "main", files: 30 },
		});
		expect(rows.find((r) => r.value === "main")?.note).toBe(
			"default · 30 file(s)",
		);
		expect(rows.find((r) => r.value === "develop")?.note).toBeNull();
	});

	test("keeps the HEAD tag when no count is known for that branch", () => {
		const rows = buildBaseRows([ref("feature")], null, "feature", {
			working: 0,
			base: { name: "main", files: 30 },
		});
		expect(rows.find((r) => r.value === "feature")?.note).toBe("HEAD");
	});
});
