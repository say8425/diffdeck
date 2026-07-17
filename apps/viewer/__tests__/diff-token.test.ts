import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import {
	generateToken,
	getTokenPath,
	persistToken,
	readTokenSync,
} from "../server/token.ts";

const TMP = "/tmp/cc-statusline-token-test";
const env = { XDG_CACHE_HOME: TMP };

afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

describe("token module", () => {
	test("generateToken returns a non-empty hex-ish string", () => {
		const t = generateToken();
		expect(t.length).toBeGreaterThan(16);
		expect(t).not.toContain("-");
	});

	test("readTokenSync returns null when absent", () => {
		expect(readTokenSync(env)).toBeNull();
	});

	test("persistToken writes a token that readTokenSync reads back", () => {
		const t = generateToken();
		persistToken(t, env);
		expect(readTokenSync(env)).toBe(t);
	});

	test("persistToken creates the cache dir when it does not exist yet", () => {
		rmSync(TMP, { recursive: true, force: true });
		const t = generateToken();
		persistToken(t, env);
		expect(readTokenSync(env)).toBe(t);
	});

	test("getTokenPath is under the cache dir", () => {
		expect(getTokenPath(env)).toBe(`${TMP}/diffdeck/diff-server.token`);
	});
});
