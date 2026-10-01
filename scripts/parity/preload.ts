// bunfig.toml preload: lets `bun test` resolve the forked packages' `?inline` CSS imports.
import { plugin } from "bun";
import { cssInlineRuntimePlugin } from "../css-inline-plugin.ts";

await plugin(cssInlineRuntimePlugin);
