import { NowPlaying } from "./types/NowPlaying";
import { Scrobble } from "./types/Scrobble";

import type { AnyRecord } from "@inrixia/helpers";
import { findModuleProperty, ftch } from "@luna/core";
import { clipboardWriteText } from "@luna/lib.native";
import { storage } from "./Settings";
import { hash } from "./hash.native";

export type NowPlayingOpts = {
	track: string;
	artist: string;
	album?: string;
	trackNumber?: string;
	context?: string;
	mbid?: string;
	duration?: string;
	albumArtist?: string;
};

export interface ScrobbleOpts extends NowPlayingOpts {
	timestamp: string;
	streamId?: string;
	chosenByUser?: string;
}

type ResponseType<T> =
	| (T & { message?: undefined })
	| {
			message: string;
	  };

export type LastFmSession = {
	name: string;
	key: string;
	subscriber: number;
};

export class LastFM {
	public static readonly apiKey?: string = findModuleProperty<string>((key, value) => key === "lastFmApiKey" && typeof value === "string")!.value;
	public static readonly secret?: string = findModuleProperty<string>((key, value) => key === "lastFmSecret" && typeof value === "string")!.value;
	static {
		if (this.secret === undefined) throw new Error("Last.fm secret not found");
		if (this.apiKey === undefined) throw new Error("Last.fm API key not found");
	}

	private static async apiSignature(params: AnyRecord) {
		const sig =
			Object.keys(params)
				.filter((key) => key !== "format" && key !== undefined)
				.sort()
				.map((key) => `${key}${params[key]}`)
				.join("") + this.secret;
		return hash(sig);
	}

	private static async sendRequest<T>(method: string, params?: AnyRecord) {
		params ??= {};
		if (!method.startsWith("auth")) params.sk = this.session.key;
		params.method = method;
		params.api_key = this.apiKey!;
		params.format = "json";
		params.api_sig = await LastFM.apiSignature(params);

		const data = await ftch.json<ResponseType<T>>(`https://ws.audioscrobbler.com/2.0/`, {
			headers: {
				"Content-type": "application/x-www-form-urlencoded",
				"Accept-Charset": "utf-8",
			},
			method: "POST",
			body: new URLSearchParams(params).toString(),
		});

		if (data.message) throw new Error(data.message);

		return <T>data;
	}

	public static async authenticate() {
		const { token } = await LastFM.sendRequest<{ token: string }>("auth.getToken");
		const authUrl = `https://www.last.fm/api/auth/?api_key=${this.apiKey}&token=${token}`;
		window.open(authUrl, "_blank");
		await clipboardWriteText(authUrl);
		for (let i = 0; i < 10; i++) {
			const session = await this.sendRequest<{ session: LastFmSession }>("auth.getSession", { token }).catch(() => undefined);
			if (session !== undefined) return session;
			await new Promise((res) => setTimeout(res, 1000));
		}
		throw new Error("Timed out waiting for user to confirm session in browser");
	}

	public static get session() {
		if (storage.session === undefined) throw new Error("Session not set, please update via settings!");
		return storage.session;
	}

	public static async updateNowPlaying(opts: NowPlayingOpts) {
		return LastFM.sendRequest<NowPlaying>("track.updateNowPlaying", opts);
	}

	public static async scrobble(opts: ScrobbleOpts) {
		return LastFM.sendRequest<Scrobble>("track.scrobble", opts);
	}
}
