import { ReactiveStore } from "@luna/core";
import { LunaLink, LunaSecureTextSetting, LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";

import React from "react";

import { errSignal } from ".";

export const storage = await ReactiveStore.getPluginStorage<{
	userToken?: string;
	domain?: string;
	scrobbling: boolean;
}>("ListenBrainz", {
	domain: "https://api.listenbrainz.org",
	scrobbling: true,
});

/**
 * Turns scrobbling and now playing updates on or off, eg for other plugins. Returns the previous value
 */
export const setScrobbling = (enabled: boolean) => {
	const previous = storage.scrobbling;
	storage.scrobbling = enabled;
	return previous;
};

export const Settings = () => {
	const [token, setToken] = React.useState(storage.userToken);
	const [domain, setDomain] = React.useState(storage.domain);
	const [scrobbling, setScrobblingState] = React.useState(storage.scrobbling);

	React.useEffect(() => {
		errSignal!._ = (token ?? "") === "" ? "User token not set." : undefined;
		errSignal!._ = (domain ?? "") === "" ? "Domain not set." : undefined;
	}, [token, domain]);
	return (
		<LunaSettings>
			<LunaSecureTextSetting
				title="User token"
				desc={
					<>
						User token from{" "}
						<LunaLink fontWeight="bold" href={`${domain?.replace("api.", "")}/settings`}>
							listenbrainz.org/settings
						</LunaLink>
					</>
				}
				value={token}
				onChange={(e) => setToken((storage.userToken = e.target.value))}
				error={!token}
			/>
			<LunaTextSetting
				title="ListenBrainz Domain"
				desc={<>Your instance of listenbrainz</>}
				value={domain}
				defaultValue="https://api.listenbrainz.org"
				onChange={(e) => {
					if (e.target.value === "" || !e.target.value) setDomain("https://api.listenbrainz.org");
					else setDomain((storage.domain = e.target.value));
				}}
				error={!domain}
			/>
			<LunaSwitchSetting
				title="Scrobble"
				desc="Submit listens and now playing. Other plugins can turn this off, eg DesktopConnect while another device controls playback"
				checked={scrobbling}
				onChange={(_, checked) => {
					setScrobbling(checked);
					setScrobblingState(checked);
				}}
			/>
		</LunaSettings>
	);
};
