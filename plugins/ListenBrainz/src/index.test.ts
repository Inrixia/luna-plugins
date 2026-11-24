// Run: pnpm exec tsx --test plugins/ListenBrainz/src/index.test.ts
// Covers: index.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { waitFor } from "../../../test/waitFor";

const fakeItem = (): any => ({
	title: async () => "Song",
	artist: async () => ({ name: "Artist" }),
	album: async () => undefined,
	brainzId: async () => undefined,
	isrc: async () => undefined,
});
/** Lets pending async work settle, only before checking that nothing happened */
const flush = async () => {
	for (let i = 0; i < 3; i++) await new Promise((res) => setImmediate(res));
};

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("ListenBrainz plugin", async () => {
	const { traced } = await import("../../../test/stubs/lunaCore");
	const { listeners } = await import("../../../test/stubs/lunaLib");
	const { storage } = await import("../../../test/stubs/Settings");
	const { ListenBrainz } = await import("./ListenBrainz");
	await import("./index");

	const [onMediaTransition] = listeners.onMediaTransition;
	const [onScrobble] = listeners.onScrobble;

	beforeEach(() => {
		storage.scrobbling = true;
		traced.length = 0;
	});

	test("sends now playing on a media transition and a listen on scrobble", async (t) => {
		const nowPlaying = t.mock.method(ListenBrainz, "updateNowPlaying", async () => new Response());
		const scrobble = t.mock.method(ListenBrainz, "scrobble", async () => new Response());
		onMediaTransition(fakeItem());
		onScrobble(fakeItem());
		await waitFor(() => nowPlaying.mock.callCount() && scrobble.mock.callCount(), "now playing and the listen");
		assert.equal(nowPlaying.mock.calls[0].arguments[0]!.track_metadata.track_name, "Song");
		assert.equal(scrobble.mock.calls[0].arguments[0]!.track_metadata.artist_name, "Artist");
	});

	test("does nothing while scrobbling is turned off", async (t) => {
		storage.scrobbling = false;
		const nowPlaying = t.mock.method(ListenBrainz, "updateNowPlaying", async () => new Response());
		const scrobble = t.mock.method(ListenBrainz, "scrobble", async () => new Response());
		onMediaTransition(fakeItem());
		onScrobble(fakeItem());
		await flush();
		assert.equal(nowPlaying.mock.callCount() + scrobble.mock.callCount(), 0);
	});

	test("shows an error message when a request fails", async (t) => {
		t.mock.method(ListenBrainz, "scrobble", async () => {
			throw new Error("offline");
		});
		onScrobble(fakeItem());
		await waitFor(() => traced.length, "the error message");
		assert.deepEqual(
			traced.map(({ level, context }) => [level, context]),
			[["msg.err", "Failed to scrobble!"]],
		);
	});
});
