import { debounce } from "@inrixia/helpers";
import type { LunaUnload } from "@luna/core";
import type { MediaItem } from "@luna/lib";
import { unloads } from "./index.safe";
import { ensureColumnHeader } from "./lib/ensureColumnHeader";
import { setColumn } from "./lib/setColumn";
import { settings } from "./Settings";

export const setInfoColumnHeaders = debounce(() => {
	for (const trackList of document.querySelectorAll(`div[aria-label="Tracklist"]`)) {
		const bitDepthColumn = ensureColumnHeader(
			trackList,
			"Depth",
			`span[class^="_timeColumn"][role="columnheader"]`,
			`span[class^="_timeColumn"][role="columnheader"]`
		);
		bitDepthColumn?.style.setProperty("min-width", "40px");
		const sampleRateColumn = ensureColumnHeader(trackList, "Sample Rate", `span[class^="_timeColumn"][role="columnheader"]`, bitDepthColumn);
		sampleRateColumn?.style.setProperty("min-width", "110px");
		const bitrateColumn = ensureColumnHeader(trackList, "Bitrate", `span[class^="_timeColumn"][role="columnheader"]`, sampleRateColumn);
		bitrateColumn?.style.setProperty("min-width", "100px");
	}
}, 50);

// The format listener of each row. Rows are re-rendered and recycled while scrolling, so the listener of a row is replaced
// when the row is filled again and removed once the row has left the DOM. Without this every call added a listener that
// lived until the plugin unloaded and kept its detached row (and the rest of that DOM tree) in memory.
const rowFormatUnloads = new Map<Element, LunaUnload>();
const unloadRowFormat = (trackRow: Element) => {
	rowFormatUnloads.get(trackRow)?.();
	rowFormatUnloads.delete(trackRow);
};
unloads.add(() => rowFormatUnloads.clear());

export const setInfoColumns = async (trackRow: Element, mediaItem: MediaItem) => {
	for (const row of rowFormatUnloads.keys()) if (!row.isConnected) unloadRowFormat(row);
	unloadRowFormat(trackRow);
	setInfoColumnHeaders();
	const bitDepthContent = document.createElement("span");
	const bitDepthColumn = setColumn(trackRow, "Depth", `div[data-test="duration"]`, bitDepthContent, `div[data-test="duration"]`);
	bitDepthColumn?.style.setProperty("min-width", "40px");

	const sampleRateContent = document.createElement("span");
	const sampleRateColumn = setColumn(trackRow, "Sample Rate", `div[data-test="duration"]`, sampleRateContent, bitDepthColumn);
	sampleRateColumn?.style.setProperty("min-width", "110px");

	const bitrateContent = document.createElement("span");
	const bitrateColumn = setColumn(trackRow, "Bitrate", `div[data-test="duration"]`, bitrateContent, sampleRateColumn);
	bitrateColumn?.style.setProperty("min-width", "100px");

	const quality = mediaItem.bestQuality;

	bitDepthContent.style.color = sampleRateContent.style.color = bitrateContent.style.color = quality.color;

	const unloadFormat = mediaItem.withFormat(unloads, quality.audioQuality, ({ sampleRate, bitDepth, bitrate }) => {
		if (!!sampleRate) sampleRateContent.textContent = `${sampleRate / 1000}kHz`;
		if (!!bitDepth) bitDepthContent.textContent = `${bitDepth}bit`;
		if (!!bitrate) bitrateContent.textContent = `${Math.floor(bitrate / 1000).toLocaleString()}kbps`;
	});
	rowFormatUnloads.set(trackRow, unloadFormat);

	if (settings.autoPopulateColumns) await mediaItem.updateFormat(quality.audioQuality);
};
