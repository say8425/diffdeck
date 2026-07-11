import { expect, test } from "bun:test";
import "./happydom";
import {
	buildMiddleTruncate,
	buildTruncate,
} from "../components/vanillaOverflowText";

// Expected structure verified against the REAL preact OverflowText.tsx by
// rendering it into happy-dom via `preact`'s `render()` and inspecting
// `innerHTML` (see task-2-report.md). All `data-truncate-*`/`aria-hidden`
// boolean-shorthand JSX attrs serialize to the literal string "true" (not an
// empty-string presence attribute) -- preact's DOM prop diffing always
// stringifies non-property attribute values via `setAttribute`.

test("buildTruncate: container/grid/content/marker structure with default marker", () => {
	const node = buildTruncate({ children: "components/LongFileName.tsx" });

	expect(node.getAttribute("data-truncate-container")).toBe("truncate");
	expect(node.getAttribute("data-truncate-variant")).toBe("default");

	const grid = node.querySelector(":scope > div");
	expect(grid?.getAttribute("data-truncate-grid")).toBe("true");

	const visible = grid?.querySelector('[data-truncate-content="visible"]');
	expect(visible?.textContent).toBe("components/LongFileName.tsx");

	const overflow = grid?.querySelector('[data-truncate-content="overflow"]');
	expect(overflow?.textContent).toBe("components/LongFileName.tsx");
	expect(overflow?.getAttribute("aria-hidden")).toBe("true");

	const markerCell = grid?.querySelector("[data-truncate-marker-cell]");
	expect(markerCell?.getAttribute("data-truncate-marker-cell")).toBe("true");
	expect(markerCell?.getAttribute("aria-hidden")).toBe("true");

	const marker = markerCell?.querySelector("[data-truncate-marker]");
	expect(marker?.getAttribute("data-truncate-marker")).toBe("true");
	expect(marker?.textContent).toBe("…");

	// truncate mode: content comes before the marker cell in the grid.
	const gridChildren = Array.from(grid?.children ?? []);
	expect(gridChildren[0]).toBe(visible?.parentElement as Element);
	expect(gridChildren[1]).toBe(markerCell as Element);
});

test("buildMiddleTruncate: middle-truncated filename splits on the extension into head (Truncate) + tail (Fruncate)", () => {
	const node = buildMiddleTruncate({
		children: "components/LongFileNameThatIsVeryLong.tsx",
		split: "extension",
		minimumLength: 5,
	});

	expect(node.getAttribute("data-truncate-group-container")).toBe("middle");

	const segments = node.querySelectorAll(
		":scope > [data-truncate-segment-priority]",
	);
	expect(segments.length).toBe(2);

	// default priority "end": first segment (head/Truncate) is de-prioritized ("2"),
	// second segment (tail/Fruncate) is prioritized ("1").
	expect(segments[0]?.getAttribute("data-truncate-segment-priority")).toBe("2");
	expect(segments[1]?.getAttribute("data-truncate-segment-priority")).toBe("1");

	const head = segments[0]?.querySelector("[data-truncate-container]");
	expect(head?.getAttribute("data-truncate-container")).toBe("truncate");
	expect(
		head?.querySelector('[data-truncate-content="visible"]')?.textContent,
	).toBe("components/LongFileNameThatIsVeryLong.");

	const tail = segments[1]?.querySelector("[data-truncate-container]");
	expect(tail?.getAttribute("data-truncate-container")).toBe("fruncate");
	// fruncate mode wraps content in a <span> (right-aligned RTL internals).
	const tailVisible = tail?.querySelector('[data-truncate-content="visible"]');
	expect(tailVisible?.querySelector("span")?.textContent).toBe("tsx");
	// fruncate mode appends a fill div after the content.
	expect(tail?.querySelector("[data-truncate-fill]")).not.toBeNull();
});

test("buildMiddleTruncate: below minimumLength returns a bare Fruncate (no group wrapper)", () => {
	const node = buildMiddleTruncate({ children: "short.ts", minimumLength: 12 });

	expect(node.hasAttribute("data-truncate-group-container")).toBe(false);
	expect(node.getAttribute("data-truncate-container")).toBe("fruncate");
	expect(
		node.querySelector('[data-truncate-content="visible"] span')?.textContent,
	).toBe("short.ts");
});

test("buildMiddleTruncate: empty string returns a bare div with no truncate attributes", () => {
	const node = buildMiddleTruncate({ children: "", minimumLength: 12 });

	expect(node.tagName.toLowerCase()).toBe("div");
	expect(node.attributes.length).toBe(0);
	expect(node.children.length).toBe(0);
});
