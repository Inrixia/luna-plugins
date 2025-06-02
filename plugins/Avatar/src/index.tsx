import { LunaUnload, ReactiveStore } from "@luna/core";
import { redux, StyleTag } from "@luna/lib";
import { LunaSettings, LunaTextSetting } from "@luna/ui";
import React from "react";
import { md5 } from "./md5.native";


export const settings = await ReactiveStore.getPluginStorage<{
	customUrl?: string;
}>("Avatar");

export const unloads = new Set<LunaUnload>();
const avatarCSS = new StyleTag("avatarCSS", unloads);
const hash = await md5(redux.store.getState().user.meta.email);

function applyAvatarCSS() {
	// Thx @n1ckoates
	avatarCSS.css = `
    	[class^="_profilePicture_"] {
      		background-image: url("${settings.customUrl ?? `https://www.gravatar.com/avatar/${hash}?d=identicon`}");
      		background-size: cover;
    	}
    	[class^="_profilePicture_"] svg {
      		display: none;
    	}
  `;
}

applyAvatarCSS();

export const Settings = () => {
	const [customUrl, setCustomUrl] = React.useState(settings.customUrl);

	md5(redux.store.getState().user.meta.email).then((mailHash) => {
		if (customUrl === "" || customUrl === undefined)
			setCustomUrl(`https://www.gravatar.com/avatar/${mailHash}?d=identicon`);
	});

	React.useEffect(applyAvatarCSS, [customUrl])

	return (
		<LunaSettings>
			<LunaTextSetting
				title="Avatar url"
				desc="Url to the avatar image you want to use. If empty Gravatar will be used."
				value={customUrl}
				onChange={(e) => setCustomUrl((settings.customUrl = e.target.value))}
			/>
		</LunaSettings>
	);
};

