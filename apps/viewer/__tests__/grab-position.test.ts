import { describe, expect, test } from "bun:test";
import { computePlacement } from "../browser/grab/position.ts";

const vp = { width: 1000, height: 600 };
const size = { width: 300, height: 40 };

describe("computePlacement", () => {
	test("기본: 앵커 아래 + 6px", () => {
		expect(
			computePlacement({ left: 100, top: 200, bottom: 220 }, size, vp),
		).toEqual({
			left: 100,
			top: 226,
		});
	});
	test("하단 넘침 → 앵커 위로 플립", () => {
		expect(
			computePlacement({ left: 100, top: 560, bottom: 580 }, size, vp),
		).toEqual({
			left: 100,
			top: 560 - 40 - 6,
		});
	});
	test("좌측/우측 클램프", () => {
		expect(
			computePlacement({ left: -50, top: 10, bottom: 20 }, size, vp).left,
		).toBe(8);
		expect(
			computePlacement({ left: 900, top: 10, bottom: 20 }, size, vp).left,
		).toBe(1000 - 300 - 8);
	});
	test("플립해도 상단 넘침 → 8px로 클램프", () => {
		expect(
			computePlacement(
				{ left: 0, top: 10, bottom: 590 },
				{ width: 300, height: 500 },
				vp,
			).top,
		).toBe(8);
	});
});
