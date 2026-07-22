import { describe, expect, test } from "bun:test";
import type { DiffFile } from "../server/diff.ts";
import { createPayloadCache, payloadEtag } from "../server/payloadCache.ts";

const file = (over: Partial<DiffFile> = {}): DiffFile => ({
	name: "a.txt",
	status: "modified",
	binary: false,
	oldContents: "one\n",
	newContents: "two\n",
	contentVersion: "v1",
	...over,
});

describe("payloadEtag", () => {
	test("same file identity yields the same etag", () => {
		expect(payloadEtag([file()])).toBeTruthy();
		expect(payloadEtag([file()])).toBe(payloadEtag([file()]));
	});

	test("changes when a file's contentVersion changes", () => {
		expect(payloadEtag([file({ contentVersion: "v2" })])).not.toBe(
			payloadEtag([file()]),
		);
	});

	test("changes when the file set or status changes", () => {
		expect(payloadEtag([file(), file({ name: "b.txt" })])).not.toBe(
			payloadEtag([file()]),
		);
		expect(payloadEtag([file({ status: "deleted" })])).not.toBe(
			payloadEtag([file()]),
		);
	});

	test("rename identity (oldName) participates in the etag", () => {
		expect(
			payloadEtag([file({ status: "renamed", oldName: "old.txt" })]),
		).not.toBe(
			payloadEtag([file({ status: "renamed", oldName: "older.txt" })]),
		);
	});
});

describe("createPayloadCache", () => {
	test("miss on unknown key, hit while the fingerprint matches", () => {
		const cache = createPayloadCache();
		expect(cache.get("k1", "fp1")).toBeNull();
		cache.set("k1", { fingerprint: "fp1", etag: "e1", body: "[]" });
		expect(cache.get("k1", "fp1")).toEqual({
			fingerprint: "fp1",
			etag: "e1",
			body: "[]",
		});
	});

	test("a stale fingerprint invalidates the entry", () => {
		const cache = createPayloadCache();
		cache.set("k1", { fingerprint: "fp1", etag: "e1", body: "[]" });
		expect(cache.get("k1", "fp2")).toBeNull();
	});

	test("evicts the oldest key beyond maxEntries", () => {
		const cache = createPayloadCache(2);
		cache.set("k1", { fingerprint: "f", etag: "e", body: "1" });
		cache.set("k2", { fingerprint: "f", etag: "e", body: "2" });
		cache.set("k3", { fingerprint: "f", etag: "e", body: "3" });
		expect(cache.get("k1", "f")).toBeNull();
		expect(cache.get("k2", "f")).not.toBeNull();
		expect(cache.get("k3", "f")).not.toBeNull();
	});

	test("re-setting an existing key refreshes it without eviction", () => {
		const cache = createPayloadCache(2);
		cache.set("k1", { fingerprint: "f", etag: "e", body: "1" });
		cache.set("k2", { fingerprint: "f", etag: "e", body: "2" });
		cache.set("k1", { fingerprint: "f2", etag: "e2", body: "1b" });
		expect(cache.get("k2", "f")).not.toBeNull();
		expect(cache.get("k1", "f2")?.body).toBe("1b");
	});
});
