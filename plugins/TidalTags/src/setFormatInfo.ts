import { memoizeArgless } from "@inrixia/helpers";
import { observePromise, PlayState, Quality, type MediaItem } from "@luna/lib";
import { hexToRgba } from "./lib/hexToRgba";

import { unloads } from "./index.safe";

import type { LunaUnload } from "@luna/core";
import { settings } from "./Settings";

export const formatInfoElem = document.createElement("span");
formatInfoElem.className = "format-info";
unloads.add(() => formatInfoElem.remove());

const setupInfoElem = memoizeArgless(async () => {
	const qualityIndicator = await observePromise<HTMLElement>(unloads, `[data-test-media-state-indicator-streaming-quality]`);
	if (qualityIndicator == null) throw new Error("Failed to find tidal media-state-indicator element!");

	const qualityElementContainer = qualityIndicator.parentElement;
	if (qualityElementContainer == null) throw new Error("Failed to find tidal media-state-indicator element parent!");

	// Ensure no duplicate/leftover elements before prepending
	qualityElementContainer.prepend(formatInfoElem);
	// Fix for grid spacing issues
	qualityElementContainer.style.setProperty("grid-auto-columns", "auto");

	const progressBar = <HTMLElement>document.getElementById("progressBar");
	if (progressBar === null) throw new Error("Failed to find tidal progressBar element!");

	return { progressBar, qualityIndicator };
});

let formatUnload: LunaUnload | undefined;
export const setFormatInfo = async (mediaItem?: MediaItem) => {
	if (mediaItem === undefined) return;
	formatInfoElem.textContent = `Loading...`;

	const { progressBar, qualityIndicator } = await setupInfoElem();

	if (mediaItem.id != PlayState.playbackContext.actualProductId) return;
	const audioQuality = PlayState.playbackContext.actualAudioQuality;

	const qualityColor = Quality.fromAudioQuality(audioQuality);
	const color = (progressBar.style.color = qualityIndicator.style.color = qualityColor?.color ?? "#cfcfcf");
	if (settings.displayFormatBorder) formatInfoElem.style.border = `solid 1px ${hexToRgba(color, 0.3)}`;
	else formatInfoElem.style.border = "none";

	formatUnload?.();
	formatUnload = mediaItem.withFormat(unloads, audioQuality, ({ sampleRate, bitDepth, bitrate }) => {
		formatInfoElem.textContent = "";
		if (!!sampleRate) formatInfoElem.textContent += `${sampleRate / 1000}kHz `;
		if (!!bitDepth) formatInfoElem.textContent += `${bitDepth}bit `;
		if (!!bitrate) formatInfoElem.textContent += `${Math.floor(bitrate / 1000).toLocaleString()}kb/s`;
		if (formatInfoElem.textContent === "") formatInfoElem.textContent = "Unknown";
	});

	try {
		await mediaItem.updateFormat();
	} catch (err) {
		formatInfoElem.style.border = "solid 1px red";
		const errorText = (<Error>err).message.substring(0, 64);
		formatInfoElem.textContent = errorText;
		throw err;
	}
};
