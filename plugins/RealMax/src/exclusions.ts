import { unloads } from "./index.safe";

import { ContextMenu, MediaItem, MediaItems, Quality, redux } from "@luna/lib";

import { settings } from "./Settings";

// keepVersion: never replace these tracks. neverUse: never pick these tracks as a replacement.
export type ExclusionList = "keepVersion" | "neverUse";

export const isExcluded = (list: ExclusionList, id: MediaItem["id"]) => String(id) in settings[list];

/**
 * Same search as MediaItem.max() but skipping tracks in the neverUse list.
 */
export const maxAllowed = async (mediaItem: MediaItem): Promise<MediaItem | undefined> => {
	let bestMediaItem: MediaItem = mediaItem;
	for await (const isrc of mediaItem.isrcs()) {
		const candidate = await MediaItem.fromIsrc(isrc);
		if (candidate === undefined || isExcluded("neverUse", candidate.id)) continue;
		if (candidate.bestQuality > bestMediaItem.bestQuality) {
			bestMediaItem = candidate;
			if (bestMediaItem.bestQuality >= Quality.Max) break;
		}
	}
	return String(bestMediaItem.id) === String(mediaItem.id) ? undefined : bestMediaItem;
};

const trackLabel = (mediaItem: MediaItem) => {
	const { title, version, artist, album } = mediaItem.tidalItem;
	let label = version ? `${title} (${version})` : title;
	if (artist?.name) label += ` - ${artist.name}`;
	if (album?.title) label += ` [${album.title}]`;
	return label;
};

const buttonText: Record<ExclusionList, { add: string; remove: string }> = {
	keepVersion: { add: "RealMAX: Keep this version", remove: "RealMAX: Allow replacing" },
	neverUse: { add: "RealMAX: Never use this version", remove: "RealMAX: Allow as replacement" },
};

const addListButton = (list: ExclusionList) => {
	const button = ContextMenu.addButton(unloads);
	ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
		// Only for track selections, not whole albums/playlists
		if (!(mediaCollection instanceof MediaItems)) return;
		const mediaItems: MediaItem[] = [];
		for await (const mediaItem of await mediaCollection.mediaItems()) {
			if (mediaItem.contentType === "track") mediaItems.push(mediaItem);
		}
		if (mediaItems.length === 0) return;

		const allListed = mediaItems.every(({ id }) => isExcluded(list, id));
		const count = mediaItems.length > 1 ? ` (${mediaItems.length} tracks)` : "";
		button.text = (allListed ? buttonText[list].remove : buttonText[list].add) + count;
		button.onClick(() => {
			for (const mediaItem of mediaItems) {
				if (allListed) delete settings[list][String(mediaItem.id)];
				else settings[list][String(mediaItem.id)] = trackLabel(mediaItem);
			}
			redux.actions["contextMenu/CLOSE"]();
		});
		await button.show(contextMenu);
	});
};

addListButton("keepVersion");
addListButton("neverUse");
