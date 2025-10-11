import { LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";

import { ReactiveStore } from "@luna/core";

import React from "react";
import { errSignal, trace } from ".";
import { updateActivity } from "./updateActivity";

export const settings = await ReactiveStore.getPluginStorage("DiscordRPC", {
	displayOnPause: true,
	displayArtistIcon: true,
	displayPlaylistButton: true,
	status: 1,
	customStatusText: ""
});

export const Settings = () => {
	const [displayOnPause, setDisplayOnPause] = React.useState(settings.displayOnPause);
	const [displayArtistIcon, setDisplayArtistIcon] = React.useState(settings.displayArtistIcon);
	const [displayPlaylistButton, setDisplayPlaylistButton] = React.useState(settings.displayPlaylistButton)
	const [status, setStatus] = React.useState(settings.status);
	const [customStatusText, setCustomStatusText] = React.useState(settings.customStatusText);

	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="Display activity when paused"
				desc="If disabled, when paused discord wont show the activity"
				tooltip="Display activity"
				checked={displayOnPause}
				onChange={(_, checked) => {
					setDisplayOnPause((settings.displayOnPause = checked));
					updateActivity()
						.then(() => (errSignal!._ = undefined))
						.catch(trace.err.withContext("Failed to set activity"));
				}}
			/>
			<LunaSwitchSetting
				title="Display artist icon"
				desc="Shows the artist icon in the activity"
				tooltip="Display artist icon"
				checked={displayArtistIcon}
				onChange={(_, checked) => {
					setDisplayArtistIcon((settings.displayArtistIcon = checked));
					updateActivity()
						.then(() => (errSignal!._ = undefined))
						.catch(trace.err.withContext("Failed to set activity"));
				}}
			/>
			<LunaSwitchSetting
				title="Display playlist button"
				desc="When playing a playlist a button appears for it in the activity"
				tooltip="Display playlist button"
				checked={displayPlaylistButton}
				onChange={(_, checked) => {
					setDisplayPlaylistButton((settings.displayPlaylistButton = checked));
					updateActivity()
						.then(() => (errSignal!._ = undefined))
						.catch(trace.err.withContext("Failed to set activity"));
				}}
			/>
			<LunaSelectSetting
				title="Status text"
				desc="What text that you're 'Listening to' in your Discord status"
				value={status}
				onChange={(e) => {
					const newStatus = parseInt(e.target.value);
					setStatus((settings.status = newStatus));
				}}
			>
				<LunaSelectItem value="0" children="Listening to TIDAL" />
				<LunaSelectItem value="1" children="Listening to [Artist Name]" />
				<LunaSelectItem value="2" children="Listening to [Track Name]" />
				<LunaSelectItem value="3" children="Custom" />
			</LunaSelectSetting>

			{status === 3 && (
				<LunaTextSetting
					title="Custom status text"
					desc={
						<>
							Set your own message for Discord activity.
							<br />
							You can use the following tags:
							<ul>
								<li>{`{artist}`}</li>
								<li>{`{track}`}</li>
								<li>{`{album}`}</li>
							</ul>
							Example: <b>{"Listening to {track} by {artist}"}</b>
						</>
					}
					value={customStatusText}
					onChange={(e) => {
						setCustomStatusText((settings.customStatusText = e.target.value));
					}}
				/>
			)}
		</LunaSettings>
	);
};
