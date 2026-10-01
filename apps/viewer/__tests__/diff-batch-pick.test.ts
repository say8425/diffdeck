import { expect, test } from "bun:test";
import { pickForBatch } from "../server/diff.ts";

// 큰 blob까지 배치에 담으면 diff의 모든 blob이 한 버퍼에 올라 메모리 상한이 사라진다(server.md).
const limits = { maxBlob: 100, maxTotal: 250 };

test("keeps blobs at or under the per-blob limit, in request order", () => {
	const sizes = new Map([
		["a", 100],
		["b", 101],
		["c", 0],
	]);
	expect(pickForBatch(["a", "b", "c"], sizes, limits)).toEqual(["a", "c"]);
});

test("stops adding once the running total would pass the total limit", () => {
	const sizes = new Map([
		["a", 100],
		["b", 100],
		["c", 100],
		["d", 10],
	]);
	expect(pickForBatch(["a", "b", "c", "d"], sizes, limits)).toEqual([
		"a",
		"b",
		"d",
	]);
});

test("leaves out objects whose size is unknown", () => {
	expect(pickForBatch(["gone"], new Map(), limits)).toEqual([]);
});
