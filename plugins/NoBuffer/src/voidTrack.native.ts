import type { PlaybackInfo } from "@luna/lib";
import { fetchMediaItemStream } from "@luna/lib.native";
import { Writable } from "stream";
import { pipeline } from "stream/promises";

export const voidTrack = async (playbackInfo: PlaybackInfo): Promise<void> => {
	const stream = await fetchMediaItemStream(playbackInfo);
	// A fresh sink each time, a shared one is ended by the first pipe. pipeline settles on "finish" or error.
	await pipeline(stream, new Writable({ write: (_, __, cb) => cb() }));
};
