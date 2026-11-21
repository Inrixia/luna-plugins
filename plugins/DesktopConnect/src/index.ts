import { LunaPlugin, LunaUnload, Tracer, unloadSet } from "@luna/core";
import { ipcRenderer, MediaItem, PlayState, redux } from "@luna/lib";
import { send } from "./remoteService.native";
import { storage } from "./Settings";

export * from "./remoteService.native";
export { Settings } from "./Settings";

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
// Set by a pause (from the remote or on the desktop) and while the remote's media is loaded but not started yet.
// Tidal then reports STALLED (loaded item, seek), which must show as paused on the remote, not buffering
let paused = false;
// The repeat mode the remote set (until it disconnects), kept when its media is loaded
let remoteRepeatMode: redux.RepeatMode | undefined;
// The media the remote last loaded, until it sends stop (before it changes the media or disconnects).
// Tidal Android sends notifyMediaChanged and then prepare for the same media, it is loaded only once
let loadedMedia: { mediaId: string; uid: string } | undefined;
// Set when the remote's media could not be loaded, so its seek and play do not apply to the previous track
let loadFailed = false;
// Tidal ignores a seek on a video it has not started yet (it loads it again on play and starts from the beginning),
// and sometimes does the same for a track loaded right after a video, so the remote's seek is applied again once it plays
let unstarted = false;
let remoteSeek: number | undefined;
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
	paused = true;
	unstarted = true;
	remoteSeek = undefined;
	stopPendingSeek?.();
	// Set here too, the session's intercept that follows Tidal's switches is added only after the first load
	playingVideo = mediaType === 1;
	// Replace the local queue with only this item, otherwise Tidal moves on to its own next queue item
	// when the track ends (without ENDED), so the remote is never told and the desktop plays a track the remote does not know about.
	// Added to the emptied queue Tidal loads it without starting it and the remote sends play.
	// ADD_NOW would start it (and Tidal ignores a pause while it is still loading),
	// a queue RESET keeps the old audio when Tidal's saved player state has the same media
	// Only the switch to the added item (its queue element), not a late one of the previous track
	const loaded = nextAction(
		"playbackControls/MEDIA_PRODUCT_TRANSITION",
		loadTimeoutMs,
		({ mediaProduct }) => mediaProduct.referenceId !== undefined && mediaProduct.referenceId === currentElement()?.uid,
	);
	// Clearing the queue also resets repeat and shuffle.
	// The desktop's own repeat one is not kept, the track would loop and the remote would never be told it ended
	const { repeatMode, shuffleModeEnabled } = PlayState.playQueue;
	redux.actions["playQueue/CLEAR_QUEUE"]();
	redux.actions["playQueue/SET_REPEAT_MODE"](remoteRepeatMode ?? (repeatMode === redux.RepeatMode.One ? redux.RepeatMode.Off : repeatMode));
	if (shuffleModeEnabled) redux.actions["playQueue/ENABLE_SHUFFLE_MODE"]();
	// The remote sends the id as a string, Tidal keeps the item's own (number) id in its queue
	redux.actions["playQueue/ADD_NEXT"]({ context: { type: "UNKNOWN" }, mediaItemIds: [mediaItem.tidalItem?.id ?? mediaItem.id] });
	const added = currentElement()?.uid;
	startSession();
	// The next commands (seek) must apply to the new item, so wait until Tidal switched to it.
	// If it takes too long it still counts as loaded, the remote's notify or prepare for it must not load it again
	const uid = (await loaded)?.mediaProduct.referenceId ?? added;
	if (uid !== undefined) loadedMedia = { mediaId, uid };
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
		// Older remotes re-send the loaded media too when they reconnect (eg after iOS suspends the app),
		// loading it again would restart the track from 0
		if (isLoaded(mediaId)) {
			if (!newer) send({ command: "onRequestNextMedia", type: "media" });
			return;
		}
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
ipcRenderer.on(
	unloads,
	"remote.desktop.seek",
	inOrder((time: number) => {
		if (loadFailed) return;
		if (unstarted) remoteSeek = time / 1000;
		// Still starting, Tidal may reset it to the beginning, so this seek replaces the one waiting
		else if (stopPendingSeek !== undefined) seekWhenPlaying(time / 1000);
		PlayState.seek(time / 1000);
	}),
);
// Tidal ignores a pause until it really started playing, so a pause or stop sent while it starts is applied again once it plays.
// The commands after it do not wait for that, playback may never start
let pauseWhenPlaying = false;
// A play from anywhere (also on the desktop) is newer than the remote's pause
redux.intercept("playbackControls/PLAY", unloads, () => {
	paused = false;
	pauseWhenPlaying = false;
});
redux.intercept("playbackControls/PAUSE", unloads, () => {
	paused = true;
});
const play = () => {
	if (loadFailed) return;
	paused = false;
	pauseWhenPlaying = false;
	// Tidal's desired state, it may not be playing yet
	if (PlayState.playing) return;
	nextAction("playbackControls/SET_PLAYBACK_STATE", loadTimeoutMs, (state) => state === "PLAYING").then((state) => {
		if (state !== undefined && pauseWhenPlaying && !unloaded) PlayState.pause();
		pauseWhenPlaying = false;
	});
	PlayState.play();
};
const pause = () => {
	pauseWhenPlaying = true;
	PlayState.pause();
};
ipcRenderer.on(unloads, "remote.desktop.play", inOrder(play));
ipcRenderer.on(unloads, "remote.desktop.pause", inOrder(pause));
const remoteRepeatModes = { OFF: redux.RepeatMode.Off, ALL: redux.RepeatMode.All, ONE: redux.RepeatMode.One } as const;
// In order, so a load running at the same time does not reset them
ipcRenderer.on(unloads, "remote.desktop.set.shuffle", inOrder(PlayState.setShuffle.bind(PlayState)));
ipcRenderer.on(
	unloads,
	"remote.desktop.set.repeat.mode",
	inOrder((mode: keyof typeof remoteRepeatModes | redux.RepeatMode) => {
		// Tidal Android sends the mode's name
		const repeatMode = typeof mode === "string" ? remoteRepeatModes[mode] : mode;
		if (repeatMode === undefined) return trace.warn("Unknown repeat mode", mode);
		remoteRepeatMode = repeatMode;
		PlayState.setRepeatMode(repeatMode);
	}),
);
ipcRenderer.on(unloads, "remote.destop.set.volume.mute", ({ level, mute }: { level: number; mute: boolean }) => {
	redux.actions["playbackControls/SET_MUTE"](mute);
	redux.actions["playbackControls/SET_VOLUME"]({
		volume: Math.min(level * 100, 100),
	});
});
// #endregion

