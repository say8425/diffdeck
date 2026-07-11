import { expect, test } from "bun:test";
import { createFileTreeIconResolver } from "../render/iconResolver";

test("chevron resolves to itself (no filePath remap)", () => {
	const { resolveIcon } = createFileTreeIconResolver();
	expect(resolveIcon("file-tree-icon-chevron").name).toBe(
		"file-tree-icon-chevron",
	);
});

test("file icon resolves a per-extension built-in for .ts", () => {
	const { resolveIcon } = createFileTreeIconResolver();
	const icon = resolveIcon("file-tree-icon-file", "src/a.ts");
	expect(icon.name).toBeTruthy();
	expect(icon.remappedFrom).toBe("file-tree-icon-file");
});

test("file icon without a matching rule returns a stable name", () => {
	const { resolveIcon } = createFileTreeIconResolver();
	const icon = resolveIcon("file-tree-icon-file", "noext");
	expect(typeof icon.name).toBe("string");
});
