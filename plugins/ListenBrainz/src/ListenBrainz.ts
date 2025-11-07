import type { Payload } from "./ListenBrainzTypes";
import { storage } from "./Settings";

type NowPlayingPayload = Omit<Payload, "listened_at">;

export class ListenBrainz {
	private static async sendRequest(body?: { listen_type: "single" | "playing_now"; payload: Payload[] | NowPlayingPayload[] }) {
		if (storage.userToken === "") throw new Error("User token not set");
		return fetch(`${storage.domain}/1/submit-listens`, {
			headers: {
				"Content-type": "application/json",
				Accept: "application/json",
				Authorization: `Token ${storage.userToken}`,
			},
			method: "POST",
			body: JSON.stringify(body),
		});
	}

	public static updateNowPlaying(payload: NowPlayingPayload) {
		// @ts-expect-error Ensure this doesnt exist
		delete payload.listened_at;
		return ListenBrainz.sendRequest({
			listen_type: "playing_now",
			payload: [payload],
		});
	}

	public static scrobble(payload: Payload) {
		return ListenBrainz.sendRequest({
			listen_type: "single",
			payload: [payload],
		});
	}
}
