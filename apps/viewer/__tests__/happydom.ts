import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Network/serialization globals GlobalRegistrator.register() overwrites with
// happy-dom's own implementations. `bun test` runs every matched file in one
// process, so once any browser test file (this one) is loaded, those
// overwritten globals leak into unrelated real-HTTP-server tests elsewhere in
// the same run (diff-server.test.ts, built-serving.test.ts route requests via
// `new URL(req.url)` / `new Response(...)` and fail — mis-routed paths, parse
// errors — once those constructors are happy-dom's instead of Bun's native
// ones). None of the browser code under test needs any of these, so they are
// restored to their native implementations immediately after registering.
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

// Per-file DOM registration. NOT preloaded globally (see above). Import this
// at the top of any browser unit test that needs a DOM.
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
