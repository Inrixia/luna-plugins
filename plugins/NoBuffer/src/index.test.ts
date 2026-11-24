// Run: pnpm exec tsx --test plugins/NoBuffer/src/index.test.ts
// Covers: index.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { beforeEach, describe, test } from "node:test";

const flush = async () => {
	for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));
};

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("NoBuffer", async () => {
	const { native } = await import("../../../test/stubs/lunaLibNative");
	const { listeners, MediaItem } = await import("../../../test/stubs/lunaLib");
	const { traced } = await import("../../../test/stubs/lunaCore");
	const { voidTrack } = await import("./voidTrack.native");
	await import("./index");
	const [onState] = listeners.onState;

	beforeEach(() => {
		traced.length = 0;
	});

	describe("voidTrack", () => {
		test("downloads the whole stream for the playback info and throws the data away", async (t) => {
			let read = 0;
			const fetchStream = t.mock.method(native, "fetchMediaItemStream", async () =>
				Readable.from(
					(function* () {
						for (let i = 0; i < 5; i++) yield (read++, Buffer.alloc(1024));
					})(),
				),
			);
			const playbackInfo = { trackId: 1 };
			await voidTrack(<any>playbackInfo);
			assert.equal(read, 5);
			assert.deepEqual(fetchStream.mock.calls[0].arguments, [playbackInfo]);
		});

		test("rejects when the stream errors", async (t) => {
			t.mock.method(native, "fetchMediaItemStream", async () =>
				Readable.from(
					(function* () {
						yield Buffer.alloc(1);
						throw new Error("connection reset");
					})(),
				),
			);
			await assert.rejects(voidTrack(<any>{}), /connection reset/);
		});

		test("can run again after a finished run (each run gets its own sink)", async (t) => {
			t.mock.method(native, "fetchMediaItemStream", async () => Readable.from([Buffer.alloc(1)]));
			await voidTrack(<any>{});
			await voidTrack(<any>{});
		});
	});

	describe("on stalled playback", () => {
		const item = (id: number, playbackInfo: () => Promise<unknown> = async () => ({ id })): any => ({ id, playbackInfo });

		test("downloads the playing track once to kick the CDN, and not again for the same track", async (t) => {
			const fetchStream = t.mock.method(native, "fetchMediaItemStream", async () => Readable.from([Buffer.alloc(1)]));
			t.mock.method(MediaItem, "fromPlaybackContext", async () => item(1));
			onState("STALLED");
			await flush();
			onState("STALLED");
			await flush();
			assert.equal(fetchStream.mock.callCount(), 1);
			assert.deepEqual(fetchStream.mock.calls[0].arguments, [{ id: 1 }]);
			assert.equal(traced.filter(({ level }) => level === "msg.log").length, 1);
		});

		test("ignores other playback states", async (t) => {
			const fetchStream = t.mock.method(native, "fetchMediaItemStream", async () => Readable.from([]));
			t.mock.method(MediaItem, "fromPlaybackContext", async () => item(2));
			onState("PLAYING");
			onState("IDLE");
			await flush();
			assert.equal(fetchStream.mock.callCount(), 0);
		});

		test("logs and gives up when the playback info can't be loaded", async (t) => {
			const fetchStream = t.mock.method(native, "fetchMediaItemStream", async () => Readable.from([]));
			t.mock.method(MediaItem, "fromPlaybackContext", async () =>
				item(3, async () => {
					throw new Error("401");
				}),
			);
			onState("STALLED");
			await flush();
			assert.equal(fetchStream.mock.callCount(), 0);
			assert.ok(traced.some(({ level, context }) => level === "err" && context === "playbackInfo"));
		});

		test("does nothing when nothing is playing", async (t) => {
			const fetchStream = t.mock.method(native, "fetchMediaItemStream", async () => Readable.from([]));
			t.mock.method(MediaItem, "fromPlaybackContext", async () => undefined);
			onState("STALLED");
			await flush();
			assert.equal(fetchStream.mock.callCount(), 0);
		});
	});
});
