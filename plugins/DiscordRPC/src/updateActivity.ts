import { MediaItem, PlayState, redux } from "@luna/lib";

import type { SetActivity } from "@xhayper/discord-rpc";
import { fmtStr, getStatusText } from "./activityTextHelpers";
import { setActivity, StatusDisplayTypeEnum } from "./discord.native";
import { settings } from "./Settings";

// Proxy this so we dont try import a node native module
const StatusDisplayType = await StatusDisplayTypeEnum();

export const updateActivity = async (mediaItem?: MediaItem) => {
	if (!PlayState.playing && !settings.displayOnPause) return await setActivity();

	mediaItem ??= await MediaItem.fromPlaybackContext();
	if (mediaItem === undefined) return;

	const { sourceUrl, sourceEntityType } = redux.store.getState().playQueue;

	const activity: SetActivity = { type: 2 }; // Listening type

	const trackUrl = `https://tidal.com/${mediaItem.tidalItem.contentType}/${mediaItem.id}/u`;
	const trackSourceUrl = `https://tidal.com/browse${sourceUrl}`;

	activity.buttons = [
		{
			url: trackUrl,
			label: "Play Song",
		},
	];

	if (sourceEntityType === "playlist" && settings.displayPlaylistButton) {
		activity.buttons.push({
			url: trackSourceUrl,
			label: "Playlist",
		});
	}

	const artist = await mediaItem.artist();
	const artistUrl = `https://tidal.com/artist/${artist?.id}/u`;

	// Status text
	const statusText = fmtStr(await getStatusText(mediaItem));
	activity.name = statusText;

	// Title
	const trackTitle = fmtStr(await mediaItem.title());
	activity.details = trackTitle;
	activity.detailsUrl = trackUrl;

	// Artists
	const artistNames = await MediaItem.artistNames(await mediaItem.artists());
	activity.state = fmtStr(artistNames.join(", ")) ?? "Unknown Artist";
	activity.stateUrl = artistUrl;

	activity.details = trackTitle;
	activity.statusDisplayType = StatusDisplayType.Name;

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
		activity.largeImageUrl = `https://tidal.com/album/${album.id}/u`;
	}

	await setActivity(activity);
};
