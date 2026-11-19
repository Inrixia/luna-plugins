import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, safeInterval, StyleTag } from "@luna/lib";

import { getDownloadFolder, getDownloadPath, getFileName } from "./helpers";
import { settings } from "./Settings";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);

const downloadButton = ContextMenu.addButton(unloads);
const downloadState = { active: false, cancel: false };

export { Settings } from "./Settings";
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	const defaultText = (downloadButton.text = `Download ${trackCount} tracks`);

	downloadButton.onClick(async () => {
		if (downloadButton.elem === undefined) return;
		// Clicking while a download is running requests it to stop after the current track
		if (downloadState.active) {
			downloadState.cancel = true;
			downloadButton.text = `Stopping...`;
			return;
		}
		const downloadFolder = settings.defaultPath ?? (trackCount > 1 ? await getDownloadFolder() : undefined);
		downloadState.active = true;
		downloadState.cancel = false;
		downloadButton.elem.classList.add("download-button");
		// Keep showing that a stop was requested until the current track is done
		const setStatus = (text: string) => (downloadButton.text = downloadState.cancel ? `Stopping...` : text);
		try {
			for await (let mediaItem of await mediaCollection.mediaItems()) {
				if (downloadState.cancel) break;
				// Report a track that fails (e.g. unavailable on TIDAL) and continue with the next one instead of stopping the whole download
				try {
					// Don't show the previous track's progress while this one is prepared
					downloadButton.elem?.style.removeProperty("--progress");
					const original = mediaItem;
					if (settings.useRealMAX) {
						setStatus(`Checking RealMax...`);
						// If the lookup fails, download the track as it is
						mediaItem =
							(await mediaItem.max().catch(trace.msg.warn.withContext(`RealMax lookup failed for ${mediaItem.tidalItem.title}:`))) ?? mediaItem;
					}

					setStatus(`Fetching filename...`);
					const fileName = await getFileName(mediaItem, settings.downloadQuality).catch((err) => {
						if (mediaItem === original) throw err;
						// The RealMax version can be unavailable (e.g. region-locked) while the original is not
						trace.msg.warn.withContext(`RealMax version of ${original.tidalItem.title} is unavailable, using the original:`)(err);
						mediaItem = original;
						return getFileName(mediaItem, settings.downloadQuality);
					});

					setStatus(`Fetching download path...`);
					const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
					if (path === undefined) return;

					setStatus(`Downloading...`);
					let downloading = true;
					const clearInterval = safeInterval(
						unloads,
						async () => {
							const progress = await mediaItem.downloadProgress();
							// A tick still waiting for the progress when the download ended must not overwrite the next track's state
							if (!downloading || progress === undefined) return;
							const { total, downloaded } = progress;
							if (!total || downloaded === undefined) return;
							const percent = (downloaded / total) * 100;
							downloadButton.elem!.style.setProperty("--progress", `${percent}%`);
							const downloadedMB = (downloaded / 1048576).toFixed(0);
							const totalMB = (total / 1048576).toFixed(0);
							setStatus(`Downloading... ${downloadedMB}/${totalMB}MB ${percent.toFixed(0)}%`);
						},
						50,
					);
					try {
						await mediaItem.download(path, settings.downloadQuality);
					} finally {
						downloading = false;
						clearInterval();
						unloads.delete(clearInterval);
					}
				} catch (err) {
					trace.msg.err.withContext(`Failed to download ${mediaItem.tidalItem.title ?? mediaItem.id}:`)(err);
				}
			}
		} finally {
			downloadState.active = false;
			downloadState.cancel = false;
			downloadButton.text = defaultText;
			downloadButton.elem?.classList.remove("download-button");
		}
	});

	await downloadButton.show(contextMenu);
});
