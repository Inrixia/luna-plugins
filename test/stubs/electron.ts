// Minimal electron for node:test: set `windows` to the fake BrowserWindows the code should see.
export const windows: unknown[] = [];
export const BrowserWindow = {
	getAllWindows: () => windows,
};
