import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, safeInterval, StyleTag } from "@luna/lib";

import { join } from "path";

import { getDownloadFolder, getDownloadPath, getFileName } from "./helpers";
import { settings } from "./Settings";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);

const downloadButton = ContextMenu.addButton(unloads);

export { Settings } from "./Settings";
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	const defaultText = (downloadButton.text = `Download ${trackCount} tracks`);

	downloadButton.onClick(async () => {
		if (downloadButton.elem === undefined) return;
		const downloadFolder = settings.defaultPath ?? (trackCount > 1 ? await getDownloadFolder() : undefined);
		downloadButton.elem.classList.add("download-button");
		for await (let mediaItem of await mediaCollection.mediaItems()) {
			if (settings.useRealMAX) {
				downloadButton.text = `Checking RealMax...`;
				mediaItem = (await mediaItem.max()) ?? mediaItem;
			}

			downloadButton.text = `Loading tags...`;
			const { tags } = await mediaItem.flacTags();

			downloadButton.text = `Fetching filename...`;
			const fileName = await getFileName(mediaItem, settings.downloadQuality);

			downloadButton.text = `Fetching download path...`;
			const path = downloadFolder !== undefined ? join(downloadFolder, fileName) : await getDownloadPath(fileName);
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
				50
			);
			await mediaItem.download(path, settings.downloadQuality).catch(trace.msg.err.withContext(`Failed to download ${tags.title}`));
			clearInterval();
		}
		downloadButton.text = defaultText;
		downloadButton.elem.classList.remove("download-button");
	});

	await downloadButton.show(contextMenu);
});
