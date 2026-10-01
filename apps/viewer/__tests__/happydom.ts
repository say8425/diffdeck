import { GlobalRegistrator } from "@happy-dom/global-registrator";

// `bun test` runs every file in one process, so happy-dom's versions of these would leak into the
// real-HTTP-server tests. Restore the native ones right after registering (testing.md).
const NATIVE_GLOBAL_KEYS = [
	"fetch",
	"Request",
	"Response",
	"Headers",
	"URL",
	"URLSearchParams",
	"TextEncoder",
	"TextDecoder",
	"Blob",
	"File",
	"FormData",
	"ReadableStream",
	"WritableStream",
	"TransformStream",
	"AbortController",
	"AbortSignal",
	"WebSocket",
] as const;

if (!GlobalRegistrator.isRegistered) {
	const native = new Map(
		NATIVE_GLOBAL_KEYS.map((key) => [
			key,
			(globalThis as Record<string, unknown>)[key],
		]),
	);
	GlobalRegistrator.register();
	for (const [key, value] of native) {
		(globalThis as Record<string, unknown>)[key] = value;
	}
}
