// Cross-platform "open this URL in the default browser" argv.
// win32: `start` treats its first quoted argument as the window title, so an
// empty title placeholder must precede the URL.
export const openerCommand = (platform: string, url: string): string[] => {
	if (platform === "darwin") return ["open", url];
	if (platform === "win32") return ["cmd", "/c", "start", "", url];
	return ["xdg-open", url];
};
