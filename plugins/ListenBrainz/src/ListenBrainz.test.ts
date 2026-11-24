// Run: pnpm exec tsx --test plugins/ListenBrainz/src/ListenBrainz.test.ts
// Covers: ListenBrainz.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test, type TestContext } from "node:test";

const fakeItem = (opts: Record<string, any> = {}): any => ({
	title: async () => opts.title ?? "Song",
	artist: async () => ("artist" in opts ? opts.artist : { name: "Artist" }),
	album: async () => ("album" in opts ? opts.album : { title: async () => "Album" }),
	brainzId: async () => opts.brainzId,
	isrc: async () => opts.isrc,
	trackNumber: opts.trackNumber,
	url: opts.url,
	duration: opts.duration,
});

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("ListenBrainz", async () => {
	const { storage } = await import("../../../test/stubs/Settings");
	const { makeTrackPayload } = await import("./makeTrackPayload");
	const { ListenBrainz } = await import("./ListenBrainz");

	describe("makeTrackPayload", () => {
		test("fills track metadata and additional info, with listened_at in unix seconds", async (t) => {
			t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_999 });
			const payload = await makeTrackPayload(
				fakeItem({ brainzId: "mbid", isrc: "ISRC1", trackNumber: 3, url: "https://tidal.com/track/1", duration: 215 }),
			);
			assert.deepEqual(payload, {
				listened_at: 1_700_000_000,
				track_metadata: {
					artist_name: "Artist",
					track_name: "Song",
					release_name: "Album",
					additional_info: {
						recording_mbid: "mbid",
						isrc: "ISRC1",
						tracknumber: 3,
						music_service: "tidal.com",
						origin_url: "https://tidal.com/track/1",
						duration: 215,
						media_player: "Tidal Desktop",
						submission_client: "TidaLuna Scrobbler",
					},
				},
			});
		});

		test("drops additional info fields that are unknown instead of sending them as undefined", async () => {
			const info = (await makeTrackPayload(fakeItem())).track_metadata.additional_info!;
			assert.deepEqual(Object.keys(info).sort(), ["media_player", "music_service", "submission_client"]);
		});

		test("leaves release_name undefined for a track without an album", async () => {
			const payload = await makeTrackPayload(fakeItem({ album: undefined }));
			assert.equal(payload.track_metadata.release_name, undefined);
		});
	});

	describe("requests", () => {
		const calls: { url: string; init: RequestInit }[] = [];
		const mockFetch = (t: TestContext, status = 200) =>
			t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return new Response("{}", { status, statusText: status === 200 ? "OK" : "Unauthorized" });
			});

		beforeEach(() => {
			calls.length = 0;
			storage.domain = "https://api.listenbrainz.org";
			storage.userToken = "tok";
		});

		test("scrobble POSTs a single listen to <domain>/1/submit-listens with the user token", async (t) => {
			mockFetch(t);
			const payload = { listened_at: 1, track_metadata: { artist_name: "A", track_name: "T" } };
			await ListenBrainz.scrobble(payload);
			assert.equal(calls.length, 1);
			assert.equal(calls[0].url, "https://api.listenbrainz.org/1/submit-listens");
			assert.equal(calls[0].init.method, "POST");
			assert.deepEqual(calls[0].init.headers, {
				"Content-type": "application/json",
				Accept: "application/json",
				Authorization: "Token tok",
			});
			assert.deepEqual(JSON.parse(<string>calls[0].init.body), { listen_type: "single", payload: [payload] });
		});

		test("updateNowPlaying sends playing_now without listened_at", async (t) => {
			mockFetch(t);
			storage.domain = "https://lb.example";
			const payload: any = { listened_at: 5, track_metadata: { artist_name: "A", track_name: "T" } };
			await ListenBrainz.updateNowPlaying(payload);
			assert.equal(calls[0].url, "https://lb.example/1/submit-listens");
			assert.deepEqual(JSON.parse(<string>calls[0].init.body), {
				listen_type: "playing_now",
				payload: [{ track_metadata: { artist_name: "A", track_name: "T" } }],
			});
		});

		test("rejects with the HTTP status when the server answers with an error", async (t) => {
			mockFetch(t, 401);
			await assert.rejects(ListenBrainz.scrobble({ track_metadata: { artist_name: "A", track_name: "T" } }), /401 Unauthorized/);
		});

		test("rejects without a request when the user token is empty", async (t) => {
			mockFetch(t);
			storage.userToken = "";
			await assert.rejects(ListenBrainz.scrobble({ track_metadata: { artist_name: "A", track_name: "T" } }), /User token not set/);
			assert.equal(calls.length, 0);
		});

		// Pins current behaviour: only "" is rejected, a never set token (undefined) is sent as "Token undefined"
		test("still sends a request when the user token was never set", async (t) => {
			mockFetch(t);
			delete storage.userToken;
			await ListenBrainz.scrobble({ track_metadata: { artist_name: "A", track_name: "T" } });
			assert.equal((<any>calls[0].init.headers).Authorization, "Token undefined");
		});
	});
});
