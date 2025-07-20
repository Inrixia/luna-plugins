import { asyncDebounce } from "@inrixia/helpers";
import { MediaItem, PlayState } from "@luna/lib";

import type { SetActivity } from "@xhayper/discord-rpc";
import { setActivity } from "./discord.native";
import { settings } from "./Settings";

const STR_MAX_LEN = 127;
const fmtStr = (s?: string) => {
	if (!s) return;
	if (s.length < 2) s += " ";
	return s.length >= STR_MAX_LEN ? s.slice(0, STR_MAX_LEN - 3) + "..." : s;
};

export const updateActivity = asyncDebounce(async (mediaItem?: MediaItem) => {
	if (!PlayState.playing && !settings.displayOnPause) return await setActivity();

	mediaItem ??= await MediaItem.fromPlaybackContext();
	if (mediaItem === undefined) return;

	const activity: SetActivity = { type: 2 }; // Listening type

	const trackUrl = `https://tidal.com/browse/${mediaItem.tidalItem.contentType}/${mediaItem.id}?u`

	activity.buttons = [
		{
			url: trackUrl,
			label: "Play Song",
		},
	];

	const artist = await mediaItem.artist();
	const artistUrl = `https://tidal.com/browse/artist/${artist?.id}?u`;

	// Status text
	activity.statusDisplayType = settings.status;

	// Title
	activity.details = await mediaItem.title().then(fmtStr);
	activity.detailsUrl = trackUrl;
	// Artists
	const artistNames = await MediaItem.artistNames(await mediaItem.artists());
	activity.state = fmtStr(artistNames.join(", ")) ?? "Unknown Artist";
	activity.stateUrl = artistUrl;

	// Pause indicator
	if (PlayState.playing) {
		// Small Artist image
		if (settings.displayArtistIcon) {
			activity.smallImageKey = artist?.coverUrl("320");
			activity.smallImageText = fmtStr(artist?.name);
			activity.smallImageUrl = artistUrl;
		}

		// Playback/Time
		if (mediaItem.duration !== undefined) {
			activity.startTimestamp = Date.now() - PlayState.playTime * 1000;
			activity.endTimestamp = activity.startTimestamp + mediaItem.duration * 1000;
		}
	} else {
		activity.smallImageKey = "paused-icon";
		activity.smallImageText = "Paused";
		activity.endTimestamp = Date.now();
	}

	// Album
	const album = await mediaItem.album();
	if (album) {
		activity.largeImageKey = album.coverUrl();
		activity.largeImageText = await album.title().then(fmtStr);
		activity.largeImageUrl = `https://tidal.com/browse/album/${album.id}?u`;
	}

	await setActivity(activity);
}, true);
