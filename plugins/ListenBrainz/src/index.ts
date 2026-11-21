import { Tracer, type LunaUnload } from "@luna/core";
import { MediaItem, PlayState } from "@luna/lib";

export const { trace, errSignal } = Tracer("[ListenBrainz]");

import { ListenBrainz } from "./ListenBrainz";
import { makeTrackPayload } from "./makeTrackPayload";
import { storage } from "./Settings";

export { setScrobbling, Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();
unloads.add(
	MediaItem.onMediaTransition(unloads, (mediaItem) => {
		if (!storage.scrobbling) return;
		// Not returned, so the emitter isn't held up by the request
		makeTrackPayload(mediaItem)
			.then(ListenBrainz.updateNowPlaying)
			.catch(trace.msg.err.withContext(`Failed to update NowPlaying!`));
	})
);
unloads.add(
	PlayState.onScrobble(unloads, (mediaItem) => {
		if (!storage.scrobbling) return;
		// Not returned, so the emitter isn't held up by the request
		makeTrackPayload(mediaItem)
			.then(ListenBrainz.scrobble)
			.catch(trace.msg.err.withContext(`Failed to scrobble!`));
	})
);
