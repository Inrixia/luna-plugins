// Run: pnpm exec tsx --test plugins/DiscordRPC/src/activityTextHelpers.test.ts
// Covers: activityTextHelpers.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

const fakeItem = (opts: { title?: string; artists?: string[]; album?: string }): any => ({
	title: async () => opts.title,
	artists: async () => (opts.artists ?? []).map(async (name) => ({ name })),
	album: async () => (opts.album === undefined ? undefined : { title: async () => opts.album }),
});

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("DiscordRPC activity text", async () => {
	const { settings } = await import("../../../test/stubs/Settings");
	const { fmtStr, getStatusText } = await import("./activityTextHelpers");

	describe("fmtStr", () => {
		test("returns undefined for an empty or missing string", () => {
			assert.equal(fmtStr(undefined), undefined);
			assert.equal(fmtStr(""), undefined);
		});

		test("pads a one character string to Discord's 2 character minimum", () => {
			assert.equal(fmtStr("a"), "a ");
		});

		test("leaves a two character string unpadded", () => {
			assert.equal(fmtStr("ab"), "ab");
		});

		test("leaves strings under 127 characters unchanged", () => {
			const s = "x".repeat(126);
			assert.equal(fmtStr(s), s);
		});

		test("cuts strings of 127+ characters to 124 characters plus an ellipsis", () => {
			assert.equal(fmtStr("x".repeat(127)), "x".repeat(124) + "...");
			assert.equal(fmtStr("y".repeat(500))!.length, 127);
		});
	});

	describe("getStatusText", () => {
		beforeEach(() => {
			settings.customStatusText = "{track} by {artist}";
		});

		test("fills {track} and {artist}, joining several artists with a comma", async () => {
			assert.equal(await getStatusText(fakeItem({ title: "Song", artists: ["A", "B"] })), "Song by A, B");
		});

		test("fills {album} and replaces every occurrence of a tag", async () => {
			settings.customStatusText = "{album} | {track} | {album}";
			assert.equal(await getStatusText(fakeItem({ title: "T", album: "LP" })), "LP | T | LP");
		});

		test("replaces every occurrence of {artist} and {track} too", async () => {
			settings.customStatusText = "{artist} - {track} / {artist} - {track}";
			assert.equal(await getStatusText(fakeItem({ title: "T", artists: ["A"] })), "A - T / A - T");
		});

		test("uses an empty string for {album} when the track has no album", async () => {
			settings.customStatusText = "{track} [{album}]";
			assert.equal(await getStatusText(fakeItem({ title: "T" })), "T []");
		});

		test("applies the same length limit as fmtStr", async () => {
			const text = await getStatusText(fakeItem({ title: "t".repeat(200), artists: ["A"] }));
			assert.equal(text!.length, 127);
			assert.ok(text!.endsWith("..."));
		});

		test("returns undefined when the status template is empty", async () => {
			settings.customStatusText = "";
			assert.equal(await getStatusText(fakeItem({ title: "T" })), undefined);
		});

		// Pins current behaviour: MediaItem.artistNames returns [] (never undefined), so the "Unknown Artist" fallback never applies
		test("leaves {artist} empty for a track with no artists (Unknown Artist fallback is unreachable)", async () => {
			assert.equal(await getStatusText(fakeItem({ title: "Song" })), "Song by ");
		});
	});
});
