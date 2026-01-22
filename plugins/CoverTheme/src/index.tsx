import { Tracer, type LunaUnload } from "@luna/core";
import { MediaItem, PlayState, redux, StyleTag } from "@luna/lib";

const { trace, errSignal } = Tracer("[CoverTheme]");
export { errSignal, trace };

import transparent from "file://transparent.css?minify";

import { settings, storage } from "./Settings";
import { getPalette, type Palette, type RGBSwatch } from "./vibrant.native";

const cachePalette = async (mediaItem?: MediaItem): Promise<Palette | undefined> => {
	if (mediaItem === undefined) return;
	const coverUrl = await mediaItem.coverUrl({ res: "640" });
	if (coverUrl === undefined) return;
	return await storage.ensure<Palette>(`palette_v2.${coverUrl}`, () => getPalette(coverUrl));
};

const docStyle = document.documentElement.style;
const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
const animateCssVar = (varName: string, from: RGBSwatch | undefined, to: RGBSwatch, duration = 250) => {
	if (from === undefined || from.every((v, i) => v === to[i])) return docStyle.setProperty(varName, to.join(","));
	const start = performance.now();
	const frame = (now: number) => {
		const t = Math.min(1, (now - start) / duration);
		const current = from.map((v, i) => lerp(v, to[i], t));
		docStyle.setProperty(varName, current.join(","));
		if (t < 1) requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
};

const vars = new Set<string>();
let currentItemId: redux.ItemId;
let currentPalette: Palette;
const updateBackground = async (mediaItem?: MediaItem) => {
	if (mediaItem === undefined || mediaItem.id === currentItemId) return;
	currentItemId = mediaItem.id;
	const palette = await cachePalette(mediaItem).catch(trace.msg.err.withContext("Failed to update background"));
	if (palette === undefined || currentPalette === palette) return;

	for (const colorName in palette) {
		const nextColor = palette[colorName];
		const variableName = `--cover-${colorName}`;
		vars.add(variableName);
		animateCssVar(variableName, currentPalette?.[colorName], nextColor, 250);
	}
	currentPalette = palette;
	return true;
};

export { Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();
export const style = new StyleTag("CoverTheme", unloads, settings.applyTheme ? transparent : "");
setTimeout(async () => {
	const mediaItem = await MediaItem.fromPlaybackContext()
		.then(updateBackground)
		.catch(trace.msg.err.withContext("MediaItem.fromPlaybackContext.updateBackground"));
	if (mediaItem) return;

	// Fallback for if no media is playing
	const mediaItems = redux.store.getState().content.mediaItems;
	for (const itemId in mediaItems) {
		await MediaItem.fromId(itemId).then(updateBackground).catch(trace.msg.err.withContext("MediaItem.fromId.updateBackground"));
		return;
	}
});

MediaItem.onMediaTransition(unloads, async (mediaItem) => {
	await updateBackground(mediaItem);
	// Preload next palette
	await cachePalette(await PlayState.nextMediaItem());
});
MediaItem.onPreload(unloads, cachePalette);
MediaItem.onPreMediaTransition(unloads, updateBackground);
redux.intercept("playQueue/MOVE_TO", unloads, (payload) => {
	const { mediaItemId } = PlayState.playQueue.elements[payload];
	MediaItem.fromId(mediaItemId).then(updateBackground).catch(trace.msg.err.withContext("playQueue/MOVE_TO"));
});
redux.intercept("playQueue/MOVE_NEXT", unloads, () => {
	PlayState.nextMediaItem().then(updateBackground).catch(trace.msg.err.withContext("playQueue/MOVE_NEXT"));
});
redux.intercept("playQueue/MOVE_PREVIOUS", unloads, () => {
	PlayState.previousMediaItem().then(updateBackground).catch(trace.msg.err.withContext("playQueue/MOVE_PREVIOUS"));
});

unloads.add(() => vars.forEach((variable) => document.documentElement.style.removeProperty(variable)));
