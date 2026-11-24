// Run: pnpm exec tsx --test plugins/LastFM/src/index.test.ts
// Covers: index.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { waitFor } from "../../../test/waitFor";

const fakeItem = (opts: Record<string, any> = {}): any => ({
	title: async () => opts.title ?? "Song",
	artist: async () => ({ name: "Artist" }),
	album: async () =>
		opts.album === false
			? undefined
			: { title: async () => "Album", artist: async () => (opts.albumArtist ? { name: opts.albumArtist } : undefined) },
	trackNumber: opts.trackNumber,
	brainzId: async () => opts.brainzId,
	duration: opts.duration,
});
/** Lets pending async work settle, only before checking that nothing happened */
const flush = async () => {
	for (let i = 0; i < 3; i++) await new Promise((res) => setImmediate(res));
};

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("LastFM plugin", async () => {
	const { moduleProperties, traced } = await import("../../../test/stubs/lunaCore");
	moduleProperties.lastFmApiKey = "KEY";
	moduleProperties.lastFmSecret = "SECRET";
	const { listeners, dispatched } = await import("../../../test/stubs/lunaLib");
	const { storage } = await import("../../../test/stubs/Settings");
	const { LastFM } = await import("./LastFM");
	await import("./index");

	const [onMediaTransition] = listeners.onMediaTransition;
	const [onScrobble] = listeners.onScrobble;

	beforeEach(() => {
		storage.scrobbling = true;
		traced.length = 0;
	});

	test("disconnects TIDAL's own Last.fm scrobbler on load", () => {
		assert.ok(dispatched.some(({ type }) => type === "lastFm/DISCONNECT"));
	});

	test("updates now playing on a media transition, with the duration rounded to whole seconds", async (t) => {
		t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_400 });
		const update = t.mock.method(LastFM, "updateNowPlaying", async () => ({}));
		onMediaTransition(fakeItem({ duration: 215.6, trackNumber: 3, brainzId: "mbid", albumArtist: "VA" }));
		await waitFor(() => update.mock.callCount(), "updateNowPlaying");
		assert.deepEqual(update.mock.calls[0].arguments, [
			{
				track: "Song",
				artist: "Artist",
				album: "Album",
				albumArtist: "VA",
				trackNumber: "3",
				mbid: "mbid",
				timestamp: "1700000000",
				duration: "216",
			},
		]);
	});

	test("scrobbles without a duration and drops unknown fields", async (t) => {
		t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_600 });
		const scrobble = t.mock.method(LastFM, "scrobble", async () => ({}));
		await onScrobble(fakeItem({ duration: 100, album: false }));
		assert.deepEqual(scrobble.mock.calls[0].arguments, [{ track: "Song", artist: "Artist", timestamp: "1700000001" }]);
	});

	test("does nothing while scrobbling is turned off", async (t) => {
		storage.scrobbling = false;
		const update = t.mock.method(LastFM, "updateNowPlaying", async () => ({}));
		const scrobble = t.mock.method(LastFM, "scrobble", async () => ({}));
		onMediaTransition(fakeItem());
		await onScrobble(fakeItem());
		await flush();
		assert.equal(update.mock.callCount(), 0);
		assert.equal(scrobble.mock.callCount(), 0);
	});

	test("shows an error message when a request fails", async (t) => {
		t.mock.method(LastFM, "updateNowPlaying", async () => {
			throw new Error("offline");
		});
		onMediaTransition(fakeItem());
		await waitFor(() => traced.length, "the error message");
		assert.deepEqual(
			traced.map(({ level, context }) => [level, context]),
			[["msg.err", "Failed to updateNowPlaying!"]],
		);
	});
});
