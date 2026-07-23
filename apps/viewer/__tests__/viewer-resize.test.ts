import { describe, expect, test } from "bun:test";
import {
	computeDragWidth,
	computeKeyboardWidth,
	KEYBOARD_STEP,
} from "../browser/resize.ts";

describe("computeDragWidth", () => {
	test("left-side tree grows when dragged right", () => {
		expect(computeDragWidth(300, 100, 180, "left")).toBe(380);
	});
	test("left-side tree shrinks when dragged left", () => {
		expect(computeDragWidth(300, 180, 100, "left")).toBe(220);
	});
	test("right-side tree grows when dragged left (mirrored)", () => {
		expect(computeDragWidth(300, 180, 100, "right")).toBe(380);
	});
	test("right-side tree shrinks when dragged right (mirrored)", () => {
		expect(computeDragWidth(300, 100, 180, "right")).toBe(220);
	});
	test("clamps to the minimum", () => {
		expect(computeDragWidth(200, 500, 0, "left")).toBe(180);
	});
	test("clamps to the maximum", () => {
		expect(computeDragWidth(580, 0, 500, "left")).toBe(600);
	});
});

describe("computeKeyboardWidth", () => {
	test(`steps by ${KEYBOARD_STEP}px`, () => {
		expect(computeKeyboardWidth(300, 1)).toBe(300 + KEYBOARD_STEP);
		expect(computeKeyboardWidth(300, -1)).toBe(300 - KEYBOARD_STEP);
	});
	test("clamps at the minimum", () => {
		expect(computeKeyboardWidth(185, -1)).toBe(180);
	});
	test("clamps at the maximum", () => {
		expect(computeKeyboardWidth(595, 1)).toBe(600);
	});
});
