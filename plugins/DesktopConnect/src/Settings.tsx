import { ReactiveStore } from "@luna/core";
import { LunaLink, LunaSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import React from "react";

import { nativeUrl } from "./deprecated";

export const storage = await ReactiveStore.getPluginStorage("DesktopConnect", {
	pauseScrobbling: false,
});

export const Settings = () => {
	const [pauseScrobbling, setPauseScrobbling] = React.useState(storage.pauseScrobbling);
	return (
		<LunaSettings>
			<LunaSetting
				title="Deprecated: use DesktopConnectNative"
				desc={
					<>
						DesktopConnect is no longer developed.{" "}
						<LunaLink fontWeight="bold" href={nativeUrl}>
							DesktopConnectNative
						</LunaLink>{" "}
						replaces it with its own TIDAL Connect receiver. Install it from Settings → Plugin Store and disable this plugin
					</>
				}
			/>
			<LunaSwitchSetting
				title="Pause scrobbling during remote sessions"
				desc="Turns scrobbling off in LastFM and ListenBrainz while another device controls playback, and back on when it ends. Enable if that device already scrobbles (eg Last.fm is connected in its TIDAL app)"
				checked={pauseScrobbling}
				onChange={(_, checked) => setPauseScrobbling((storage.pauseScrobbling = checked))}
			/>
		</LunaSettings>
	);
};
