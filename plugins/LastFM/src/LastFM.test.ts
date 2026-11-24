// Run: pnpm exec tsx --test plugins/LastFM/src/LastFM.test.ts
// Covers: LastFM.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beforeEach, describe, test, type TestContext } from "node:test";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const flush = async () => {
	for (let i = 0; i < 3; i++) await new Promise((res) => setImmediate(res));
};

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("LastFM", async () => {
	const { moduleProperties } = await import("../../../test/stubs/lunaCore");
	// Read by LastFM's static initialiser
	moduleProperties.lastFmApiKey = "KEY";
	moduleProperties.lastFmSecret = "SECRET";

	const { storage } = await import("../../../test/stubs/Settings");
	const { native } = await import("../../../test/stubs/lunaLibNative");
	const { hash } = await import("./hash.native");
	const { LastFM } = await import("./LastFM");

	const requests: URLSearchParams[] = [];
	/** Answers every Last.fm request with `answer(params)`, recording the form-encoded params */
	const mockApi = (t: TestContext, answer: (params: URLSearchParams) => unknown = () => ({})) =>
		t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
			assert.equal(url, "https://ws.audioscrobbler.com/2.0/");
			assert.equal(init.method, "POST");
			assert.deepEqual(init.headers, { "Content-type": "application/x-www-form-urlencoded", "Accept-Charset": "utf-8" });
			const params = new URLSearchParams(<string>init.body);
			requests.push(params);
			return Response.json(answer(params));
		});

	beforeEach(() => {
		requests.length = 0;
		storage.session = { name: "user", key: "SK", subscriber: 0 };
	});

	describe("hash", () => {
		test("is an md5 hex digest of the utf8 string by default", () => {
			assert.equal(hash("abc"), "900150983cd24fb0d6963f7d28e17f72");
			assert.equal(hash("é"), md5("é"));
		});

		test("takes another algorithm and digest encoding", () => {
			assert.equal(hash("abc", { algorithm: "sha1", digestEncoding: "base64" }), createHash("sha1").update("abc").digest("base64"));
		});
	});

	describe("requests", () => {
		test("scrobble sends the options with method, api key, session key, json format and a signature", async (t) => {
			mockApi(t);
			await LastFM.scrobble({ track: "Song", artist: "Artist", timestamp: "100" });
			const params = Object.fromEntries(requests[0]);
			const sig = md5("api_keyKEY" + "artistArtist" + "methodtrack.scrobble" + "skSK" + "timestamp100" + "trackSong" + "SECRET");
			assert.deepEqual(params, {
				track: "Song",
				artist: "Artist",
				timestamp: "100",
				sk: "SK",
				method: "track.scrobble",
				api_key: "KEY",
				format: "json",
				api_sig: sig,
			});
		});

		test("signs the params sorted by key, leaving out format", async (t) => {
			mockApi(t);
			await LastFM.updateNowPlaying({ track: "T", artist: "A", album: "Al", albumArtist: "AA", duration: "200", trackNumber: "4" });
			const params = requests[0];
			const signed = [...params.keys()]
				.filter((key) => key !== "format" && key !== "api_sig")
				.sort()
				.map((key) => key + params.get(key))
				.join("");
			assert.equal(params.get("api_sig"), md5(signed + "SECRET"));
			assert.equal(params.get("method"), "track.updateNowPlaying");
		});

		test("replaces Unicode hyphens with '-' in track, artist, album and album artist, but not dashes or other fields", async (t) => {
			mockApi(t);
			await LastFM.updateNowPlaying({
				track: "Re‐Make",
				artist: "Jay‑Z",
				album: "A – B",
				albumArtist: "x‐y",
				context: "c‐d",
			});
			const params = requests[0];
			assert.equal(params.get("track"), "Re-Make");
			assert.equal(params.get("artist"), "Jay-Z");
			assert.equal(params.get("album"), "A – B");
			assert.equal(params.get("albumArtist"), "x-y");
			assert.equal(params.get("context"), "c‐d");
		});

		test("does not change the options object it was given", async (t) => {
			mockApi(t);
			const opts = { track: "a‐b", artist: "A", timestamp: "1" };
			await LastFM.scrobble(opts);
			assert.deepEqual(opts, { track: "a‐b", artist: "A", timestamp: "1" });
		});

		test("returns the response data", async (t) => {
			mockApi(t, () => ({ scrobbles: { "@attr": { accepted: 1 } } }));
			assert.deepEqual(await LastFM.scrobble({ track: "T", artist: "A", timestamp: "1" }), { scrobbles: { "@attr": { accepted: 1 } } });
		});

		test("rejects with Last.fm's message when the response has one", async (t) => {
			mockApi(t, () => ({ error: 9, message: "Invalid session key" }));
			await assert.rejects(LastFM.scrobble({ track: "T", artist: "A", timestamp: "1" }), /Invalid session key/);
		});

		test("rejects without a request when there is no session", async (t) => {
			mockApi(t);
			delete storage.session;
			await assert.rejects(LastFM.updateNowPlaying({ track: "T", artist: "A" }), /Session not set/);
			assert.equal(requests.length, 0);
		});

		// Pins current behaviour: undefined options are sent as the string "undefined" (index.ts passes duration: undefined for unknown durations)
		test("sends an undefined option as the text 'undefined'", async (t) => {
			mockApi(t);
			await LastFM.updateNowPlaying({ track: "T", artist: "A", duration: undefined });
			assert.equal(requests[0].get("duration"), "undefined");
		});
	});

	describe("authenticate", () => {
		const authUrl = "https://www.last.fm/api/auth/?api_key=KEY&token=TOK";
		// window is globalThis in tests (test/hooks), give it an open() to mock
		(<any>globalThis).open ??= () => {};

		test("gets a token, opens and copies the auth url, then returns the session once the user confirms", async (t) => {
			const opened = t.mock.method(<any>globalThis, "open", () => {});
			const copied = t.mock.method(native, "clipboardWriteText", async () => {});
			let tries = 0;
			mockApi(t, (params) => {
				if (params.get("method") === "auth.getToken") return { token: "TOK" };
				return ++tries < 3 ? { message: "Unauthorized Token" } : { session: { name: "u", key: "NEW", subscriber: 0 } };
			});
			delete storage.session;
			t.mock.timers.enable({ apis: ["setTimeout"] });

			const result = LastFM.authenticate();
			for (let i = 0; i < 5; i++) {
				await flush();
				t.mock.timers.tick(1000);
			}
			assert.deepEqual(await result, { session: { name: "u", key: "NEW", subscriber: 0 } });

			assert.deepEqual(opened.mock.calls[0].arguments, [authUrl, "_blank"]);
			assert.deepEqual(copied.mock.calls[0].arguments, [authUrl]);
			// auth.* calls go without a session key, getSession carries the token
			assert.deepEqual(
				requests.map((params) => [params.get("method"), params.get("sk"), params.get("token")]),
				[["auth.getToken", null, null], ...Array(3).fill(["auth.getSession", null, "TOK"])],
			);
		});

		test("gives up after 10 tries", async (t) => {
			t.mock.method(<any>globalThis, "open", () => {});
			mockApi(t, (params) => (params.get("method") === "auth.getToken" ? { token: "TOK" } : { message: "Unauthorized Token" }));
			t.mock.timers.enable({ apis: ["setTimeout"] });

			const result = LastFM.authenticate();
			const rejected = assert.rejects(result, /Timed out waiting for user/);
			for (let i = 0; i < 12; i++) {
				await flush();
				t.mock.timers.tick(1000);
			}
			await rejected;
			assert.equal(requests.filter((params) => params.get("method") === "auth.getSession").length, 10);
		});
	});
});
