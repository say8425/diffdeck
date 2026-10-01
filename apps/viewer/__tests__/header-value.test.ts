import { describe, expect, test } from "bun:test";
import { decodeHeaderValue } from "../browser/headerValue.ts";

describe("decodeHeaderValue", () => {
	test("decodes a percent-encoded non-latin1 branch name", () => {
		expect(decodeHeaderValue(encodeURIComponent("기능"))).toBe("기능");
	});

	test("leaves an ascii branch name unchanged", () => {
		expect(decodeHeaderValue("main")).toBe("main");
	});

	test("treats a missing header as empty", () => {
		expect(decodeHeaderValue(null)).toBe("");
	});

	// 커버리지 게이트는 branch를 세지 않으므로 이 갈래를 일부러 찌른다.
	test("falls back to the raw value when the encoding is malformed", () => {
		expect(decodeHeaderValue("release-50%-done")).toBe("release-50%-done");
	});
});
