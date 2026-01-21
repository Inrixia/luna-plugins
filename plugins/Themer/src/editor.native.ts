import { app, BrowserWindow, ipcMain, shell } from "electron";
import editor from "file://editor.html?base64&minify";
import preloadCode from "file://editor.preload.js";
import { rm, writeFile } from "fs/promises";
import path from "path";

let win: BrowserWindow | null = null;
export const openEditor = async (css: string) => {
	if (win && !win.isDestroyed()) return win.focus();

	const preloadPath = path.join(app.getPath("temp"), `${Math.random().toString()}.preload.js`);
	try {
		await writeFile(preloadPath, preloadCode, "utf-8");

		win = new BrowserWindow({
			title: "TIDAL CSS Editor",
			width: 1000,
			height: 1000,
			webPreferences: {
				preload: preloadPath,
			},
			autoHideMenuBar: true,
			backgroundColor: "#1e1e1e",
		});

		// Open links in default browser
		win.webContents.setWindowOpenHandler(({ url }) => {
			shell.openExternal(url);
			return { action: "deny" };
		});

		await win.loadURL(`data:text/html;base64,${editor}`);
		await win.webContents.executeJavaScript(`window.editor.setValue(${JSON.stringify(css)})`);
	} finally {
		await rm(preloadPath, { force: true });
	}
};

ipcMain.removeAllListeners("themer.setCSS");
ipcMain.on("themer.setCSS", async (_: unknown, css: string) => {
	const tidalWindow = BrowserWindow.fromId(1);
	if (tidalWindow?.title !== "TIDAL") console.warn(`Themer: BrowserWindow.fromId(1).title is ${tidalWindow?.title} expected "TIDAL"`);
	tidalWindow?.webContents?.send("THEMER_SET_CSS", css);
});

export const closeEditor = async () => {
	if (win && !win.isDestroyed()) win.close();
	ipcMain.removeAllListeners("themer.setCSS");
};
