// Minimal @luna/lib for node:test. Quality is the real class (it is pure), the rest are fakes tests drive.
import type { LunaUnload, LunaUnloads } from "./lunaCore";

// The luna package's exports don't include its sources, so by path
export { Quality } from "../../node_modules/luna/plugins/lib/src/classes/Quality";

type Artist = { name?: string } | undefined;

/** Callbacks given to MediaItem.onX / PlayState.onX emitters, by emitter name ("onMediaTransition", "onScrobble"...) */
export const listeners: Record<string, ((arg: any) => unknown)[]> = {};
const emitter =
	(name: string) =>
	(_unloads: LunaUnloads, cb: (arg: any) => unknown): LunaUnload => {
		(listeners[name] ??= []).push(cb);
		return () => {};
	};

export class MediaItem {
	public static readonly onMediaTransition = emitter("onMediaTransition");
	public static readonly onPreMediaTransition = emitter("onPreMediaTransition");
	public static readonly onPreload = emitter("onPreload");
	/** Same as the real ContentBase.artistNames */
	public static async artistNames(artists?: Promise<Promise<Artist>[]> | Promise<Artist>[]): Promise<string[]> {
		const _artists = await artists;
		if (!_artists) return [];
		const names = [];
		for await (const artist of _artists) if (artist?.name) names.push(artist.name);
		return names;
	}
	public static fromPlaybackContext: () => Promise<any> = async () => undefined;
	public static fromIsrc: (isrc: string) => Promise<any> = async () => undefined;
	public static fromId: (id: unknown) => Promise<any> = async () => undefined;
	public static readonly availableTags = [
		"title",
		"trackNumber",
		"discNumber",
		"bpm",
		"year",
		"date",
		"copyright",
		"REPLAYGAIN_TRACK_GAIN",
		"REPLAYGAIN_TRACK_PEAK",
		"comment",
		"isrc",
		"upc",
		"musicbrainz_trackid",
		"musicbrainz_albumid",
		"artist",
		"album",
		"albumArtist",
		"genres",
		"organization",
		"totalTracks",
		"lyrics",
	] as const;
}

/** Fake track selection: `mediaItems()` yields the given items */
export class MediaItems {
	constructor(private readonly items: unknown[]) {}
	public async mediaItems() {
		const items = this.items;
		return (async function* () {
			yield* items;
		})();
	}
}

export const PlayState: Record<string, any> = {
	playing: false,
	playTime: 0,
	playbackContext: {},
	onScrobble: emitter("onScrobble"),
	onState: emitter("onState"),
};

/** Every redux.actions[type](payload) call, in order */
export const dispatched: { type: string; payload: unknown }[] = [];
/** Callbacks registered with redux.intercept, by action type */
export const intercepts: Record<string, ((payload: any, action?: string) => unknown)[]> = {};
const store = {
	state: <Record<string, any>>{},
	getState: () => store.state,
};
export const redux = {
	store,
	actions: new Proxy(<Record<string, (payload?: unknown) => void>>{}, {
		get: (_, type: string) => (payload?: unknown) => void dispatched.push({ type, payload }),
	}),
	/** Like the real one: the returned unload, also added to unloads, removes the callback again */
	intercept: (types: string | string[], unloads: LunaUnloads, cb: (payload: any, action?: string) => unknown) => {
		const list = Array.isArray(types) ? types : [types];
		for (const type of list) (intercepts[type] ??= []).push(cb);
		const unload = () => {
			for (const type of list) {
				const i = intercepts[type]?.indexOf(cb) ?? -1;
				if (i !== -1) intercepts[type].splice(i, 1);
			}
		};
		unloads.add(unload);
		return unload;
	},
};

export type FakeButton = {
	text?: string;
	elem?: { parentElement?: { parentElement?: { remove: () => void } } };
	click?: () => void;
	shownIn?: unknown;
	onClick: (cb: () => void) => void;
	show: (contextMenu: unknown) => Promise<void>;
};
/** Buttons made with ContextMenu.addButton, and handlers given to ContextMenu.onMediaItem */
export const contextMenu = { buttons: <FakeButton[]>[], onMediaItem: <((arg: any) => Promise<void>)[]>[] };
export const ContextMenu = {
	addButton: (_unloads: LunaUnloads) => {
		const button: FakeButton = {
			onClick(cb) {
				button.click = cb;
			},
			async show(menu) {
				button.shownIn = menu;
			},
		};
		contextMenu.buttons.push(button);
		return button;
	},
	onMediaItem: (_unloads: LunaUnloads, cb: (arg: any) => Promise<void>) => void contextMenu.onMediaItem.push(cb),
};

export const Playlist = {
	create: async (_title: string, _opts: unknown): Promise<unknown> => undefined,
};

export const observe = () => {};
export const observePromise = async () => undefined;
export class StyleTag {}
