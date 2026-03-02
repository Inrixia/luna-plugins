import { trace, unloads } from "./index.safe";

import { MediaItem, PlayState, redux } from "@luna/lib";

import "./contextMenu";
import { settings } from "./Settings";

export { errSignal, unloads } from "./index.safe";

const getFormatString = async (mediaItem: MediaItem): Promise<string> => {
	const quality = mediaItem.bestQuality;
	try {
		const format = await mediaItem.updateFormat(quality.audioQuality);
		if (format?.bitDepth && format?.sampleRate) return `${format.bitDepth}bit/${format.sampleRate / 1000}kHz`;
	} catch {}
	return quality.name;
};

const getMaxItem = async (mediaItem?: MediaItem) => {
	const maxItem = await mediaItem?.max();
	if (maxItem === undefined) return;
	if (settings.displayInfoPopups) {
		const [fromFmt, toFmt] = await Promise.all([getFormatString(mediaItem!), getFormatString(maxItem)]);
		trace.msg.log(`Found replacement for ${mediaItem!.tidalItem.title} (${fromFmt} -> ${toFmt})`);
	}
	return maxItem;
};

export { Settings } from "./Settings";

// Prefetch max on preload
MediaItem.onPreload(unloads, (mediaItem) => mediaItem.max().catch(trace.err.withContext("onPreload.max")));

MediaItem.onPreMediaTransition(unloads, async (mediaItem) => {
	const maxItem = await getMaxItem(mediaItem);
	if (maxItem !== undefined && PlayState.playing) {
		PlayState.pause();
		try {
			PlayState.playNext(maxItem.id);
		} catch (err) {
			trace.msg.err.withContext("addNext")(err);
		}
		PlayState.play();
	}

	// Preload next item
	const nextItem = await PlayState.nextMediaItem();
	nextItem?.max().catch(trace.err.withContext("onPreMediaTransition.nextItem.max"));
});
redux.intercept("playQueue/ADD_NOW", unloads, (payload) => {
	(async () => {
		const mediaItemIds = [...payload.mediaItemIds];
		const currentIndex = payload.fromIndex ?? 0;
		try {
			const mediaItem = await MediaItem.fromId(mediaItemIds[currentIndex]);
			const maxItem = await getMaxItem(mediaItem);
			if (maxItem !== undefined) mediaItemIds[currentIndex] = maxItem.id;
		} catch (err) {
			trace.msg.err.withContext("playQueue/ADD_NOW")(err);
		}
		redux.actions["playQueue/ADD_NOW"]({ ...payload, mediaItemIds });
	})();
	return true;
});

redux.intercept(["playQueue/MOVE_TO", "playQueue/MOVE_NEXT", "playQueue/MOVE_PREVIOUS"], unloads, (payload, action) => {
	(async () => {
		const { elements, currentIndex } = PlayState.playQueue;
		let replaced = false;
		switch (action) {
			case "playQueue/MOVE_NEXT":
				replaced = await playMaxItem(elements, currentIndex + 1);
				if (!replaced) PlayState.next();
				break;
			case "playQueue/MOVE_PREVIOUS":
				replaced = await playMaxItem(elements, currentIndex - 1);
				if (!replaced) PlayState.previous();
				break;
			case "playQueue/MOVE_TO":
				replaced = await playMaxItem(elements, payload ?? currentIndex);
				if (!replaced) PlayState.moveTo(payload ?? currentIndex);
				break;
		}
		if (replaced) PlayState.play();
	})();
	return true;
});
