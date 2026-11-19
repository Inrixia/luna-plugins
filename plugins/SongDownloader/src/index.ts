import { Tracer, type LunaUnload } from "@luna/core";
import { Album, ContextMenu, Playlist, safeInterval, StyleTag, type MediaItem } from "@luna/lib";

import { getDownloadFolder, getDownloadPath, getFileName } from "./helpers";
import { settings } from "./Settings";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);

const downloadButton = ContextMenu.addButton(unloads);
const albumsButton = ContextMenu.addButton(unloads);
const downloadState = { active: false, cancel: false };

/**
 * Yields every track of the albums the playlist's tracks are on, followed by any playlist track that is not part of a loaded album.
 */
async function* withFullAlbums(playlist: Playlist): AsyncGenerator<MediaItem> {
	const seenAlbums = new Set<string>();
	const seenItems = new Set<string>();
	for await (const playlistItem of await playlist.mediaItems()) {
		const albumId = playlistItem.tidalItem.album?.id;
		if (albumId !== undefined && !seenAlbums.has(String(albumId))) {
			seenAlbums.add(String(albumId));
			const album = await Album.fromId(albumId);
			for await (const albumItem of (await album?.mediaItems()) ?? []) {
				if (seenItems.has(String(albumItem.id))) continue;
				seenItems.add(String(albumItem.id));
				yield albumItem;
			}
		}
		if (seenItems.has(String(playlistItem.id))) continue;
		seenItems.add(String(playlistItem.id));
		yield playlistItem;
	}
}

const download = async (button: typeof downloadButton, mediaItems: AsyncIterable<MediaItem>, askFolder: boolean) => {
	const defaultText = button.text;
	const downloadFolder = settings.defaultPath ?? (askFolder ? await getDownloadFolder() : undefined);
	downloadState.active = true;
	downloadState.cancel = false;
	button.elem?.classList.add("download-button");
	try {
		for await (let mediaItem of mediaItems) {
			if (downloadState.cancel) break;
			if (settings.useRealMAX) {
				button.text = `Checking RealMax...`;
				mediaItem = (await mediaItem.max()) ?? mediaItem;
			}

			button.text = `Loading tags...`;
			const { tags } = await mediaItem.flacTags();

			button.text = `Fetching filename...`;
			const fileName = await getFileName(mediaItem, settings.downloadQuality);

			button.text = `Fetching download path...`;
			const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
			if (path === undefined) return;

			button.text = `Downloading...`;
			const clearInterval = safeInterval(
				unloads,
				async () => {
					const progress = await mediaItem.downloadProgress();
					if (progress === undefined) return;
					const { total, downloaded } = progress;
					if (total === undefined || downloaded === undefined) return;
					const percent = (downloaded / total) * 100;
					button.elem?.style.setProperty("--progress", `${percent}%`);
					const downloadedMB = (downloaded / 1048576).toFixed(0);
					const totalMB = (total / 1048576).toFixed(0);
					button.text = `Downloading... ${downloadedMB}/${totalMB}MB ${percent.toFixed(0)}%`;
				},
				50,
			);
			await mediaItem.download(path, settings.downloadQuality).catch(trace.msg.err.withContext(`Failed to download ${tags.title}`));
			clearInterval();
		}
	} finally {
		downloadState.active = false;
		downloadState.cancel = false;
		button.text = defaultText;
		button.elem?.classList.remove("download-button");
	}
};

export { Settings } from "./Settings";
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	for (const button of [downloadButton, albumsButton]) {
		button.onClick(async () => {
			if (button.elem === undefined) return;
			// Clicking while a download is running requests it to stop after the current track
			if (downloadState.active) {
				downloadState.cancel = true;
				button.text = `Stopping...`;
				return;
			}
			if (button === albumsButton && mediaCollection instanceof Playlist) return download(button, withFullAlbums(mediaCollection), true);
			return download(button, await mediaCollection.mediaItems(), trackCount > 1);
		});
	}

	downloadButton.text = `Download ${trackCount} tracks`;
	await downloadButton.show(contextMenu);

	if (mediaCollection instanceof Playlist) {
		albumsButton.text = `Download ${trackCount} tracks + full albums`;
		await albumsButton.show(contextMenu);
	}
});
