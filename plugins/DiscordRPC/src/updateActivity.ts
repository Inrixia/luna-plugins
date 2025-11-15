import { asyncDebounce } from "@inrixia/helpers";
import { MediaItem, PlayState, redux } from "@luna/lib";

import { type StatusDisplayType, type SetActivity } from "@xhayper/discord-rpc";
import { setActivity } from "./discord.native";
import { CustomStatusPosition, PresenceStatus, settings } from "./Settings";
import { fmtStr, getStatusText } from "./activityTextHelpers";

export const updateActivity = asyncDebounce(async (mediaItem?: MediaItem) => {
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
		}
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
	activity.name = "TIDAL";
	if (settings.status === PresenceStatus.Custom) {
		activity.statusDisplayType = 2;
	} else {
		// Convert from our custom enum
		activity.statusDisplayType = settings.status as unknown as StatusDisplayType;
	}

	// Title
	const trackTitle = fmtStr(await mediaItem.title());
	activity.details = trackTitle;
	activity.detailsUrl = trackUrl;

	// Artists
	const artistNames = await MediaItem.artistNames(await mediaItem.artists());
	activity.state = fmtStr(artistNames.join(", ")) ?? "Unknown Artist";
	activity.stateUrl = artistUrl;

	if (settings.status == 3) {

		// Due to Discord's constraints, we can't have a separate property for the title
		// It has to either replace the application name or the song name
		if (settings.customStatusPosition === CustomStatusPosition.ReplaceTrackName) {
			// Replace the song title with the custom status
			activity.details = statusText;
			activity.statusDisplayType = 2;
		} else {
			// Replace the application name with the custom status
			activity.name = statusText;
			activity.details = trackTitle;
			activity.statusDisplayType = 0;
		}
	}

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
}, true);
