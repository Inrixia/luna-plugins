// Minimal @luna/lib.native for node:test: every export delegates to `native`, which tests replace per test.
export const native: Record<string, (...args: any[]) => any> = {
	clipboardWriteText: async () => {},
	showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
	showSaveDialog: async () => ({ canceled: true }),
	fetchMediaItemStream: async () => {
		throw new Error("native.fetchMediaItemStream not set");
	},
};

export const clipboardWriteText = (...args: any[]) => native.clipboardWriteText(...args);
export const showOpenDialog = (...args: any[]) => native.showOpenDialog(...args);
export const showSaveDialog = (...args: any[]) => native.showSaveDialog(...args);
export const fetchMediaItemStream = (...args: any[]) => native.fetchMediaItemStream(...args);
