import { LunaButtonSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";
import { errSignal, trace } from ".";
import { LastFM, type LastFmSession } from "./LastFM";

import { ReactiveStore } from "@luna/core";

import React from "react";

export const storage = await ReactiveStore.getPluginStorage<{
	session?: LastFmSession;
	scrobbling: boolean;
}>("LastFM", { scrobbling: true });

/**
 * Turns scrobbling and now playing updates on or off, eg for other plugins. Returns the previous value
 */
export const setScrobbling = (enabled: boolean) => {
	const previous = storage.scrobbling;
	storage.scrobbling = enabled;
	return previous;
};

export const Settings = () => {
	const [session, setSession] = React.useState(storage.session);
	const [loading, setLoading] = React.useState(false);
	const [scrobbling, setScrobblingState] = React.useState(storage.scrobbling);

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
				title="Scrobble"
				desc="Scrobble and update now playing. Other plugins can turn this off, eg DesktopConnect while another device controls playback"
				checked={scrobbling}
				onChange={(_, checked) => {
					setScrobbling(checked);
					setScrobblingState(checked);
				}}
			/>
		</LunaSettings>
	);
};
