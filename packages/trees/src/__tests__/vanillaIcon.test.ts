import { expect, test } from "bun:test";
import "./happydom";
import { buildIcon } from "../components/vanillaIcon";

test("icon: svg with use href, aria-hidden, data-icon-name", () => {
	const svg = buildIcon({ name: "file-tree-icon-file" });
	expect(svg.tagName.toLowerCase()).toBe("svg");
	expect(svg.getAttribute("data-icon-name")).toBe("file-tree-icon-file");
	expect(svg.getAttribute("aria-hidden")).toBe("true");
	const use = svg.querySelector("use");
	expect(use?.getAttribute("href")).toBe("#file-tree-icon-file");
});

test("icon with label: role=img + aria-label, remappedFrom wins data-icon-name", () => {
	const svg = buildIcon({
		name: "x",
		remappedFrom: "file-tree-icon-file",
		label: "File",
	});
	expect(svg.getAttribute("role")).toBe("img");
	expect(svg.getAttribute("aria-label")).toBe("File");
	expect(svg.getAttribute("data-icon-name")).toBe("file-tree-icon-file");
});
