import { observe, Quality, redux } from "@luna/lib";

import { unloads } from "./index.safe";
import { createQualityTags } from "./setQualityTags";
import { settings } from "./Settings";

// Collection grid cards & artist/home page cards
const albumCardSelector = 'article[data-test="grid-item-album"], div[data-test^="album-card-"]';
const albumCardId = /^album-card-(\d+)$/;

const getAlbumQuality = (album: redux.Album) => {
	const qualityTags = Quality.fromMetaTags(album.mediaMetadata?.tags).filter((quality) => quality !== undefined);
	const audioQuality = Quality.fromAudioQuality(album.audioQuality);
	const stereoTags = qualityTags.filter((quality) => quality !== Quality.Atmos && quality !== Quality.Sony630);
	// Spatial only albums have no stereo quality to show
	const bestQuality =
		stereoTags.length === 0 && qualityTags.length !== 0 ? Quality.High : Quality.max(...stereoTags, audioQuality ?? Quality.Lowest);
	// Placeholder for lossy albums so the Low/Lowest tag is displayed
	if (qualityTags.length === 0 && audioQuality !== undefined && audioQuality < Quality.High) qualityTags.push(Quality.High);
	return { qualityTags, bestQuality };
};

const updateAlbumCard = (card: Element) => {
	if (!settings.displayAlbumQualityTags) return;

	const albumId = card.getAttribute("data-test-element-id") ?? card.getAttribute("data-test")?.match(albumCardId)?.[1];
	if (albumId == null) return;

	// Collection grid has a "meta" line (year), other cards have a subtitle line ("2024 • Album") after the title
	const metaLine = card.querySelector(".meta") ?? card.querySelector('a[href^="/album/"]')?.closest("div")?.nextElementSibling;
	if (metaLine == null) return;

	const span = card.querySelector(".album-quality-tags");
	if (span?.getAttribute("album-id") === albumId && span.parentElement === metaLine) return;

	// Remove old span before checking if we need a new one
	span?.remove();

	// Cards are rendered from the redux store so the album is already there, no need to fetch it
	const album = redux.store.getState().content.albums[albumId];
	if (album === undefined) return;

	const { qualityTags, bestQuality } = getAlbumQuality(album);
	const tags = createQualityTags(qualityTags, bestQuality);
	if (tags === undefined) return;

	tags.classList.add("album-quality-tags");
	tags.setAttribute("album-id", albumId);
	metaLine.appendChild(tags);
};

export const updateAlbumCards = () => {
	if (!settings.displayAlbumQualityTags) return document.querySelectorAll(".album-quality-tags").forEach((span) => span.remove());
	document.querySelectorAll(albumCardSelector).forEach(updateAlbumCard);
};

// Observe new album cards
observe(unloads, albumCardSelector, updateAlbumCard);

// Observe album id changes (DOM recycling)
const albumAttrObserver = new MutationObserver((mutations) => {
	for (const mutation of mutations) {
		if ((mutation.target as Element).matches(albumCardSelector)) updateAlbumCard(mutation.target as Element);
	}
});
albumAttrObserver.observe(document.body, {
	subtree: true,
	attributes: true,
	attributeFilter: ["data-test-element-id", "data-test"],
});
unloads.add(() => albumAttrObserver.disconnect());
unloads.add(() => document.querySelectorAll(".album-quality-tags").forEach((span) => span.remove()));

updateAlbumCards();
