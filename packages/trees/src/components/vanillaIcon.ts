// Vanilla DOM port of Icon.tsx (components/Icon.tsx:12-65). Output must match
// the preact component's rendered markup exactly -- see vanillaIcon.test.ts
// for the parity assertions.
import { svgEl } from "../render/el";

const DEFAULT_WIDTH = 16;
const DEFAULT_HEIGHT = 16;

const ICON_SIZE_OVERRIDES: Record<
	string,
	{ width: number; height: number; viewBox?: string } | undefined
> = {};

export type BuildIconProps = {
	name: string;
	remappedFrom?: string;
	token?: string;
	width?: number;
	height?: number;
	viewBox?: string;
	label?: string;
	alignCapitals?: boolean;
};

export const buildIcon = (props: BuildIconProps): SVGSVGElement => {
	const {
		name,
		remappedFrom,
		token,
		width: propWidth,
		height: propHeight,
		viewBox: propViewBox,
		label,
		alignCapitals = false,
	} = props;

	const href = `#${name.replace(/^#/, "")}`;
	const override = ICON_SIZE_OVERRIDES[name] ?? {
		width: DEFAULT_WIDTH,
		height: DEFAULT_HEIGHT,
	};
	const {
		width: iconWidth,
		height: iconHeight,
		viewBox: overrideViewBox,
	} = override;
	const width = propWidth ?? iconWidth;
	const height = propHeight ?? iconHeight;
	const viewBox =
		propViewBox ?? overrideViewBox ?? `0 0 ${iconWidth} ${iconHeight}`;

	// aria-hidden/data-align-capitals must be the literal string "true"/"false"
	// (never el()'s boolean-attribute shorthand) -- style.css binds to
	// `[data-align-capitals="true"]`/`[data-align-capitals="false"]`, and preact
	// stringifies non-boolean-HTML-attribute JSX props the same way.
	const a11yProps: Record<string, unknown> =
		label != null
			? { "aria-label": label, role: "img" }
			: { "aria-hidden": "true" };

	return svgEl(
		"svg",
		{
			"data-icon-name": remappedFrom ?? name,
			"data-icon-token": token,
			"data-align-capitals": alignCapitals ? "true" : "false",
			...a11yProps,
			viewBox,
			width,
			height,
		},
		[svgEl("use", { href })],
	) as SVGSVGElement;
};
