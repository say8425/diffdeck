import { describe, expect, test } from "bun:test";
import { openerCommand } from "../cli/opener.ts";

const URL = "http://127.0.0.1:49573/?repo=%2Ftmp&token=abc";

describe("openerCommand", () => {
	test("macOS uses `open`", () => {
		expect(openerCommand("darwin", URL)).toEqual(["open", URL]);
	});
	test("Windows uses `cmd /c start` with an empty title arg", () => {
		expect(openerCommand("win32", URL)).toEqual([
			"cmd",
			"/c",
			"start",
			"",
			URL,
		]);
	});
	test("Linux/other uses `xdg-open`", () => {
		expect(openerCommand("linux", URL)).toEqual(["xdg-open", URL]);
		expect(openerCommand("freebsd", URL)).toEqual(["xdg-open", URL]);
	});
});
