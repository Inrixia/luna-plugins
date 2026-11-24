// Run: pnpm exec tsx --test plugins/DiscordRPC/src/updateActivity.test.ts
// Covers: updateActivity.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test, type TestContext } from "node:test";
import { waitFor } from "../../../test/waitFor";

const NOW = 1_700_000_000_000;
/** Mocked time when the debounced update runs */
const SENT_AT = NOW + 300;

const fakeItem = (opts: { id?: number; artists?: string[]; duration?: number; album?: boolean; title?: string } = {}): any => {
	const artists = opts.artists ?? ["Artist A", "Artist B"];
	return {
		id: opts.id ?? 42,
		tidalItem: { contentType: "track" },
		duration: opts.duration,
		title: async () => opts.title ?? "Song",
		artist: async () => (artists.length === 0 ? undefined : { id: 7, name: artists[0], coverUrl: (res: string) => `artist-cover-${res}` }),
		artists: async () => artists.map(async (name) => ({ name })),
		album: async () => (opts.album === false ? undefined : { id: 99, title: async () => "Album", coverUrl: () => "album-cover" }),
	};
};

/** Lets pending async work settle, only before checking that nothing (more) happened */
const flush = async () => {
	for (let i = 0; i < 3; i++) await new Promise((res) => setImmediate(res));
};

