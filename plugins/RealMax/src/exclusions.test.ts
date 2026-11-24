// Run: pnpm exec tsx --test plugins/RealMax/src/exclusions.test.ts
// Covers: exclusions.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("RealMAX exclusions", async () => {
	const { settings } = await import("../../../test/stubs/Settings");
	const lib = await import("../../../test/stubs/lunaLib");
	const { Quality, MediaItem, MediaItems, contextMenu, dispatched } = lib;
	const { isExcluded, findReplacement } = await import("./exclusions");

	/** Fake track: `max` is what mediaItem.max() returns, `isrcs` what mediaItem.isrcs() yields */
	const track = (id: number | string, bestQuality: (typeof Quality)["High"], { max, isrcs, ...extra }: Record<string, any> = {}): any => ({
		id,
		bestQuality,
		contentType: "track",
		tidalItem: { title: `Track ${id}` },
		max: typeof max === "function" ? max : async () => max,
		isrcs: async function* () {
			yield* isrcs ?? [];
		},
		...extra,
	});

	beforeEach(() => {
		settings.keepVersion = {};
		settings.neverUse = {};
		dispatched.length = 0;
	});

	describe("isExcluded", () => {
		test("matches ids as strings, so numeric and string ids are the same track", () => {
			settings.keepVersion = { "123": "label" };
			assert.equal(isExcluded("keepVersion", 123), true);
			assert.equal(isExcluded("keepVersion", "123"), true);
			assert.equal(isExcluded("neverUse", 123), false);
			assert.equal(isExcluded("keepVersion", 1234), false);
		});
	});

	describe("findReplacement", () => {
		test("returns the max version when neither list applies", async () => {
			const max = track(2, Quality.HiRes);
			assert.equal(await findReplacement(track(1, Quality.High, { max })), max);
		});

		test("keeps a track in keepVersion without looking up its max version", async () => {
			settings.keepVersion = { "1": "kept" };
			let looked = false;
			const item = track(1, Quality.High, { max: async () => ((looked = true), track(2, Quality.HiRes)) });
			assert.equal(await findReplacement(item), undefined);
			assert.equal(looked, false);
		});

		test("returns undefined when there is no better version", async () => {
			assert.equal(await findReplacement(track(1, Quality.High)), undefined);
		});

		test("when the max version is in neverUse, picks the best other version found by isrc", async (t) => {
			settings.neverUse = { "2": "never" };
			// A is the excluded max. B is better than the track but not the best and comes before the best (C), so taking the first better one gives B
			const candidates: Record<string, any> = {
				A: track(2, Quality.HiRes),
				B: track(3, Quality.MQA),
				C: track(4, Quality.HiRes),
				D: track(5, Quality.Low),
			};
			t.mock.method(MediaItem, "fromIsrc", async (isrc: string) => candidates[isrc]);
			const item = track(1, Quality.High, { max: candidates.A, isrcs: ["A", "B", "C", "D", "missing"] });
			assert.equal((await findReplacement(item))?.id, 4);
		});

		test("keeps the best version when a lesser one that still beats the track comes after it", async (t) => {
			settings.neverUse = { "2": "never" };
			// A (MQA) is the best and sits in the middle. B (High) is better than the Low track but not than A, so it must not replace A
			const candidates: Record<string, any> = { A: track(3, Quality.MQA), B: track(4, Quality.High) };
			t.mock.method(MediaItem, "fromIsrc", async (isrc: string) => candidates[isrc]);
			const item = track(1, Quality.Low, { max: track(2, Quality.HiRes), isrcs: ["A", "B"] });
			assert.equal((await findReplacement(item))?.id, 3);
		});

		test("stops searching once a HiRes version is found", async (t) => {
			settings.neverUse = { "2": "never" };
			const looked: string[] = [];
			const candidates: Record<string, any> = { A: track(5, Quality.HiRes), B: track(6, Quality.HiRes) };
			t.mock.method(MediaItem, "fromIsrc", async (isrc: string) => (looked.push(isrc), candidates[isrc]));
			const item = track(1, Quality.High, { max: track(2, Quality.HiRes), isrcs: ["A", "B"] });
			assert.equal((await findReplacement(item))?.id, 5);
			assert.deepEqual(looked, ["A"]);
		});

		test("returns undefined when every better version is in neverUse or the search only finds the track itself", async (t) => {
			settings.neverUse = { "2": "never", "3": "never" };
			const self = track(1, Quality.High);
			const candidates: Record<string, any> = { A: track(3, Quality.HiRes), B: self, C: track("1", Quality.MQA) };
			t.mock.method(MediaItem, "fromIsrc", async (isrc: string) => candidates[isrc]);
			const item = track(1, Quality.High, { max: track(2, Quality.HiRes), isrcs: ["A", "B"] });
			assert.equal(await findReplacement(item), undefined);

			// A candidate with the same id as a string is the track itself, not a replacement
			const item2 = track(1, Quality.Low, { max: track(2, Quality.HiRes), isrcs: ["C"] });
			assert.equal(await findReplacement(item2), undefined);
		});
	});

	describe("context menu", () => {
		const [onMediaItem] = contextMenu.onMediaItem;
		const [keepButton, neverButton] = contextMenu.buttons;
		const menu = { menu: true };

		const open = async (items: any[] | object) => {
			for (const button of contextMenu.buttons) {
				button.text = undefined;
				button.shownIn = undefined;
			}
			await onMediaItem({ mediaCollection: Array.isArray(items) ? new MediaItems(items) : items, contextMenu: menu });
		};

		const labelled = (id: number, tidalItem: Record<string, any>) => track(id, Quality.High, { tidalItem });

		test("adds one button per list", () => {
			assert.equal(contextMenu.buttons.length, 2);
			assert.equal(contextMenu.onMediaItem.length, 1);
		});

		test("offers to add a track that is in neither list", async () => {
			await open([track(1, Quality.High)]);
			assert.equal(keepButton.text, "RealMAX: Keep this version");
			assert.equal(neverButton.text, "RealMAX: Never use this version");
			assert.equal(keepButton.shownIn, menu);
			assert.equal(neverButton.shownIn, menu);
		});

		test("adds the track with a readable label and closes the menu on click", async () => {
			await open([
				labelled(1, { title: "Song", version: "Remix", artist: { name: "Artist" }, album: { title: "Album" } }),
				labelled(2, { title: "Plain" }),
			]);
			assert.equal(keepButton.text, "RealMAX: Keep this version (2 tracks)");
			keepButton.click!();
			assert.deepEqual(settings.keepVersion, { "1": "Song (Remix) - Artist [Album]", "2": "Plain" });
			assert.deepEqual(settings.neverUse, {});
			assert.deepEqual(dispatched, [{ type: "contextMenu/CLOSE", payload: undefined }]);
		});

		test("offers removal when every selected track is listed, and removes them all on click", async () => {
			settings.neverUse = { "1": "a", "2": "b", "3": "other" };
			await open([track(1, Quality.High), track(2, Quality.High)]);
			assert.equal(neverButton.text, "RealMAX: Allow as replacement (2 tracks)");
			assert.equal(keepButton.text, "RealMAX: Keep this version (2 tracks)");
			neverButton.click!();
			assert.deepEqual(settings.neverUse, { "3": "other" });
		});

		test("offers adding when only some selected tracks are listed", async () => {
			settings.keepVersion = { "1": "a" };
			await open([track(1, Quality.High), track(2, Quality.High)]);
			assert.equal(keepButton.text, "RealMAX: Keep this version (2 tracks)");
			keepButton.click!();
			assert.deepEqual(Object.keys(settings.keepVersion), ["1", "2"]);
		});

		test("ignores videos in the selection and shows nothing for videos only, albums or playlists", async () => {
			await open([track(1, Quality.High), { ...track(9, Quality.High), contentType: "video" }]);
			assert.equal(keepButton.text, "RealMAX: Keep this version");

			await open([{ ...track(9, Quality.High), contentType: "video" }]);
			assert.equal(keepButton.shownIn, undefined);

			await open({ album: true });
			assert.equal(keepButton.shownIn, undefined);
		});

		test("removes the buttons left over from the previous menu before anything else", async () => {
			let removed = 0;
			for (const button of contextMenu.buttons) button.elem = { parentElement: { parentElement: { remove: () => removed++ } } };
			await open({ album: true });
			assert.equal(removed, 2);
			for (const button of contextMenu.buttons) delete button.elem;
		});
	});
});
