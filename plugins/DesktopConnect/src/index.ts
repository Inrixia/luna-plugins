import { LunaUnload, unloadSet } from "@luna/core";
import { ipcRenderer, MediaItem, PlayState, redux } from "@luna/lib";
import { send } from "./remoteService.native";

export * from "./remoteService.native";

export const unloads = new Set<LunaUnload>();

// #region From remote
// Remote commands come in bursts (prepare, seek and play at once) and loading the media is async,
// so run them one after another, otherwise seek, play or pause apply to the previous track or in the wrong order
let remoteCommands: Promise<unknown> = Promise.resolve();
const inOrder =
	<A extends unknown[]>(handler: (...args: A) => unknown) =>
	(...args: A) => {
		// A failed command must not block the ones after it
		remoteCommands = remoteCommands.then(() => handler(...args)).catch(() => {});
	};
// Tidal ignores pause while it is still loading an item and starts playing once loaded,
// so a pause from the remote in that time is applied when it starts playing
let loadingMedia = false;
let pauseWhenLoaded = false;
let loadingTimeout: ReturnType<typeof setTimeout> | undefined;
unloads.add(() => clearTimeout(loadingTimeout));
const loadRemoteMedia = async (mediaId: string, mediaType?: number) => {
	const mediaItem = await MediaItem.fromId(mediaId, mediaType === 1 ? "video" : "track");
	if (mediaItem === undefined) return false;
	loadingMedia = true;
	pauseWhenLoaded = false;
	clearTimeout(loadingTimeout);
	loadingTimeout = setTimeout(() => (loadingMedia = false), 5000);
	// Replace the local queue with only this item, otherwise Tidal moves on to its own next queue item
	// when the track ends (without ENDED), so the remote is never told and the desktop plays a track the remote does not know about.
	// The remote sends the id as a string, Tidal keeps the item's own (number) id in its queue
	const loaded = nextAction("playbackControls/MEDIA_PRODUCT_TRANSITION");
	redux.actions["playQueue/ADD_NOW"]({ context: { type: "UNKNOWN" }, mediaItemIds: [mediaItem.tidalItem?.id ?? mediaItem.id] });
	startSession();
	// The next commands (seek) must apply to the new item, so wait until Tidal switched to it
	await loaded;
	return true;
};
// Resolves with the next payload of the action, or undefined after a timeout
const nextAction = <T extends redux.ActionType>(actionType: T, timeoutMs = 5000) => {
	const waitUnloads = new Set<LunaUnload>();
	return Promise.race([redux.interceptPromise(actionType, waitUnloads), new Promise<undefined>((resolve) => setTimeout(resolve, timeoutMs))]).finally(() =>
		unloadSet(waitUnloads),
	);
};
ipcRenderer.on(
	unloads,
	"remote.desktop.notify.media.changed",
	inOrder(async ({ mediaId, mediaType }) => {
		if (await loadRemoteMedia(mediaId, mediaType)) PlayState.play();
		send({ command: "onRequestNextMedia", type: "media" });
	}),
);
// Newer remotes (Tidal Android) send prepare instead of notifyMediaChanged and no session state, then seek and play
ipcRenderer.on(
	unloads,
	"remote.desktop.play.media",
	inOrder(({ mediaId, mediaType }) => loadRemoteMedia(mediaId, mediaType)),
);
ipcRenderer.on(unloads, "remote.desktop.prefetch", ({ mediaId, mediaType }) => {
	redux.actions["player/PRELOAD_ITEM"]({ productId: mediaId, productType: mediaType === 0 ? "track" : "video" });
});
ipcRenderer.on(unloads, "remote.desktop.seek", inOrder((time: number) => PlayState.seek(time / 1000)));
ipcRenderer.on(
	unloads,
	"remote.desktop.play",
	inOrder(() => {
		pauseWhenLoaded = false;
		PlayState.play();
	}),
);
ipcRenderer.on(
	unloads,
	"remote.desktop.pause",
	inOrder(() => {
		PlayState.pause();
		pauseWhenLoaded = loadingMedia;
	}),
);
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
ipcRenderer.on(unloads, "remote.desktop.notify.session.state", (state) => {
	if (state === 0) return unloadSet(sessionUnloads);
	startSession();
});
// Newer remotes only send stop when they disconnect, so end the session there too or the intercepts keep blocking local playback
ipcRenderer.on(
	unloads,
	"remote.desktop.stop",
	inOrder(() => {
		if (sessionUnloads.size === 0) return;
		PlayState.pause();
		unloadSet(sessionUnloads);
	}),
);
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
		if (state === "PLAYING") {
			loadingMedia = false;
			if (pauseWhenLoaded) {
				pauseWhenLoaded = false;
				setTimeout(() => PlayState.pause());
			}
		}
		switch (state) {
			case "IDLE":
				return send({ command: "onStatusUpdated", playerState: "idle", type: "media" });
			case "NOT_PLAYING":
				return send({ command: "onStatusUpdated", playerState: "paused", type: "media" });
			case "PLAYING":
				return send({ command: "onStatusUpdated", playerState: "playing", type: "media" });
			case "STALLED":
				return send({ command: "onStatusUpdated", playerState: "buffering", type: "media" });
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