describe("DiscordRPC updateActivity", async () => {
	const { settings } = await import("../../../test/stubs/Settings");
	const { activities, discord } = await import("../../../test/stubs/discordNative");
	const { PlayState, redux, MediaItem } = await import("../../../test/stubs/lunaLib");
	const { traced } = await import("../../../test/stubs/lunaCore");
	const { errSignal } = await import("../../../test/stubs/discordIndex");
	const { updateActivity } = await import("./updateActivity");

	/**
	 * Calls updateActivity, lets its 300ms debounce run, then waits until `done()` is truthy, or for a fixed flush when `done` is undefined (to check nothing was sent).
	 * Returns what was sent to Discord.
	 */
	const runUntil = async (t: TestContext, done: (() => unknown) | undefined, ...calls: (unknown | undefined)[]) => {
		t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
		for (const mediaItem of calls) updateActivity(<any>mediaItem);
		t.mock.timers.tick(299);
		await flush();
		const before = activities.length;
		t.mock.timers.tick(1);
		if (done === undefined) await flush();
		else await waitFor(done, "the activity update");
		return { sentBeforeDebounce: before, sent: activities.splice(0) };
	};
	/** runUntil something was sent to Discord */
	const run = (t: TestContext, ...calls: (unknown | undefined)[]) => runUntil(t, () => activities.length, ...calls);

	beforeEach(() => {
		activities.length = 0;
		traced.length = 0;
		Object.assign(settings, {
			displayOnPause: true,
			displayArtistIcon: true,
			displayPlaylistButton: true,
			customStatusText: "{track} by {artist}",
			pipeId: 3,
		});
		Object.assign(PlayState, { playing: true, playTime: 10 });
		redux.store.state = {
			playQueue: { sourceUrl: "/playlist/abc", sourceEntityId: "abc", sourceEntityType: "playlist" },
			content: { playlists: { abc: { publicPlaylist: true } } },
		};
		discord.setActivity = async (activity: unknown, pipeId: number = -1) => void activities.push({ activity, pipeId });
	});

	test("builds a Listening activity with links, artist, album and timestamps while playing", async (t) => {
		const { sent } = await run(t, fakeItem({ duration: 200 }));
		assert.equal(sent.length, 1);
		assert.equal(sent[0].pipeId, 3);
		assert.deepEqual(sent[0].activity, {
			type: 2,
			buttons: [
				{ url: "https://tidal.com/track/42/u", label: "Play Song" },
				{ url: "https://tidal.com/browse/playlist/abc", label: "Playlist" },
			],
			name: "Song by Artist A, Artist B",
			details: "Song",
			detailsUrl: "https://tidal.com/track/42/u",
			state: "Artist A, Artist B",
			stateUrl: "https://tidal.com/artist/7/u",
			statusDisplayType: 0,
			smallImageKey: "artist-cover-320",
			smallImageText: "Artist A",
			smallImageUrl: "https://tidal.com/artist/7/u",
			startTimestamp: SENT_AT - 10_000,
			endTimestamp: SENT_AT - 10_000 + 200_000,
			largeImageKey: "album-cover",
			largeImageText: "Album",
			largeImageUrl: "https://tidal.com/album/99/u",
		});
	});

	test("waits 300ms after the last call and sends only the last media item", async (t) => {
		const { sentBeforeDebounce, sent } = await run(t, fakeItem({ id: 1 }), fakeItem({ id: 2 }), fakeItem({ id: 3 }));
		assert.equal(sentBeforeDebounce, 0);
		assert.equal(sent.length, 1);
		assert.equal((<any>sent[0].activity).detailsUrl, "https://tidal.com/track/3/u");
	});

	test("shows a paused icon and ends the timer now when paused", async (t) => {
		PlayState.playing = false;
		const activity = <any>(await run(t, fakeItem({ duration: 200 }))).sent[0].activity;
		assert.equal(activity.smallImageKey, "paused-icon");
		assert.equal(activity.smallImageText, "Paused");
		assert.equal(activity.endTimestamp, SENT_AT);
		assert.equal(activity.startTimestamp, undefined);
	});

	test("clears the activity when paused and displayOnPause is off", async (t) => {
		PlayState.playing = false;
		settings.displayOnPause = false;
		const { sent } = await run(t, fakeItem());
		assert.deepEqual(sent, [{ activity: undefined, pipeId: 3 }]);
	});

	test("has no playlist button for private playlists, non playlist sources, or when the setting is off", async (t) => {
		const playButtons = async () => (<any>(await run(t, fakeItem())).sent[0].activity).buttons.map((b: any) => b.label);

		redux.store.state.content.playlists.abc = { publicPlaylist: false, sharingLevel: "PRIVATE" };
		assert.deepEqual(await playButtons(), ["Play Song"]);
		t.mock.timers.reset();

		redux.store.state.content.playlists.abc = { sharingLevel: "PUBLIC" };
		assert.deepEqual(await playButtons(), ["Play Song", "Playlist"]);
		t.mock.timers.reset();

		redux.store.state.playQueue.sourceEntityType = "album";
		assert.deepEqual(await playButtons(), ["Play Song"]);
		t.mock.timers.reset();

		redux.store.state.playQueue.sourceEntityType = "playlist";
		settings.displayPlaylistButton = false;
		assert.deepEqual(await playButtons(), ["Play Song"]);
	});

	test("leaves out the artist icon when displayArtistIcon is off, and timestamps when the duration is unknown", async (t) => {
		settings.displayArtistIcon = false;
		const activity = <any>(await run(t, fakeItem())).sent[0].activity;
		assert.equal(activity.smallImageKey, undefined);
		assert.equal(activity.startTimestamp, undefined);
		assert.equal(activity.endTimestamp, undefined);
	});

	test("says Unknown Artist when the track has no artists, and has no large image without an album", async (t) => {
		const activity = <any>(await run(t, fakeItem({ artists: [], album: false }))).sent[0].activity;
		assert.equal(activity.state, "Unknown Artist");
		assert.equal(activity.stateUrl, "https://tidal.com/artist/undefined/u");
		assert.equal(activity.largeImageKey, undefined);
	});

	test("uses the playing media item when called without one, and sends nothing when nothing is playing", async (t) => {
		t.mock.method(MediaItem, "fromPlaybackContext", async () => fakeItem({ id: 5 }));
		assert.equal((<any>(await run(t, undefined)).sent[0].activity).detailsUrl, "https://tidal.com/track/5/u");
		t.mock.timers.reset();

		t.mock.method(MediaItem, "fromPlaybackContext", async () => undefined);
		assert.deepEqual((await runUntil(t, undefined, undefined)).sent, []);
	});

	test("logs a failed update and clears the error signal after the next successful one", async (t) => {
		discord.setActivity = async () => {
			throw new Error("pipe closed");
		};
		await runUntil(t, () => traced.length, fakeItem());
		assert.equal(traced.at(-1)?.context, "Failed to set activity");
		assert.equal((<Error>traced.at(-1)?.args[0]).message, "pipe closed");
		t.mock.timers.reset();

		errSignal._ = "error";
		discord.setActivity = async () => {};
		await runUntil(t, () => errSignal._ === undefined, fakeItem());
		assert.equal(errSignal._, undefined);
	});

	test("queues a call made during an update and runs it after the update finishes", async (t) => {
		let release!: () => void;
		const sent: number[] = [];
		discord.setActivity = async (activity: any) => {
			sent.push(activity.detailsUrl);
			if (sent.length === 1) await new Promise<void>((res) => (release = res));
		};
		t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
		updateActivity(fakeItem({ id: 1 }));
		t.mock.timers.tick(300);
		await waitFor(() => sent.length, "the first update");
		// First update is stuck in setActivity, these are queued, only the last one is kept
		updateActivity(fakeItem({ id: 2 }));
		updateActivity(fakeItem({ id: 3 }));
		t.mock.timers.tick(1000);
		await flush();
		assert.deepEqual(sent, ["https://tidal.com/track/1/u"]);

		release();
		// The queued call starts its debounce once the first update has finished, so keep moving the clock until it has been sent
		await waitFor(() => sent.length === 2 || void t.mock.timers.tick(300), "the queued update");
		assert.deepEqual(sent, ["https://tidal.com/track/1/u", "https://tidal.com/track/3/u"]);
	});
});
