import { LunaButtonSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";
import { errSignal, trace } from ".";
import { LastFM, type LastFmSession } from "./LastFM";

import { ReactiveStore } from "@luna/core";

import React from "react";

export const storage = await ReactiveStore.getPluginStorage<{
	session?: LastFmSession;
	ignoreDesktopConnect: boolean;
}>("LastFM", { ignoreDesktopConnect: false });

export const Settings = () => {
	const [session, setSession] = React.useState(storage.session);
	const [loading, setLoading] = React.useState(false);
	const [ignoreDesktopConnect, setIgnoreDesktopConnect] = React.useState(storage.ignoreDesktopConnect);

	const connected = session !== undefined;

	return (
		<LunaSettings>
			<LunaButtonSetting
				title="Session"
				desc={`Click ${connected ? "reconnect" : "connect"} to ${connected ? "re-" : ""}authenticate with LastFM`}
				tooltip={connected ? "Reconnect LastFM" : "Connect LastFM"}
				onClick={async () => {
					setLoading(true);
					const res = await LastFM.authenticate().catch(trace.err.withContext("Authenticating"));

					setSession((storage.session = res?.session));
					if (storage.session !== undefined) errSignal!._ = undefined;
					setLoading(false);
				}}
				loading={loading}
				sx={{
					color: connected ? "green" : undefined,
				}}
			>
				{loading ? "Loading..." : connected ? "Reconnect" : "Connect"}
			</LunaButtonSetting>
			<LunaSwitchSetting
				title="Ignore DesktopConnect playback"
				desc="Don't scrobble or update now playing while another device controls playback via DesktopConnect. Enable if that device already scrobbles (e.g. Last.fm is connected in its TIDAL app)"
				checked={ignoreDesktopConnect}
				onChange={(_, checked) => setIgnoreDesktopConnect((storage.ignoreDesktopConnect = checked))}
			/>
		</LunaSettings>
	);
};
