import { describe, expect, test } from "bun:test";
import {
	type RangeEndpoints,
	resolveSelectionRange,
	type SelectionLike,
} from "../browser/grab/selectionAdapter.ts";

const node = {} as Node;
const range: RangeEndpoints = {
	startContainer: node,
	startOffset: 0,
	endContainer: node,
	endOffset: 3,
};

describe("resolveSelectionRange", () => {
	test("null selection → null", () => {
		expect(resolveSelectionRange(null, [])).toBeNull();
	});
	test("outer isCollapsed=true지만 getComposedRanges 없음 + fallback 전멸 → null", () => {
		// Chrome의 shadow rescope: outer isCollapsed는 신뢰 불가
		const sel: SelectionLike = { isCollapsed: true };
		expect(resolveSelectionRange(sel, [])).toBeNull();
		expect(resolveSelectionRange(sel, [{}])).toBeNull();
	});
	test("Chrome 실측: outer isCollapsed=true지만 getComposedRanges는 유효한 range → resolve", () => {
		// Chrome이 shadow root를 rescope했을 때, outer isCollapsed=true지만
		// getComposedRanges({shadowRoots})는 실제 드래그 선택을 반환한다
		const sel: SelectionLike = {
			isCollapsed: true,
			direction: "forward",
			getComposedRanges: () => [range],
		};
		expect(resolveSelectionRange(sel, [])).toEqual({ range, backward: false });
	});
	test("primary: getComposedRanges 옵션백 호출 + direction backward 전파", () => {
		let seen: unknown;
		const sel: SelectionLike = {
			isCollapsed: false,
			direction: "backward",
			getComposedRanges: (options) => {
				seen = options;
				return [range];
			},
		};
		const roots = [{}, {}];
		expect(resolveSelectionRange(sel, roots)).toEqual({
			range,
			backward: true,
		});
		expect(seen).toEqual({ shadowRoots: roots });
	});
	test("primary가 빈 배열을 주면 null", () => {
		expect(
			resolveSelectionRange(
				{ isCollapsed: false, getComposedRanges: () => [] },
				[],
			),
		).toBeNull();
	});
	test("primary가 collapsed StaticRange(start === end)를 반환 → null", () => {
		const collapsedRange: RangeEndpoints = {
			startContainer: node,
			startOffset: 5,
			endContainer: node,
			endOffset: 5,
		};
		expect(
			resolveSelectionRange(
				{ isCollapsed: false, getComposedRanges: () => [collapsedRange] },
				[],
			),
		).toBeNull();
	});
	test("fallback: root.getSelection()의 첫 non-collapsed range, backward=false", () => {
		const sel: SelectionLike = { isCollapsed: false }; // getComposedRanges 없음
		const roots = [
			{ getSelection: () => ({ isCollapsed: true }) as SelectionLike },
			{
				getSelection: () =>
					({
						isCollapsed: false,
						rangeCount: 1,
						getRangeAt: () => range,
					}) as SelectionLike,
			},
		];
		expect(resolveSelectionRange(sel, roots)).toEqual({
			range,
			backward: false,
		});
	});
	test("fallback 전멸(getSelection 없음/rangeCount 0) → null", () => {
		const sel: SelectionLike = { isCollapsed: false };
		const roots = [
			{},
			{ getSelection: () => null },
			{
				getSelection: () =>
					({ isCollapsed: false, rangeCount: 0 }) as SelectionLike,
			},
		];
		expect(resolveSelectionRange(sel, roots)).toBeNull();
	});
});
