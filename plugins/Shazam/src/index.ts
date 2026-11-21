import { Tracer, type LunaUnload } from "@luna/core";

import { recognizeTrack } from "./shazam.native";

import { MediaItem, redux } from "@luna/lib";
import { storage } from "./Settings";
export { Settings } from "./Settings";

export const { trace, errSignal } = Tracer("[Shazam]");
export const unloads = new Set<LunaUnload>();

const addToPlaylist = async (playlistUUID: string, mediaItemIdsToAdd: string[]) => {
	await redux.interceptActionResp(
		() => redux.actions["content/ADD_MEDIA_ITEMS_TO_PLAYLIST"]({ mediaItemIdsToAdd, onDupes: "SKIP", playlistUUID }),
		unloads,
		["etag/SET_PLAYLIST_ETAG", "content/ADD_MEDIA_ITEMS_TO_PLAYLIST_SUCCESS"],
		["content/ADD_MEDIA_ITEMS_TO_PLAYLIST_FAIL"]
	);
	redux.actions["content/LOAD_LIST_ITEMS_PAGE"]({ listName: `playlists/${playlistUUID}`, listType: "mediaItems", reset: false });
	setTimeout(
		() => redux.actions["content/LOAD_LIST_ITEMS_PAGE"]({ listName: `playlists/${playlistUUID}`, listType: "mediaItems", reset: true }),
		1000
	);
};

// Define the function
const handleDrop = async (event: DragEvent) => {
	try {
		event.preventDefault();
		event.stopPropagation();

		const { currentPath, currentParams } = redux.store.getState().router;

		if (!currentPath.startsWith("/playlist/")) {
			return trace.msg.err(`This is not a playlist!`);
		}
		const playlistUUID: string = currentParams.playlistId;
		for (const file of event.dataTransfer?.files ?? []) {
			const bytes = await file.arrayBuffer();
			if (bytes === undefined) continue;
			trace.msg.log(`Matching ${file.name}...`);
			try {
				const matches = await recognizeTrack({
					bytes,
					startInMiddle: storage.startInMiddle,
					exitOnFirstMatch: storage.exitOnFirstMatch,
				});
				// Signatures without a match come back too, only the ones with a track matched
				const matched = matches.filter((shazamData) => shazamData.track !== undefined);
				if (matched.length === 0) {
					trace.msg.warn(`No matches for ${file.name}`);
					continue;
				}
				for (const shazamData of matched) {
					const trackName =
						shazamData.track?.share?.text ?? `${shazamData.track?.title ?? "unknown"} by ${shazamData.track?.subtitle ?? "unknown"}`;
					const prefix = `[File: ${file.name}, Match: ${trackName}]`;
					const isrc = shazamData.track?.isrc;
					trace.log(shazamData);
					if (isrc === undefined) {
						trace.msg.log(`${prefix} No isrc returned from Shazam cannot add to playlist.`);
						continue;
					}
					const mediaItem = await MediaItem.fromIsrc(isrc);
					if (mediaItem !== undefined) {
						trace.msg.log(`Adding ${prefix}...`);
						await addToPlaylist(playlistUUID, [mediaItem.id.toString()]);
						break;
					}
					trace.msg.err(`${prefix} Not avalible in Tidal.`);
				}
			} catch (err) {
				trace.msg.err.withContext(`[File: ${file.name}] Failed to recognize!`)(<Error>err);
			}
		}
	} catch (err) {
		trace.msg.err.withContext(`Unexpected error!`)(<Error>err);
	}
};

// Register the event listener
document.addEventListener("drop", handleDrop);
unloads.add(() => document.removeEventListener("drop", handleDrop));
