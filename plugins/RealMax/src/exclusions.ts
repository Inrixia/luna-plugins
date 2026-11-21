import { unloads } from "./index.safe";

import { ContextMenu, MediaItem, MediaItems, Quality, redux } from "@luna/lib";

import { settings } from "./Settings";

// keepVersion: never replace these tracks. neverUse: never pick these tracks as a replacement.
export type ExclusionList = "keepVersion" | "neverUse";

export const isExcluded = (list: ExclusionList, id: MediaItem["id"]) => String(id) in settings[list];

/**
 * The version RealMAX should switch `mediaItem` to, respecting both lists. Undefined = keep `mediaItem`.
 */
export const findReplacement = async (mediaItem: MediaItem): Promise<MediaItem | undefined> => {
	if (isExcluded("keepVersion", mediaItem.id)) return;
	const maxItem = await mediaItem.max();
	if (maxItem === undefined || !isExcluded("neverUse", maxItem.id)) return maxItem;

	// The best version is in neverUse: same search as MediaItem.max(), skipping neverUse tracks
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

const lists: ExclusionList[] = ["keepVersion", "neverUse"];
const buttons = lists.map((list) => ({ list, button: ContextMenu.addButton(unloads) }));

ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	// Drop buttons left over from the previous menu, so a stale one can't act on the old selection
	for (const { button } of buttons) button.elem?.parentElement?.parentElement?.remove();
	// Only for track selections, not whole albums/playlists
	if (!(mediaCollection instanceof MediaItems)) return;
	const mediaItems: MediaItem[] = [];
	for await (const mediaItem of await mediaCollection.mediaItems()) {
		if (mediaItem.contentType === "track") mediaItems.push(mediaItem);
	}
	if (mediaItems.length === 0) return;

	const count = mediaItems.length > 1 ? ` (${mediaItems.length} tracks)` : "";
	for (const { list, button } of buttons) {
		const allListed = mediaItems.every(({ id }) => isExcluded(list, id));
		button.text = (allListed ? buttonText[list].remove : buttonText[list].add) + count;
		button.onClick(() => {
			for (const mediaItem of mediaItems) {
				if (allListed) delete settings[list][String(mediaItem.id)];
				else settings[list][String(mediaItem.id)] = trackLabel(mediaItem);
			}
			redux.actions["contextMenu/CLOSE"]();
		});
		await button.show(contextMenu);
	}
});
