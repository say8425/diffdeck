import { GlobalRegistrator } from "@happy-dom/global-registrator";

// NOTE: happy-dom@20.x removed the `happy-dom/lib/GlobalRegistrator.js` entry
// point and split it out into the separate `@happy-dom/global-registrator`
// package (same version line, `happy-dom` as its own dependency). `isRegistered`
// is the package's own guard against double-registration (it throws if
// `register()` is called twice), which is more reliable than sniffing a
// `globalThis` property.
if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
