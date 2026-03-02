import { trace, unloads } from "./index.safe";

import { MediaItem, PlayState, redux } from "@luna/lib";

import "./contextMenu";
import { settings } from "./Settings";

export { errSignal, unloads } from "./index.safe";

const getFormatString = (mediaItem: MediaItem): Promise<string> =>
	new Promise((resolve) => {
		const quality = mediaItem.bestQuality;
		const cleanup = mediaItem.withFormat(new Set(), quality.audioQuality, ({ sampleRate, bitDepth }) => {
			if (bitDepth && sampleRate) resolve(`${bitDepth}bit/${sampleRate / 1000}kHz`);
			else resolve(quality.name);
			cleanup?.();
		});
		mediaItem.updateFormat(quality.audioQuality).catch(() => {
			resolve(quality.name);
			cleanup?.();
		});
	});

const getMaxItem = async (mediaItem?: MediaItem) => {
	const maxItem = await mediaItem?.max();
	if (maxItem === undefined) return;
	if (settings.displayInfoPopups) {
		const [fromFmt, toFmt] = await Promise.all([getFormatString(mediaItem!), getFormatString(maxItem)]);
		trace.msg.log(`Found replacement for ${mediaItem!.tidalItem.title} (${fromFmt} -> ${toFmt})`);
	}
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
		let targetIndex: number;
		switch (action) {
			case "playQueue/MOVE_NEXT":
				targetIndex = currentIndex + 1;
				break;
			case "playQueue/MOVE_PREVIOUS":
				targetIndex = currentIndex - 1;
				break;
			case "playQueue/MOVE_TO":
				targetIndex = payload ?? currentIndex;
				break;
			default:
				return;
		}

		// Pre-swap the target track with its max version before transitioning
		const element = elements[targetIndex];
		if (element?.mediaItemId !== undefined) {
			try {
				const mediaItem = await MediaItem.fromId(element.mediaItemId);
				const maxItem = await getMaxItem(mediaItem);
				if (maxItem !== undefined) {
					const newElements = [...elements];
					newElements[targetIndex] = { ...newElements[targetIndex], mediaItemId: maxItem.id };
					// Update queue but keep currentIndex unchanged — only swap the future track
					PlayState.updatePlayQueue({
						elements: newElements,
						currentIndex,
					});
				}
			} catch (err) {
				trace.err.withContext(action)(err);
			}
		}

		// Transition using normal PlayState methods (works with Tidal Connect)
		switch (action) {
			case "playQueue/MOVE_NEXT":
				PlayState.next();
				break;
			case "playQueue/MOVE_PREVIOUS":
				PlayState.previous();
				break;
			case "playQueue/MOVE_TO":
				PlayState.moveTo(payload ?? currentIndex);
				break;
		}
	})();
	return true;
});
