import { MediaItem } from "@luna/lib";
import { settings } from "./Settings";

const STR_MAX_LEN = 127;
export const fmtStr = (s?: string) => {
    if (!s) return;
    if (s.length < 2) s += " ";
    return s.length >= STR_MAX_LEN ? s.slice(0, STR_MAX_LEN - 3) + "..." : s;
};

/** Returns the status line shown in Discord (Listening to ... etc.) */
export const getStatusText = async (mediaItem: MediaItem) => {
    const artistNames = await MediaItem.artistNames(await mediaItem.artists()) ?? "Unknown Artist";
    const artist = artistNames.join(", ");
    const track = await mediaItem.title();
    const album = await (await mediaItem.album())?.title() ?? "";

    switch (settings.status) {
        case 0:
            return "Listening to TIDAL";
        case 1:
            return `Listening to ${artist}`;
        case 2:
            return `Listening to ${track}`;
        case 3: {
            let custom = settings.customStatusText || "";
            custom = custom
                .replaceAll("{artist}", artist)
                .replaceAll("{track}", track)
                .replaceAll("{album}", album);
            return fmtStr(custom);
        }
        default:
            return undefined;
    }
};
