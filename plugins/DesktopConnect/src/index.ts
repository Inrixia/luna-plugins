import { LunaUnload, Tracer, unloadSet } from "@luna/core";
import { ipcRenderer, MediaItem, PlayState, redux } from "@luna/lib";
import { send } from "./remoteService.native";

export * from "./remoteService.native";

export const unloads = new Set<LunaUnload>();
export const { trace } = Tracer("[DesktopConnect]");

// #region From remote
// Remote commands come in bursts (prepare, seek and play at once) and loading the media is async,
// so run them one after another, otherwise seek, play or pause apply to the previous track or in the wrong order
let remoteCommands: Promise<unknown> = Promise.resolve();
// Commands still queued when the plugin unloads must not run (they would start a session nothing unloads)
let unloaded = false;
unloads.add(() => (unloaded = true));
const inOrder =
	<A extends unknown[]>(handler: (...args: A) => unknown) =>
	(...args: A) => {
		remoteCommands = remoteCommands
			.then(() => (unloaded ? undefined : handler(...args)))
			// A failed command must not block the ones after it
			.catch(trace.err.withContext("remote command"));
	};
// Loading a video can take over 5s
const loadTimeoutMs = 10000;
// The remote's media is loaded without starting it and the remote sends play,
// until then Tidal reports the loaded item as STALLED, which must not show as buffering on the remote
let remotePaused = false;
// The media the remote last loaded, until it sends stop (before it changes the media or disconnects).
// Tidal Android sends notifyMediaChanged and then prepare for the same media, it is loaded only once
let loadedMedia: { mediaId: string; uid: string } | undefined;
// Set when the remote's media could not be loaded, so its seek and play do not apply to the previous track
let loadFailed = false;
const currentElement = () => PlayState.playQueue.elements[PlayState.playQueue.currentIndex];
// Tidal may play another id than the queued one (a newer version of the track), so compare the queue element
const isLoaded = (mediaId: string) => loadedMedia?.mediaId === mediaId && currentElement()?.uid === loadedMedia.uid;
const loadRemoteMedia = async (mediaId: string, mediaType?: number) => {
	// A hanging request must not hold up the remote's other commands (pause, stop) behind it, a failed one counts as not found
	const mediaItem = await withTimeout(MediaItem.fromId(mediaId, mediaType === 1 ? "video" : "track"), loadTimeoutMs).catch((err) => {
		trace.err.withContext("load remote media")(err);
		return undefined;
	});
	loadFailed = mediaItem === undefined;
	if (mediaItem === undefined) {
		PlayState.pause();
		send({ command: "onStatusUpdated", playerState: "idle", type: "media" });
		return false;
	}
	remotePaused = true;
	// Replace the local queue with only this item, otherwise Tidal moves on to its own next queue item
	// when the track ends (without ENDED), so the remote is never told and the desktop plays a track the remote does not know about.
	// Added to the emptied queue Tidal loads it without starting it and the remote sends play.
	// ADD_NOW would start it (and Tidal ignores a pause while it is still loading),
	// a queue RESET keeps the old audio when Tidal's saved player state has the same media
	let uid: string | undefined;
	// Only the switch to the added item, not a late one of the previous track
	const loaded = nextAction("playbackControls/MEDIA_PRODUCT_TRANSITION", loadTimeoutMs, () => uid !== undefined && currentElement()?.uid === uid);
	// Clearing the queue also resets repeat and shuffle.
	// Repeat one is not kept, the track would loop and the remote would never be told it ended
	const { repeatMode, shuffleModeEnabled } = PlayState.playQueue;
	redux.actions["playQueue/CLEAR_QUEUE"]();
	redux.actions["playQueue/SET_REPEAT_MODE"](repeatMode === redux.RepeatMode.One ? redux.RepeatMode.Off : repeatMode);
	if (shuffleModeEnabled) redux.actions["playQueue/ENABLE_SHUFFLE_MODE"]();
	// The remote sends the id as a string, Tidal keeps the item's own (number) id in its queue
	redux.actions["playQueue/ADD_NEXT"]({ context: { type: "UNKNOWN" }, mediaItemIds: [mediaItem.tidalItem?.id ?? mediaItem.id] });
	startSession();
	// The next commands (seek) must apply to the new item, so wait until Tidal switched to it.
	// If it did not switch, a prepare sent again loads it again
	uid = currentElement()?.uid;
	if ((await loaded) !== undefined && uid !== undefined) loadedMedia = { mediaId, uid };
	return true;
};
// Resolves undefined after the timeout
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number) => {
	let timeout: number | undefined;
	const timedOut = new Promise<undefined>((resolve) => {
		timeout = window.setTimeout(resolve, timeoutMs);
	});
	return Promise.race([promise, timedOut]).finally(() => clearTimeout(timeout));
};
// Resolves with the next (matching) payload of the action, or undefined after a timeout
const nextAction = <T extends redux.ActionType>(
	actionType: T,
	timeoutMs: number,
	matches: (payload: redux.InterceptPayload<T>) => boolean = () => true,
) => {
	const waitUnloads = new Set<LunaUnload>();
	const action = new Promise<redux.InterceptPayload<T>>((resolve) => {
		redux.intercept(actionType, waitUnloads, (payload) => {
			if (matches(payload)) resolve(payload);
		});
	});
	return withTimeout(action, timeoutMs).finally(() => unloadSet(waitUnloads));
};
ipcRenderer.on(
	unloads,
	"remote.desktop.notify.media.changed",
	inOrder(async ({ mediaId, mediaType, itemId }) => {
		// Newer remotes (Tidal Android, with an itemId) follow it with prepare and then play or pause,
		// and send it again for the loaded media without wanting it reloaded. Older remotes send no play
		const newer = itemId !== undefined;
		if (newer && isLoaded(mediaId)) return;
		const loaded = await loadRemoteMedia(mediaId, mediaType);
		send({ command: "onRequestNextMedia", type: "media" });
		if (loaded && !newer) play();
	}),
);
ipcRenderer.on(
	unloads,
	"remote.desktop.play.media",
	inOrder(({ mediaId, mediaType }) => !isLoaded(mediaId) && loadRemoteMedia(mediaId, mediaType)),
);
ipcRenderer.on(unloads, "remote.desktop.prefetch", ({ mediaId, mediaType }) => {
	redux.actions["player/PRELOAD_ITEM"]({ productId: mediaId, productType: mediaType === 0 ? "track" : "video" });
});
ipcRenderer.on(unloads, "remote.desktop.seek", inOrder((time: number) => !loadFailed && PlayState.seek(time / 1000)));
// Tidal ignores a pause until it really started playing, so a pause or stop sent while it starts is applied again once it plays.
// The commands after it do not wait for that, playback may never start
let pauseWhenPlaying = false;
const play = () => {
	if (loadFailed || PlayState.playing) return;
	remotePaused = false;
	pauseWhenPlaying = false;
	nextAction("playbackControls/SET_PLAYBACK_STATE", loadTimeoutMs, (state) => state === "PLAYING").then((state) => {
		if (state !== undefined && pauseWhenPlaying) PlayState.pause();
		pauseWhenPlaying = false;
	});
	PlayState.play();
};
const pause = () => {
	remotePaused = true;
	pauseWhenPlaying = true;
	PlayState.pause();
};
ipcRenderer.on(unloads, "remote.desktop.play", inOrder(play));
ipcRenderer.on(unloads, "remote.desktop.pause", inOrder(pause));
ipcRenderer.on(unloads, "remote.desktop.set.shuffle", PlayState.setShuffle.bind(PlayState));
ipcRenderer.on(unloads, "remote.desktop.set.repeat.mode", PlayState.setRepeatMode.bind(PlayState));
ipcRenderer.on(unloads, "remote.destop.set.volume.mute", ({ level, mute }: { level: number; mute: boolean }) => {
	redux.actions["playbackControls/SET_MUTE"](mute);
	redux.actions["playbackControls/SET_VOLUME"]({
		volume: Math.min(level * 100, 100),
	});
});
// #endregion