// #region Scrobbling
// The controlling device can scrobble itself, so scrobblers are turned off for the session and restored after
type ScrobblerExports = { setScrobbling?: (enabled: boolean) => boolean };
// Each scrobbler's setScrobbling with the value to restore, while scrobbling is paused
const pausedScrobblers = new Map<string, { setScrobbling: (enabled: boolean) => boolean; previous: boolean }>();
// A session ends on every remote media change too, so a restore waiting for the next transition is cancelled by a new session
const restoreUnloads = new Set<LunaUnload>();
const restoreScrobbling = () => {
	unloadSet(restoreUnloads);
	for (const { setScrobbling, previous } of pausedScrobblers.values()) setScrobbling(previous);
	pausedScrobblers.clear();
};
const pauseScrobbling = (sessionUnloads: Set<LunaUnload>) => {
	unloadSet(restoreUnloads);
	for (const name of ["LastFM", "ListenBrainz"]) {
		if (pausedScrobblers.has(name)) continue;
		const setScrobbling = (LunaPlugin.getByName(name)?.exports as ScrobblerExports | undefined)?.setScrobbling;
		if (setScrobbling === undefined) continue;
		pausedScrobblers.set(name, { setScrobbling, previous: setScrobbling(false) });
	}
	// The last remote track is scrobbled on the next transition, after the session ended, so restore after that
	sessionUnloads.add(() => {
		if (pausedScrobblers.size !== 0) MediaItem.onMediaTransition(restoreUnloads, restoreScrobbling);
	});
};
unloads.add(restoreScrobbling);
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
			// Older remotes end the session without stop
			if (sessionUnloads.size !== 0) pause();
			unloadSet(sessionUnloads);
			endRemoteMedia();
			remoteRepeatMode = undefined;
			return;
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
		if (sessionUnloads.size !== 0) {
			pause();
			unloadSet(sessionUnloads);
		}
		endRemoteMedia();
	}),
);
function endRemoteMedia() {
	loadedMedia = undefined;
	loadFailed = false;
	paused = false;
	unstarted = false;
	remoteSeek = undefined;
}
// Set while the media playing is a video (Tidal also has other video elements, animated covers)
let playingVideo = false;
// Only one seek waits, a newer one or a new load replaces it
let stopPendingSeek: (() => void) | undefined;
// The position a starting track must not go back before
let trackSeek: number | undefined;
function seekWhenPlaying(time: number) {
	stopPendingSeek?.();
	const waitUnloads = new Set<LunaUnload>();
	if (playingVideo) {
		// Tidal reports PLAYING before the video element starts and then starts it from the beginning,
		// so seek once the element really plays
		const onPlaying = ({ target }: Event) => {
			if (!(target instanceof HTMLVideoElement) || !playingVideo) return;
			stop();
			PlayState.seek(time);
		};
		// Media events don't bubble, capture them on the document
		document.addEventListener("playing", onPlaying, true);
		waitUnloads.add(() => document.removeEventListener("playing", onPlaying, true));
	} else {
		// A track Tidal loads again on play starts from the beginning (sometimes more than once),
		// so while it starts seek again whenever it is back before the remote's position
		trackSeek = time;
		let seekedAt = 0;
		let reached = false;
		ipcRenderer.on(waitUnloads, "client.playback.playersignal", ({ time: position }: { time: number }) => {
			// The position is NaN until the track really started
			// Far past it is not where it plays from (a late one of the previous track), a newer seek replaces or cancels this
			if (trackSeek === undefined || !Number.isFinite(position) || position > trackSeek + 5) return;
			if (position >= trackSeek - 2) {
				reached = true;
				trackSeek = Math.max(trackSeek, position);
			} else if (Date.now() - seekedAt > 1000) {
				seekedAt = Date.now();
				PlayState.seek(trackSeek);
			}
		});
		// Switching again after it played from there is the next play of it (repeat one) or another item, not a reset
		redux.intercept("playbackControls/MEDIA_PRODUCT_TRANSITION", waitUnloads, () => {
			if (reached) stop();
		});
		waitUnloads.add(() => (trackSeek = undefined));
	}
	const timeout = window.setTimeout(() => stop(), loadTimeoutMs);
	const stop = () => {
		clearTimeout(timeout);
		unloadSet(waitUnloads);
		sessionUnloads.delete(stop);
		if (stopPendingSeek === stop) stopPendingSeek = undefined;
	};
	stopPendingSeek = stop;
	sessionUnloads.add(stop);
}
function startSession() {
	if (sessionUnloads.size !== 0) return;
	if (storage.pauseScrobbling) pauseScrobbling(sessionUnloads);
	const sendProgress = (time: number) =>
		send({
			command: "onProgressUpdated",
			duration: 0,
			progress: time * 1000,
			type: "media",
		});
	// Not the start Tidal loads a track at again before the remote's seek is applied
	ipcRenderer.on(sessionUnloads, "client.playback.playersignal", ({ time }: { time: number }) => {
		if (Number.isFinite(time) && (trackSeek === undefined || time >= trackSeek - 2)) sendProgress(time);
	});
	// A seek on the desktop (also back/forward and previous, which restarts the track) is newer than the remote's
	const desktopSeeks = [
		"playbackControls/SEEK",
		"playbackControls/SEEK_BACKWARDS",
		"playbackControls/SEEK_FORWARDS",
		"playbackControls/SKIP_PREVIOUS",
	] as const;
	for (const action of desktopSeeks) redux.intercept(action, sessionUnloads, () => stopPendingSeek?.());
	// Tidal sends no player signal for videos, so their progress comes from the video element (media events don't bubble)
	const onVideoTime = ({ target }: Event) => {
		if (!(target instanceof HTMLVideoElement) || !playingVideo) return;
		// Not the start Tidal loads it at before the remote's seek is applied
		if (!unstarted && stopPendingSeek === undefined) sendProgress(target.currentTime);
	};
	document.addEventListener("timeupdate", onVideoTime, true);
	sessionUnloads.add(() => document.removeEventListener("timeupdate", onVideoTime, true));
	redux.intercept("playbackControls/MEDIA_PRODUCT_TRANSITION", sessionUnloads, ({ mediaProduct }) => {
		playingVideo = mediaProduct.productType === "video";
	});
	redux.intercept("playbackControls/SET_PLAYBACK_STATE", sessionUnloads, (state) => {
		if (state === "PLAYING") {
			paused = false;
			if (unstarted) {
				const time = remoteSeek;
				unstarted = false;
				remoteSeek = undefined;
				if (time !== undefined) seekWhenPlaying(time);
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
				return send({ command: "onStatusUpdated", playerState: paused ? "paused" : "buffering", type: "media" });
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
