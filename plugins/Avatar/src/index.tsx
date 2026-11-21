import { LunaUnload, ReactiveStore } from "@luna/core";
import { redux, safeTimeout, StyleTag } from "@luna/lib";
import { LunaSettings, LunaTextSetting } from "@luna/ui";
import React from "react";
import { md5 } from "./md5.native";

export const unloads = new Set<LunaUnload>();
const avatarCSS = new StyleTag("avatarCSS", unloads);

export const settings = await ReactiveStore.getPluginStorage<{
	customUrl?: string;
}>("Avatar");

const setAvatar = async (customUrl?: string) => {
	if (customUrl === "" || customUrl === undefined) {
		// Not known while logged out
		const email = redux.store.getState().user.meta?.email;
		if (!email) return;
		// Gravatar hashes the trimmed, lowercased email
		const emailHash = await md5(email.trim().toLowerCase());
		customUrl = settings.customUrl = `https://www.gravatar.com/avatar/${emailHash}?d=identicon`;
	}
	// Thx @n1ckoates
	avatarCSS.css = `
		[class^="_profilePicture_"] {
			background-image: url("${customUrl}");
			background-size: cover;
		}

		[class^="_profilePicture_"] svg {
			display: none;
		}
	`;
	return customUrl;
};

safeTimeout(
	unloads,
	() => {
		setAvatar(settings.customUrl);
	},
	250
);

export const Settings = () => {
	const [customUrl, setCustomUrl] = React.useState(settings.customUrl);

	return (
		<LunaSettings>
			<LunaTextSetting
				title="Avatar url"
				desc="Url to the avatar image you want to use. If empty Gravatar will be used."
				value={customUrl}
				onChange={async (e) => {
					settings.customUrl = e.target.value;
					setCustomUrl((await setAvatar(settings.customUrl)) ?? "");
				}}
			/>
		</LunaSettings>
	);
};