// #region To remote
// Using send from remoteService.native as its more consistent
const sessionUnloads = new Set<LunaUnload>();
// In order with the other commands, so a media load still running does not start the session again after it ended
ipcRenderer.on(
	unloads,
	"remote.desktop.notify.session.state",
	inOrder((state: number) => {
		if (state === 0) {
			endRemoteMedia();
			return unloadSet(sessionUnloads);
		}
		startSession();
	}),
);
// Newer remotes send stop before changing the media and when they disconnect (before session state 0),
// end the session there too or the intercepts keep blocking local playback if session state never comes
ipcRenderer.on(
	unloads,
	"remote.desktop.stop",
	inOrder(() => {
		endRemoteMedia();
		if (sessionUnloads.size === 0) return;
		pause();
		unloadSet(sessionUnloads);
	}),
);
function endRemoteMedia() {
	loadedMedia = undefined;
	loadFailed = false;
	remotePaused = false;
}
function startSession() {
	if (sessionUnloads.size !== 0) return;
	ipcRenderer.on(sessionUnloads, "client.playback.playersignal", ({ time }: { time: number }) => {
		send({
			command: "onProgressUpdated",
			duration: 0,
			progress: time * 1000,
			type: "media",
		});
	});
	redux.intercept("playbackControls/SET_PLAYBACK_STATE", sessionUnloads, (state) => {
		// Played locally
		if (state === "PLAYING") remotePaused = false;
		switch (state) {
			case "IDLE":
				return send({ command: "onStatusUpdated", playerState: "idle", type: "media" });
			case "NOT_PLAYING":
				return send({ command: "onStatusUpdated", playerState: "paused", type: "media" });
			case "PLAYING":
				return send({ command: "onStatusUpdated", playerState: "playing", type: "media" });
			case "STALLED":
				return send({ command: "onStatusUpdated", playerState: remotePaused ? "paused" : "buffering", type: "media" });
		}
	});
	redux.intercept("playbackControls/ENDED", sessionUnloads, ({ reason }) => {
		if (reason === "completed") send({ command: "onPlaybackCompleted", hasNextMedia: false, type: "media" });
		return true;
	});
	redux.intercept("playbackControls/SKIP_NEXT", sessionUnloads, () => {
		PlayState.pause();
		send({ command: "onStatusUpdated", playerState: "idle", type: "media" });
		send({ command: "onPlaybackCompleted", hasNextMedia: false, type: "media" });
		return true;
	});
}
unloads.add(() => unloadSet(sessionUnloads));
// #endregion
