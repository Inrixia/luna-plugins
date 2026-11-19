import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, safeInterval, StyleTag, type MediaItem } from "@luna/lib";

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
		// Returns false if the save dialog was cancelled
		const downloadTrack = async (mediaItem: MediaItem) => {
			// Don't show the previous track's progress while this one is prepared
			downloadButton.elem?.style.removeProperty("--progress");
			setStatus(`Fetching filename...`);
			const fileName = await getFileName(mediaItem, settings.downloadQuality);

			setStatus(`Fetching download path...`);
			const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
			if (path === undefined) return false;

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
					downloadButton.elem?.style.setProperty("--progress", `${percent}%`);
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
			return true;
		};
		const failed: string[] = [];
		let tried = 0;
		try {
			for await (const original of await mediaCollection.mediaItems()) {
				if (downloadState.cancel) break;
				tried++;
				const title = original.tidalItem.title ?? `${original.id}`;
				// Note a track that fails (e.g. unavailable on TIDAL) and continue with the next one instead of stopping the whole download
				try {
					let mediaItem = original;
					if (settings.useRealMAX) {
						setStatus(`Checking RealMax...`);
						// If the lookup fails, download the track as it is
						mediaItem = (await original.max().catch(trace.warn.withContext(`RealMax lookup failed for ${title}:`))) ?? original;
					}
					const saved = await downloadTrack(mediaItem).catch((err) => {
						if (mediaItem === original) throw err;
						// The RealMax version can fail (e.g. be region-locked) while the original does not
						trace.warn.withContext(`RealMax version of ${title} failed, using the original:`)(err);
						return downloadTrack(original);
					});
					// Cancelling the save dialog stops the download like the Stop click does
					if (!saved) break;
				} catch (err) {
					failed.push(title);
					trace.err.withContext(`Failed to download ${title}:`)(err);
				}
			}
			if (failed.length !== 0) trace.msg.err(`Failed to download ${failed.length} of ${tried} tracks: ${failed.join(", ")}`);
		} finally {
			downloadState.active = false;
			downloadState.cancel = false;
			downloadButton.text = defaultText;
			downloadButton.elem?.classList.remove("download-button");
		}
	});

	await downloadButton.show(contextMenu);
});
