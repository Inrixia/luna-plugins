import { ReactiveStore } from "@luna/core";
import { LunaLink, LunaSecureTextSetting, LunaSettings, LunaTextSetting } from "@luna/ui";

import React from "react";

import { errSignal } from ".";

export const storage = await ReactiveStore.getPluginStorage<{
	userToken?: string;
	domain?: string;
}>("ListenBrainz", {
	domain: "https://api.listenbrainz.org",
});

export const Settings = () => {
	const [token, setToken] = React.useState(storage.userToken);
	const [domain, setDomain] = React.useState(storage.domain);

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
						<LunaLink fontWeight="bold" href={`${domain}/settings`}>
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
		</LunaSettings>
	);
};
