import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, safeInterval, StyleTag, type MediaItem } from "@luna/lib";

import { getDownloadFolder, getDownloadPath, getFileName } from "./helpers";
import { settings } from "./Settings";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);

const downloadButton = ContextMenu.addButton(unloads);
// idleText is the text of the menu shown last, restored when a download ends
const downloadState = { active: false, cancel: false, idleText: "" };

export { Settings } from "./Settings";
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	downloadState.idleText = `Download ${trackCount} tracks`;
	// While a download runs the button keeps showing its progress, a click on it stops the download
	if (!downloadState.active) downloadButton.text = downloadState.idleText;

	downloadButton.onClick(async () => {
		if (downloadButton.elem === undefined) return;
		// Clicking while a download is running requests it to stop after the current track
		if (downloadState.active) {
			downloadState.cancel = true;
			downloadButton.text = `Stopping...`;
			return;
		}
		// Set before the folder dialog so a second click can't start another download meanwhile
		downloadState.active = true;
		downloadState.cancel = false;
		downloadButton.elem.classList.add("download-button");
		// Keep showing that a stop was requested until the current track is done
		const setStatus = (text: string) => (downloadButton.text = downloadState.cancel ? `Stopping...` : text);
		let downloadFolder = settings.defaultPath;
		// Returns undefined if the save dialog was cancelled
		const getPath = async (mediaItem: MediaItem, pickedPath?: string | string[]) => {
			// Don't show the previous track's progress while this one is prepared
			downloadButton.elem?.style.removeProperty("--progress");
			setStatus(`Fetching filename...`);
			const fileName = await getFileName(mediaItem, settings.downloadQuality);
			setStatus(`Fetching download path...`);
			if (downloadFolder !== undefined) return [downloadFolder, fileName];
			// A retry of the same track keeps the path picked in the save dialog, with this version's extension
			if (typeof pickedPath === "string") return pickedPath.replace(/\.(flac|m4a)$/i, "") + fileName.slice(fileName.lastIndexOf("."));
			return getDownloadPath(fileName);
		};
		const save = async (mediaItem: MediaItem, path: string | string[]) => {
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
		};
		const failed: string[] = [];
		let downloaded = 0;
		try {
			if (downloadFolder === undefined && trackCount > 1) {
				// A click while the dialog is open stops the download, so the button must not say "Download" meanwhile
				setStatus(`Choosing download folder...`);
				downloadFolder = await getDownloadFolder().catch(trace.msg.err.withContext(`Download cancelled, the folder dialog failed:`));
				// Cancelling the folder dialog cancels the download
				if (downloadFolder === undefined) return;
			}
			for await (const original of await mediaCollection.mediaItems()) {
				if (downloadState.cancel) break;
				const title = original.tidalItem.title ?? `${original.id}`;
				// Note a track that fails (e.g. unavailable on TIDAL) and continue with the next one instead of stopping the whole download
				try {
					let mediaItem = original;
					if (settings.useRealMAX) {
						setStatus(`Checking RealMax...`);
						// If the lookup fails, download the track as it is
						mediaItem = (await original.max().catch(trace.warn.withContext(`RealMax lookup failed for ${title}:`))) ?? original;
					}
					let path: string | string[] | undefined;
					try {
						path = await getPath(mediaItem);
						// Cancelling the save dialog stops the download like the Stop click does
						if (path === undefined) break;
						await save(mediaItem, path);
					} catch (err) {
						if (mediaItem === original) throw err;
						// The RealMax version can fail (e.g. be region-locked) while the original does not
						trace.warn.withContext(`RealMax version of ${title} failed:`)(err);
						// A stop requested meanwhile ends the download instead of retrying with the original
						if (downloadState.cancel) break;
						path = await getPath(original, path);
						if (path === undefined) break;
						await save(original, path);
					}
					downloaded++;
				} catch (err) {
					const reason = String(err instanceof Error ? err.message : err);
					failed.push(`${title} (${reason.length > 80 ? `${reason.slice(0, 77)}...` : reason})`);
					trace.err.withContext(`Failed to download ${title}:`)(err);
				}
			}
		} catch (err) {
			// Loading the next track of the collection failed, the remaining tracks can't be downloaded
			trace.msg.err.withContext(`Download stopped, loading the tracks failed:`)(err);
		} finally {
			if (failed.length !== 0) {
				const total = failed.length + downloaded;
				const shown = failed.slice(0, 5).join(", ") + (failed.length > 5 ? ` and ${failed.length - 5} more` : "");
				trace.msg.err(`Failed to download ${failed.length} of ${total} track${total === 1 ? "" : "s"}: ${shown}`);
			}
			downloadState.active = false;
			downloadState.cancel = false;
			downloadButton.text = downloadState.idleText;
			downloadButton.elem?.classList.remove("download-button");
		}
	});

	await downloadButton.show(contextMenu);
});
