import { MediaItem, observe, StyleTag } from "@luna/lib";

import styles from "file://styles.css?minify";
import { unloads } from "./index.safe";
import { setFormatInfo } from "./setFormatInfo";
import { setInfoColumns as setFormatColumns } from "./setInfoColumns";
import { setQualityTags } from "./setQualityTags";
import { settings, Settings } from "./Settings";

export { Settings, unloads };

new StyleTag("TidalTags", unloads, styles);

const updateTrackRow = async (trackRow: Element) => {
	if (!settings.displayQalityTags && !settings.displayFormatColumns) return;
	const trackId = trackRow.getAttribute("data-track-id");
	if (trackId == null) return;

	const mediaItem = await MediaItem.fromId(trackId);
	if (mediaItem === undefined) return;

	if (settings.displayQalityTags) setQualityTags(trackRow, mediaItem);
	if (settings.displayFormatColumns) await setFormatColumns(trackRow, mediaItem);
};

// Observe new tracklist rows
observe(unloads, 'div[data-test="tracklist-row"]', updateTrackRow);

// Observe data-track-id attribute changes (DOM recycling)
const attrObserver = new MutationObserver((mutations) => {
	for (const mutation of mutations) {
		if (mutation.type === "attributes" && mutation.attributeName === "data-track-id") {
			updateTrackRow(mutation.target as Element);
		}
	}
});
attrObserver.observe(document.body, {
	subtree: true,
	attributes: true,
	attributeFilter: ["data-track-id"],
});
unloads.add(() => attrObserver.disconnect());

MediaItem.onMediaTransition(unloads, setFormatInfo);
MediaItem.fromPlaybackContext().then(setFormatInfo);
