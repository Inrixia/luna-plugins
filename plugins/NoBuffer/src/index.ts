import { asyncDebounce } from "@inrixia/helpers";
import { Tracer, type LunaUnload } from "@luna/core";
import { MediaItem, PlayState, type redux } from "@luna/lib";

import { voidTrack } from "./voidTrack.native";

export const { trace, errSignal } = Tracer("[NoBuffer]");

const kickCache = new Set<redux.ItemId>();
const onStalled = asyncDebounce(async () => {
	const mediaItem = await MediaItem.fromPlaybackContext();
	if (mediaItem === undefined || kickCache.has(mediaItem.id)) return;
	kickCache.add(mediaItem.id);
	trace.msg.log(`Playback stalled... Kicking tidal CDN!`);
	const playbackInfo = await mediaItem.playbackInfo().catch(trace.err.withContext("playbackInfo"));
	if (playbackInfo === undefined) return;
	await voidTrack(playbackInfo).catch(trace.err.withContext("voidTrack"));
});

export const unloads = new Set<LunaUnload>();
PlayState.onState(unloads, (state) => {
	if (state === "STALLED") onStalled();
});
