import { LunaUnload, unloadSet } from "@luna/core";
import { ipcRenderer, MediaItem, PlayState, redux } from "@luna/lib";
import { send } from "./remoteService.native";

export * from "./remoteService.native";

export const unloads = new Set<LunaUnload>();

// #region From remote
const loadRemoteMedia = async (mediaId: string) => {
	const mediaItem = await MediaItem.fromId(mediaId);
	if (mediaItem === undefined) return false;
	// Replace the local queue with only this item, otherwise Tidal moves on to its own next queue item
	// when the track ends (without ENDED), so the remote is never told and the desktop plays a track the remote does not know about
	redux.actions["playQueue/ADD_NOW"]({ context: { type: "UNKNOWN" }, mediaItemIds: [mediaItem.id] });
	return true;
};
ipcRenderer.on(unloads, "remote.desktop.notify.media.changed", async ({ mediaId }) => {
	if (await loadRemoteMedia(mediaId)) {
		startSession();
		PlayState.play();
	}
	send({ command: "onRequestNextMedia", type: "media" });
});
// Newer remotes (Tidal Android) send prepare instead of notifyMediaChanged and no session state, then seek and play right away,
// so seek and play wait for the media to be loaded, otherwise they apply to the previous track
let loadingMedia: Promise<unknown> = Promise.resolve();
ipcRenderer.on(unloads, "remote.desktop.play.media", ({ mediaId }) => {
	// A failed load must not block later seek and play
	loadingMedia = loadRemoteMedia(mediaId)
		.then((loaded) => loaded && startSession())
		.catch(() => {});
});
ipcRenderer.on(unloads, "remote.desktop.prefetch", ({ mediaId, mediaType }) => {
	redux.actions["player/PRELOAD_ITEM"]({ productId: mediaId, productType: mediaType === 0 ? "track" : "video" });
});
ipcRenderer.on(unloads, "remote.desktop.seek", (time: number) => loadingMedia.then(() => PlayState.seek(time / 1000)));
ipcRenderer.on(unloads, "remote.desktop.play", () => loadingMedia.then(() => PlayState.play()));
ipcRenderer.on(unloads, "remote.desktop.pause", PlayState.pause.bind(PlayState));
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
ipcRenderer.on(unloads, "remote.desktop.stop", () => {
	if (sessionUnloads.size === 0) return;
	PlayState.pause();
	unloadSet(sessionUnloads);
});
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
