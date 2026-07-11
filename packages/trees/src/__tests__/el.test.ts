import { expect, test } from "bun:test";
import "./happydom";
import { el, svgEl } from "../render/el";

test("el sets string + boolean attrs, omits false/undefined", () => {
	const n = el("button", {
		role: "treeitem",
		"data-item-selected": true,
		"data-x": false,
		"data-y": undefined,
	});
	expect(n.getAttribute("role")).toBe("treeitem");
	expect(n.hasAttribute("data-item-selected")).toBe(true);
	expect(n.hasAttribute("data-x")).toBe(false);
	expect(n.hasAttribute("data-y")).toBe(false);
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
