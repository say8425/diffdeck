import { expect, test } from "bun:test";
import { pickForBatch } from "../server/diff.ts";

/**
 * 어떤 blob을 `cat-file --batch`로 미리 읽을지. 배치가 아끼는 것은 프로세스 생성
 * 비용이라 작은 blob에서만 이득이고, 큰 blob까지 담으면 빌드 동안 diff의 모든
 * blob이 한 버퍼에 올라 메모리 상한이 사라진다(리뷰 실측: 25MB × 20에서 최대
 * 메모리 1GB → 3GB, 시간도 250 → 500ms). 잡는 깨짐: 크기 상한을 무시하는 선택,
 * 합계 상한을 무시하는 선택, 크기를 모르는(= 없는) 객체를 배치에 넣는 선택.
 */

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
	// a+b = 200, c would make 300 > 250 → skipped; d fits (210)
	expect(pickForBatch(["a", "b", "c", "d"], sizes, limits)).toEqual([
		"a",
		"b",
		"d",
	]);
});

test("leaves out objects whose size is unknown", () => {
	expect(pickForBatch(["gone"], new Map(), limits)).toEqual([]);
});
