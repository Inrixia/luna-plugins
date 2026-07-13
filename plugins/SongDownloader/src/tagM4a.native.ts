import { ByteVector, File as TagFile, Picture, PictureType } from "node-taglib-sharp";
import sanitize from "sanitize-filename";

import { join, parse } from "path";

// FlacTags from @luna/lib isn't exported, use a structural type instead
type TagMap = Record<string, string | string[] | undefined | null>;

const first = (value: string | string[] | undefined | null): string | undefined => {
	if (value === undefined || value === null) return undefined;
	return Array.isArray(value) ? value[0] : value;
};
const asArray = (value: string | string[] | undefined | null): string[] => {
	if (value === undefined || value === null) return [];
	return (Array.isArray(value) ? value : [value]).filter((entry) => entry !== undefined && entry !== null && entry !== "");
};
const asInt = (value: string | undefined): number | undefined => {
	if (value === undefined) return undefined;
	const parsed = parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
};
const yearFrom = (tags: TagMap): number | undefined => {
	const year = asInt(first(tags.year));
	if (year && year >= 1 && year <= 9999) return year;
	const date = first(tags.date);
	if (date && date.length >= 4) {
		const dateYear = asInt(date.slice(0, 4));
		if (dateYear && dateYear >= 1 && dateYear <= 9999) return dateYear;
	}
	return undefined;
};

/**
 * Writes metadata to a downloaded m4a file.
 * FLAC downloads are tagged in-flight by the FlacStreamTagger, but DASH (m4a) streams are written to disk untagged.
 * Best-effort: a field that fails to write is skipped instead of aborting the rest.
 */
export const tagM4a = async (path: string | string[], tags: TagMap, coverUrl?: string): Promise<void> => {
	// Resolve to the same path download() wrote to (it joins & sanitizes the basename)
	if (Array.isArray(path)) path = join(...path);
	const parsedPath = parse(path);
	path = join(parsedPath.dir, sanitize(parsedPath.base));

	// Fetch the cover before opening the file so a network failure can't corrupt it
	let cover: Picture | undefined;
	if (coverUrl) {
		try {
			const res = await fetch(coverUrl);
			if (res.ok) {
				cover = Picture.fromData(ByteVector.fromByteArray(Buffer.from(await res.arrayBuffer())));
				cover.type = PictureType.FrontCover;
				cover.mimeType = res.headers.get("content-type") ?? "image/jpeg";
			}
		} catch {}
	}

	let file: TagFile | undefined;
	try {
		file = TagFile.createFromPath(path);
		const tag = file.tag;

		const trySet = (set: () => void) => {
			try {
				set();
			} catch {}
		};

		const title = first(tags.title);
		if (title) trySet(() => (tag.title = title));

		const performers = asArray(tags.artist);
		if (performers.length) trySet(() => (tag.performers = performers));

		const albumArtists = asArray(tags.albumArtist);
		if (albumArtists.length) trySet(() => (tag.albumArtists = albumArtists));

		const album = first(tags.album);
		if (album) trySet(() => (tag.album = album));

		const year = yearFrom(tags);
		if (year) trySet(() => (tag.year = year));

		const copyright = first(tags.copyright);
		if (copyright) trySet(() => (tag.copyright = copyright));

		const comment = first(tags.comment);
		if (comment) trySet(() => (tag.comment = comment));

		const genres = asArray(tags.genres);
		if (genres.length) trySet(() => (tag.genres = genres));

		const trackNumber = asInt(first(tags.trackNumber));
		if (trackNumber) trySet(() => (tag.track = trackNumber));

		const totalTracks = asInt(first(tags.totalTracks));
		if (totalTracks) trySet(() => (tag.trackCount = totalTracks));

		const discNumber = asInt(first(tags.discNumber));
		if (discNumber) trySet(() => (tag.disc = discNumber));

		const bpm = asInt(first(tags.bpm));
		if (bpm) trySet(() => (tag.beatsPerMinute = bpm));

		const lyrics = first(tags.lyrics);
		if (lyrics) trySet(() => (tag.lyrics = lyrics));

		const isrc = first(tags.isrc);
		if (isrc) trySet(() => (tag.isrc = isrc));

		const musicBrainzTrackId = first(tags.musicbrainz_trackid);
		if (musicBrainzTrackId) trySet(() => (tag.musicBrainzTrackId = musicBrainzTrackId));

		const musicBrainzAlbumId = first(tags.musicbrainz_albumid);
		if (musicBrainzAlbumId) trySet(() => (tag.musicBrainzReleaseId = musicBrainzAlbumId));

		if (cover) trySet(() => (tag.pictures = [cover!]));

		file.save();
	} finally {
		file?.dispose();
	}
};
