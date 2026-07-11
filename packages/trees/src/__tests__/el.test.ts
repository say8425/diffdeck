import { expect, test } from "bun:test";
import "./happydom";
import { el, svgEl } from "../render/el";

test("el sets string attrs and non-aria/data boolean true as present, omits undefined", () => {
	const n = el("button", {
		role: "treeitem",
		disabled: true,
		hidden: false,
		"data-y": undefined,
	});
	expect(n.getAttribute("role")).toBe("treeitem");
	// Non-aria/data boolean: true -> present (empty string), false -> omitted.
	expect(n.hasAttribute("disabled")).toBe(true);
	expect(n.getAttribute("disabled")).toBe("");
	expect(n.hasAttribute("hidden")).toBe(false);
	expect(n.hasAttribute("data-y")).toBe(false);
});

test("el stringifies aria-*/data-* booleans instead of using HTML-boolean presence/omission semantics", () => {
	// Real preact's setProperty (preact/src/diff/props.js) special-cases
	// `aria-*`/`data-*` names to always `setAttribute(name, String(value))`,
	// never omitting on `false` -- unlike every other boolean attribute.
	const n = el("button", {
		"data-item-selected": true,
		"data-item-dragging": false,
		"aria-expanded": true,
		"aria-selected": false,
	});
	expect(n.getAttribute("data-item-selected")).toBe("true");
	expect(n.getAttribute("data-item-dragging")).toBe("false");
	expect(n.hasAttribute("data-item-dragging")).toBe(true);
	expect(n.getAttribute("aria-expanded")).toBe("true");
	expect(n.getAttribute("aria-selected")).toBe("false");
	expect(n.hasAttribute("aria-selected")).toBe(true);
});

test("el applies style object per-property", () => {
	const n = el("div", { style: { minHeight: "30px" } });
	expect(n.style.minHeight).toBe("30px");
});

test("el appends string children as text (no HTML injection)", () => {
	const n = el("span", {}, ["<b>x</b>"]);
	expect(n.textContent).toBe("<b>x</b>");
	expect(n.querySelector("b")).toBeNull();
});

test("svgEl builds svg/use in the SVG namespace", () => {
	const svg = svgEl("svg", {}, [
		svgEl("use", { href: "#file-tree-icon-file" }),
	]);
	expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
	expect((svg.firstChild as Element).getAttribute("href")).toBe(
		"#file-tree-icon-file",
	);
});
