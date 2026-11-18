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
		try {
			for await (let mediaItem of await mediaCollection.mediaItems()) {
				if (downloadState.cancel) break;
				// Report a track that fails (e.g. unavailable on TIDAL) and continue with the next one instead of stopping the whole download
				try {
					// Don't show the previous track's progress while this one is prepared
					downloadButton.elem?.style.removeProperty("--progress");
					if (settings.useRealMAX) {
						downloadButton.text = `Checking RealMax...`;
						mediaItem = (await mediaItem.max()) ?? mediaItem;
					}

					downloadButton.text = `Loading tags...`;
					await mediaItem.flacTags();

					downloadButton.text = `Fetching filename...`;
					const fileName = await getFileName(mediaItem, settings.downloadQuality);

					downloadButton.text = `Fetching download path...`;
					const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
					if (path === undefined) return;

					downloadButton.text = `Downloading...`;
					const clearInterval = safeInterval(
						unloads,
						async () => {
							const progress = await mediaItem.downloadProgress();
							if (progress === undefined) return;
							const { total, downloaded } = progress;
							if (total === undefined || downloaded === undefined) return;
							const percent = (downloaded / total) * 100;
							downloadButton.elem!.style.setProperty("--progress", `${percent}%`);
							const downloadedMB = (downloaded / 1048576).toFixed(0);
							const totalMB = (total / 1048576).toFixed(0);
							downloadButton.text = `Downloading... ${downloadedMB}/${totalMB}MB ${percent.toFixed(0)}%`;
						},
						50,
					);
					try {
						await mediaItem.download(path, settings.downloadQuality);
					} finally {
						clearInterval();
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
