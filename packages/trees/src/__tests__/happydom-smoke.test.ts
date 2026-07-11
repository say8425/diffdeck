import { expect, test } from "bun:test";
import "./happydom";

test("happy-dom provides a document with attachShadow", () => {
	const host = document.createElement("div");
	const shadow = host.attachShadow({ mode: "open" });
	const btn = document.createElement("button");
	btn.setAttribute("role", "treeitem");
	shadow.append(btn);
	expect(shadow.querySelector("[role=treeitem]")).toBe(btn);
});
