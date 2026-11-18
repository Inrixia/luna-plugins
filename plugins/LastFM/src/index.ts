import { Tracer, type LunaUnload } from "@luna/core";
import { ipcRenderer, MediaItem, PlayState, redux } from "@luna/lib";

export const { trace, errSignal } = Tracer("[last.fm]");

import { LastFM, ScrobbleOpts } from "./LastFM";
import { storage } from "./Settings";

redux.actions["lastFm/DISCONNECT"]();

const delUndefined = <O extends Record<any, any>>(obj: O) => {
	for (const key in obj) if (obj[key] === undefined) delete obj[key];
};

const makeScrobbleOpts = async (mediaItem: MediaItem): Promise<ScrobbleOpts> => {
	const album = await mediaItem.album();
	const scrobbleOpts: Partial<ScrobbleOpts> = {
		track: await mediaItem.title(),
		artist: (await mediaItem.artist())?.name,
		album: await album?.title(),
		albumArtist: (await album?.artist())?.name,
		trackNumber: mediaItem.trackNumber?.toString(),
		mbid: await mediaItem.brainzId(),
		timestamp: (Date.now() / 1000).toFixed(0),
	};
	delUndefined(scrobbleOpts);
	return scrobbleOpts as ScrobbleOpts;
};

export { Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();

// Playback controlled from another device via DesktopConnect can be scrobbled by that device
let remoteSessionActive = false;
ipcRenderer.on(unloads, "remote.desktop.notify.session.state", (state: number) => (remoteSessionActive = state !== 0));
// Plays started during a remote session per track, checked when they are scrobbled (after the next transition)
const remotePlays = new Map<MediaItem["id"], number>();
const isRemotePlay = (id: MediaItem["id"]) => {
	const plays = remotePlays.get(id);
	if (plays === undefined) return false;
	if (plays > 1) remotePlays.set(id, plays - 1);
	else remotePlays.delete(id);
	return true;
};

unloads.add(
	MediaItem.onMediaTransition(unloads, (mediaItem) => {
		if (remoteSessionActive && storage.ignoreDesktopConnect) return remotePlays.set(mediaItem.id, (remotePlays.get(mediaItem.id) ?? 0) + 1);
		makeScrobbleOpts(mediaItem).then(LastFM.updateNowPlaying).catch(trace.msg.err.withContext(`Failed to updateNowPlaying!`));
	})
);
unloads.add(
	PlayState.onScrobble(unloads, async (mediaItem) => {
		if (isRemotePlay(mediaItem.id)) return trace.log("Skipped scrobble, playback is controlled via DesktopConnect");
		const scrobbleOpts = await makeScrobbleOpts(mediaItem);
		LastFM.scrobble(scrobbleOpts)
			.catch(trace.msg.err.withContext(`Failed to scrobble!`))
			.then((res) => {
				if (res?.scrobbles) trace.log("Scrobbled", scrobbleOpts, res?.scrobbles["@attr"], res.scrobbles.scrobble);
			});
	})
);
