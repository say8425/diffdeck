import { expect, test } from "bun:test";
import {
	DEFAULT_BLOB_CACHE_BYTES,
	createBlobCache,
} from "../server/blobCache.ts";

const bytes = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(n);

test("returns what was stored and counts hits and misses", () => {
	const cache = createBlobCache({ maxBytes: 100 });
	cache.set("a", bytes(10));
	expect(cache.get("a")?.byteLength).toBe(10);
	expect(cache.get("b")).toBeUndefined();
	expect(cache.stats()).toEqual({ hits: 1, misses: 1, bytes: 10, entries: 1 });
});

test("stores an empty blob (a zero-length hit is still a hit)", () => {
	const cache = createBlobCache({ maxBytes: 100 });
	cache.set("empty", bytes(0));
	expect(cache.get("empty")?.byteLength).toBe(0);
	expect(cache.stats().hits).toBe(1);
});

test("evicts the least recently used entries once the byte total exceeds the cap", () => {
	const cache = createBlobCache({ maxBytes: 100 });
	cache.set("a", bytes(40));
	cache.set("b", bytes(40));
	cache.get("a"); // a가 최근 — 다음 퇴출 대상은 b
	cache.set("c", bytes(40)); // 120 > 100 → b를 버려 80
	expect(cache.get("b")).toBeUndefined();
	expect(cache.get("a")?.byteLength).toBe(40);
	expect(cache.get("c")?.byteLength).toBe(40);
	expect(cache.stats()).toMatchObject({ bytes: 80, entries: 2 });
});

test("does not store an entry larger than the cap, and keeps what it had", () => {
	const cache = createBlobCache({ maxBytes: 100 });
	cache.set("a", bytes(40));
	cache.set("huge", bytes(101));
	expect(cache.get("huge")).toBeUndefined();
	expect(cache.get("a")?.byteLength).toBe(40);
	expect(cache.stats()).toMatchObject({ bytes: 40, entries: 1 });
});

test("overwriting a key replaces its bytes instead of counting them twice", () => {
	const cache = createBlobCache({ maxBytes: 100 });
	cache.set("a", bytes(40));
	cache.set("a", bytes(30));
	expect(cache.stats()).toMatchObject({ bytes: 30, entries: 1 });
});

test("defaults to a 64MB cap", () => {
	const cache = createBlobCache();
	cache.set("at-cap", bytes(DEFAULT_BLOB_CACHE_BYTES));
	cache.set("over-cap", bytes(DEFAULT_BLOB_CACHE_BYTES + 1));
	expect(cache.stats().entries).toBe(1);
	expect(DEFAULT_BLOB_CACHE_BYTES).toBe(64 * 1024 * 1024);
});

test("has() answers without counting a hit or a miss and without touching recency", () => {
	const cache = createBlobCache({ maxBytes: 100 });
	cache.set("a", bytes(40));
	cache.set("b", bytes(40));
	expect(cache.has("a")).toBe(true);
	expect(cache.has("zzz")).toBe(false);
	expect(cache.stats()).toMatchObject({ hits: 0, misses: 0 });
	// has("a")가 최근성을 올렸다면 다음 퇴출 대상은 b였을 것이다 — a가 버려져야 한다.
	cache.set("c", bytes(40));
	expect(cache.has("a")).toBe(false);
	expect(cache.has("b")).toBe(true);
});
