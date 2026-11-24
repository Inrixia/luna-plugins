// Run: pnpm exec tsx --test plugins/SongDownloader/src/helpers.test.ts
// Covers: helpers.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

const fakeItem = (tags: Record<string, any>, extension = "flac"): any => ({
	fileExtension: async () => extension,
	flacTags: async () => ({ tags }),
});

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("SongDownloader helpers", async () => {
	const { settings } = await import("../../../test/stubs/Settings");
	const { native } = await import("../../../test/stubs/lunaLibNative");
	const { getFileName, getDownloadPath, getDownloadFolder } = await import("./helpers");

	describe("getFileName", () => {
		beforeEach(() => {
			settings.pathFormat = "{artist} - {album} - {title}";
		});

		test("fills the path format from the track's tags and adds the file extension", async () => {
			const name = await getFileName(fakeItem({ artist: ["Artist"], album: "Album", title: "Song" }), <any>"LOSSLESS");
			assert.equal(name, "Artist - Album - Song.flac");
		});

		test("passes the download quality to fileExtension", async () => {
			let asked: unknown;
			settings.pathFormat = "{title}";
			const item = { ...fakeItem({ title: "Song" }), fileExtension: async (quality: unknown) => ((asked = quality), "m4a") };
			assert.equal(await getFileName(item, <any>"HIGH"), "Song.m4a");
			assert.equal(asked, "HIGH");
		});

		test("uses the first value of multi value tags", async () => {
			settings.pathFormat = "{artist}";
			assert.equal(await getFileName(fakeItem({ artist: ["Main", "Feat"] })), "Main.flac");
		});

		test("removes characters that are not allowed in file names from tag values, but not from the format", async () => {
			settings.pathFormat = "{artist}/{title}";
			const name = await getFileName(fakeItem({ artist: ["AC/DC"], title: 'What? "Now": <yes>|*' }));
			assert.equal(name, "ACDC/What Now yes.flac");
		});

		// Pins current behaviour: a literal "{year}" ends up in the file name
		test("leaves tags that are missing as their {placeholder}", async () => {
			settings.pathFormat = "{artist} - {year}";
			assert.equal(await getFileName(fakeItem({ artist: ["A"] })), "A - {year}.flac");
		});

		test("replaces every occurrence of a tag", async () => {
			settings.pathFormat = "{title} ({title})";
			assert.equal(await getFileName(fakeItem({ title: "X" })), "X (X).flac");
		});

		test("pads {trackNumberPadded} to 2 digits, or to the width of totalTracks for 100+ track albums", async () => {
			settings.pathFormat = "{trackNumberPadded} {trackNumber}";
			assert.equal(await getFileName(fakeItem({ trackNumber: "3" })), "03 3.flac");
			assert.equal(await getFileName(fakeItem({ trackNumber: "3", totalTracks: "12" })), "03 3.flac");
			assert.equal(await getFileName(fakeItem({ trackNumber: "3", totalTracks: "5" })), "03 3.flac");
			assert.equal(await getFileName(fakeItem({ trackNumber: "3", totalTracks: "120" })), "003 3.flac");
			assert.equal(await getFileName(fakeItem({ trackNumber: "42", totalTracks: "5" })), "42 42.flac");
		});

		// Pins current behaviour: a literal "{trackNumberPadded}" ends up in the file name
		test("leaves {trackNumberPadded} when the track number is unknown", async () => {
			settings.pathFormat = "{trackNumberPadded}";
			assert.equal(await getFileName(fakeItem({})), "{trackNumberPadded}.flac");
		});
	});

	describe("dialogs", () => {
		test("getDownloadPath filters the save dialog by the default path's extension", async (t) => {
			const save = t.mock.method(native, "showSaveDialog", async () => ({ canceled: false, filePath: "C:/out/x.flac" }));
			assert.equal(await getDownloadPath("x.flac"), "C:/out/x.flac");
			assert.deepEqual(save.mock.calls[0].arguments, [{ defaultPath: "x.flac", filters: [{ name: "FLAC", extensions: ["flac"] }] }]);
		});

		test("getDownloadPath allows any extension when the default path has none, and returns undefined when canceled", async (t) => {
			const save = t.mock.method(native, "showSaveDialog", async () => ({ canceled: true, filePath: "" }));
			assert.equal(await getDownloadPath("noext"), undefined);
			assert.deepEqual(save.mock.calls[0].arguments[0].filters, [{ name: "*", extensions: ["*"] }]);
		});

		test("getDownloadFolder asks for a directory and returns the first one picked, or undefined when canceled", async (t) => {
			const open = t.mock.method(native, "showOpenDialog", async () => ({ canceled: false, filePaths: ["C:/a", "C:/b"] }));
			assert.equal(await getDownloadFolder(), "C:/a");
			assert.deepEqual(open.mock.calls[0].arguments, [{ properties: ["openDirectory", "createDirectory"] }]);

			open.mock.mockImplementation(async () => ({ canceled: true, filePaths: [] }));
			assert.equal(await getDownloadFolder(), undefined);
		});
	});
});
