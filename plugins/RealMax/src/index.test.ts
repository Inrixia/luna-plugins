// Run: pnpm exec tsx --test plugins/RealMax/src/index.test.ts
// Covers: index.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { waitFor } from "../../../test/waitFor";

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("RealMAX", async () => {
	const { settings } = await import("../../../test/stubs/Settings");
	const lib = await import("../../../test/stubs/lunaLib");
	const { Quality, MediaItem, PlayState, Playlist, intercepts, dispatched, listeners, contextMenu } = lib;
	const { traced } = await import("../../../test/stubs/lunaCore");
	await import("./index");

	/** Fake tracks by id; a track's max() is the track with id `${id}max` when there is one */
	const tracks: Record<string, any> = {};
	const track = (id: string, quality = Quality.High, contentType = "track") =>
		(tracks[id] = {
			id,
			contentType,
			bestQuality: quality,
			tidalItem: { title: `Track ${id}` },
			max: async () => tracks[`${id}max`],
			isrcs: async function* () {},
			updateFormat: async () => ({ bitDepth: quality === Quality.HiRes ? 24 : 16, sampleRate: quality === Quality.HiRes ? 96000 : 44100 }),
		});
	const calls: [string, ...unknown[]][] = [];

	beforeEach(() => {
		for (const id in tracks) delete tracks[id];
		calls.length = 0;
		dispatched.length = 0;
		traced.length = 0;
		Object.assign(settings, { displayInfoPopups: false, keepVersion: {}, neverUse: {} });
		MediaItem.fromId = async (id: unknown) => tracks[String(id)];
		Object.assign(PlayState, {
			playing: true,
			playQueue: { elements: [{ mediaItemId: "a" }, { mediaItemId: "b" }, { mediaItemId: "c" }], currentIndex: 1 },
			nextMediaItem: async () => undefined,
		});
		for (const method of ["pause", "play", "playNext", "next", "previous", "moveTo", "updatePlayQueue"])
			PlayState[method] = (...args: unknown[]) => void calls.push([method, ...args]);
		track("a");
		track("b");
		track("c");
	});

	describe("playQueue/ADD_NOW", () => {
		const [addNow] = intercepts["playQueue/ADD_NOW"];

		test("swaps the track being played for its max version and re-dispatches", async () => {
			track("bmax", Quality.HiRes);
			const payload = { mediaItemIds: ["a", "b", "c"], fromIndex: 1, other: 1 };
			assert.equal(addNow(payload), true);
			await waitFor(() => dispatched.length, "the re-dispatch");
			assert.deepEqual(dispatched, [{ type: "playQueue/ADD_NOW", payload: { mediaItemIds: ["a", "bmax", "c"], fromIndex: 1, other: 1 } }]);
			// The intercepted payload isn't changed
			assert.deepEqual(payload.mediaItemIds, ["a", "b", "c"]);
		});

		test("swaps the first track without fromIndex", async () => {
			track("amax", Quality.HiRes);
			track("bmax", Quality.HiRes);
			addNow({ mediaItemIds: ["a", "b"] });
			await waitFor(() => dispatched.length, "the re-dispatch");
			assert.deepEqual(dispatched, [{ type: "playQueue/ADD_NOW", payload: { mediaItemIds: ["amax", "b"] } }]);
		});

		test("re-dispatches unchanged when there is no better version", async () => {
			addNow({ mediaItemIds: ["a", "b"], fromIndex: 1 });
			await waitFor(() => dispatched.length, "the re-dispatch");
			assert.deepEqual(dispatched, [{ type: "playQueue/ADD_NOW", payload: { mediaItemIds: ["a", "b"], fromIndex: 1 } }]);
		});

		test("still re-dispatches when the lookup fails", async () => {
			MediaItem.fromId = async () => {
				throw new Error("offline");
			};
			addNow({ mediaItemIds: ["a"] });
			await waitFor(() => dispatched.length, "the re-dispatch");
			assert.deepEqual(dispatched[0].payload, { mediaItemIds: ["a"] });
			assert.ok(traced.some(({ level, context }) => level === "msg.err" && context === "playQueue/ADD_NOW"));
		});

		test("shows a popup with both formats when displayInfoPopups is on", async () => {
			settings.displayInfoPopups = true;
			track("amax", Quality.HiRes);
			addNow({ mediaItemIds: ["a"] });
			await waitFor(() => dispatched.length, "the re-dispatch");
			assert.deepEqual(traced.find(({ level }) => level === "msg.log")?.args, ["Found replacement for Track a (16bit/44.1kHz -> 24bit/96kHz)"]);
		});
	});

	describe("playQueue moves", () => {
		const [move] = intercepts["playQueue/MOVE_NEXT"];

			// Six elements a..f, playing c: the next (d), the previous (b) and a MOVE_TO target (e) are each neither first, last nor beside one another,
			// and only the one the handler should look at has a max version, so looking at any other element finds nothing to swap
			const ids = ["a", "b", "c", "d", "e", "f"];
			const queueWith = (current: number, replaced: Record<number, string> = {}) => ({
				elements: ids.map((id, i) => ({ mediaItemId: replaced[i] ?? id })),
				currentIndex: current,
			});
			beforeEach(() => {
				for (const id of ids) track(id);
				PlayState.playQueue = queueWith(2);
			});

			test("MOVE_NEXT swaps the next queue element for its max version, then moves on", async () => {
				track("dmax", Quality.HiRes);
				assert.equal(move(undefined, "playQueue/MOVE_NEXT"), true);
				await waitFor(() => calls.length >= 2, "the queue update and move");
				assert.deepEqual(calls, [["updatePlayQueue", queueWith(2, { 3: "dmax" })], ["next"]]);
			});

			test("MOVE_PREVIOUS looks at the previous element", async () => {
				track("bmax", Quality.HiRes);
				move(undefined, "playQueue/MOVE_PREVIOUS");
				await waitFor(() => calls.length >= 2, "the queue update and move");
				assert.deepEqual(calls, [["updatePlayQueue", queueWith(2, { 1: "bmax" })], ["previous"]]);
			});

			test("MOVE_TO looks at the given index", async () => {
				track("emax", Quality.HiRes);
				move(4, "playQueue/MOVE_TO");
				await waitFor(() => calls.length >= 2, "the queue update and move");
				assert.deepEqual(calls, [["updatePlayQueue", queueWith(2, { 4: "emax" })], ["moveTo", 4]]);
			});

			test("moves without touching the queue past its end or for kept versions", async () => {
				// At the end there is no next element: the first and last elements have max versions, which must not be picked up instead
				PlayState.playQueue.currentIndex = 5;
				track("amax", Quality.HiRes);
				track("fmax", Quality.HiRes);
				move(undefined, "playQueue/MOVE_NEXT");
				// next() is the handler's last call, so nothing else can follow it
				await waitFor(() => calls.length, "the move");
				assert.deepEqual(calls, [["next"]]);

				calls.length = 0;
				PlayState.playQueue.currentIndex = 2;
				track("dmax", Quality.HiRes);
				settings.keepVersion = { d: "kept" };
				move(undefined, "playQueue/MOVE_NEXT");
			// next() is the handler's last call, so nothing else can follow it
			await waitFor(() => calls.length, "the move");
			assert.deepEqual(calls, [["next"]]);
		});
	});

	describe("before a media transition", () => {
		const [onPreMediaTransition] = listeners.onPreMediaTransition;

		test("queues the max version next while playing", async () => {
			track("bmax", Quality.HiRes);
			await onPreMediaTransition(tracks.b);
			assert.deepEqual(calls, [["pause"], ["playNext", "bmax"], ["play"]]);
		});

		test("does not touch playback while paused", async () => {
			PlayState.playing = false;
			track("bmax", Quality.HiRes);
			await onPreMediaTransition(tracks.b);
			assert.deepEqual(calls, []);
		});

		test("prefetches the max version of the next item", async () => {
			const looked: string[] = [];
			PlayState.nextMediaItem = async () => ({ max: async () => (looked.push("next"), undefined) });
			await onPreMediaTransition(tracks.b);
			assert.deepEqual(looked, ["next"]);
		});
	});

	describe("on preload", () => {
		const [onPreload] = listeners.onPreload;

		test("prefetches the max version of the preloaded item", async () => {
			const looked: string[] = [];
			await onPreload({ max: async () => (looked.push("preloaded"), undefined) });
			assert.deepEqual(looked, ["preloaded"]);
		});
	});

	describe("playlist builder", () => {
		// contextMenu.ts loads before exclusions.ts, so its button and handler are the first ones
		const [onMediaItem] = contextMenu.onMediaItem;
		const [maxButton] = contextMenu.buttons;
		const collection = (items: any[], title = "Mix") => ({
			count: async () => items.filter(({ contentType }) => contentType === "track").length,
			title: async () => title,
			mediaItems: async () =>
				(async function* () {
					yield* items;
				})(),
		});

		test("shows nothing for an empty collection", async () => {
			maxButton.text = undefined;
			await onMediaItem({ mediaCollection: collection([]), contextMenu: {} });
			assert.equal(maxButton.text, undefined);
		});

		test("creates a [RealMAX] playlist with the max versions, keeping tracks without one", async (t) => {
			// Only the middle track has a better version, so a replacement must stay in its place
			track("bmax", Quality.HiRes);
			const create = t.mock.method(Playlist, "create", async () => undefined);
			await onMediaItem({ mediaCollection: collection([tracks.a, tracks.b, tracks.c]), contextMenu: {} });
			assert.equal(maxButton.text, "RealMAX 3 tracks");
			await maxButton.click!();
			assert.equal(create.mock.callCount(), 1);
			const [title, opts] = <[string, any]>create.mock.calls[0].arguments;
			assert.equal(title, "[RealMAX] Mix");
			assert.deepEqual(
				opts.mediaItems.map(({ id }: any) => id),
				["a", "bmax", "c"],
			);
			assert.equal(maxButton.text, "RealMAX 3 tracks");
		});

		test("does not trace a Found replacement popup for each track when displayInfoPopups is on", async (t) => {
			settings.displayInfoPopups = true;
			track("amax", Quality.HiRes);
			track("bmax", Quality.HiRes);
			const create = t.mock.method(Playlist, "create", async () => undefined);
			await onMediaItem({ mediaCollection: collection([tracks.a, tracks.b]), contextMenu: {} });
			await maxButton.click!();
			assert.equal(create.mock.callCount(), 1);
			assert.deepEqual(
				traced.filter(({ level, args }) => level === "msg.log" && String(args[0]).startsWith("Found replacement")),
				[],
			);
		});

		test("creates no playlist when nothing has a better version", async (t) => {
			const create = t.mock.method(Playlist, "create", async () => undefined);
			await onMediaItem({ mediaCollection: collection([tracks.a]), contextMenu: {} });
			await maxButton.click!();
			assert.equal(create.mock.callCount(), 0);
			assert.deepEqual(traced.find(({ level }) => level === "msg.err")?.args, ["No replacements found for Mix"]);
		});

		test("ignores a second click while a playlist is being made", async (t) => {
			track("amax", Quality.HiRes);
			const finish: (() => void)[] = [];
			const create = t.mock.method(Playlist, "create", () => new Promise<void>((res) => void finish.push(res)));
			await onMediaItem({ mediaCollection: collection([tracks.a]), contextMenu: {} });
			const settled = (click: Promise<unknown>) => {
				const state = { done: false, click };
				const done = () => void (state.done = true);
				void click.then(done, done);
				return state;
			};
			const first = settled(maxButton.click!());
			await waitFor(() => create.mock.callCount(), "the first playlist create");
			// The second click returns at once without a create of its own. Bounded waits: if it went on to create, it
			// would wait on that create forever, so this fails instead of hanging
			const second = settled(maxButton.click!());
			try {
				await waitFor(() => second.done, "the second click to return");
				assert.equal(create.mock.callCount(), 1);
			} finally {
				for (const res of finish) res();
			}
			await waitFor(() => first.done, "the first click to finish");
			await first.click;
			assert.equal(create.mock.callCount(), 1);
		});
	});
});
