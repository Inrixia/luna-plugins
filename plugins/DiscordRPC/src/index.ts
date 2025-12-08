import { Tracer, type LunaUnload } from "@luna/core";
import { MediaItem, redux } from "@luna/lib";

import { cleanupRPC } from "./discord.native";
import { updateActivity } from "./updateActivity";

export const unloads = new Set<LunaUnload>();
export const { trace, errSignal } = Tracer("[DiscordRPC]");
export { Settings } from "./Settings";

redux.intercept(["playbackControls/SEEK", "playbackControls/SET_PLAYBACK_STATE"], unloads, () => {
	updateActivity()
		.then(() => (errSignal!._ = undefined))
		.catch(trace.err.withContext("Failed to set activity"));
});
unloads.add(
	MediaItem.onMediaTransition(unloads, (mediaItem) => {
		updateActivity(mediaItem)
			.then(() => (errSignal!._ = undefined))
			.catch(trace.err.withContext("Failed to set activity"));
	})
);
unloads.add(cleanupRPC.bind(cleanupRPC));

setTimeout(updateActivity);
