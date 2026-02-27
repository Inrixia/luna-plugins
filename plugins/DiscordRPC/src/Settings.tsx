import { LunaSettings, LunaSwitchSetting, LunaTextSetting, LunaSelectSetting, LunaSelectItem } from "@luna/ui";

import { ReactiveStore } from "@luna/core";

import React from "react";
import { errSignal, trace } from ".";
import { updateActivity } from "./updateActivity";
import { getAvailablePipes } from "./discord.native";

const defaultCustomStatusText = "{track} by {artist}";

export const settings = await ReactiveStore.getPluginStorage("DiscordRPC", {
	displayOnPause: true,
	displayArtistIcon: true,
	displayPlaylistButton: true,
	customStatusText: defaultCustomStatusText,
	pipeId: -1,
});

if (!settings.customStatusText || settings.customStatusText === "") settings.customStatusText = defaultCustomStatusText;

export const Settings = () => {
	const [displayOnPause, setDisplayOnPause] = React.useState(settings.displayOnPause);
	const [displayArtistIcon, setDisplayArtistIcon] = React.useState(settings.displayArtistIcon);
	const [displayPlaylistButton, setDisplayPlaylistButton] = React.useState(settings.displayPlaylistButton);
	const [customStatusText, setCustomStatusText] = React.useState(settings.customStatusText);
	
	const [pipeId, setPipeId] = React.useState(settings.pipeId);
	const [availablePipes, setAvailablePipes] = React.useState<number[]>([]);

	React.useEffect(() => {
		getAvailablePipes().then((pipes) => {
			setAvailablePipes(pipes);
			if (pipes.length > 0 && !pipes.includes(settings.pipeId)) {
				setPipeId((settings.pipeId = pipes[0]));
				updateActivity().catch(() => {});
			}
		}).catch(() => {});
	}, []);

	return (
		<LunaSettings>
			{availablePipes.length > 1 && (
				<LunaSelectSetting
					title="Discord Instance (Pipe ID)"
					desc="Select which Discord instance to connect to."
					value={pipeId.toString()}
					onChange={(e) => {
						setPipeId((settings.pipeId = parseInt(e.target.value, 10)));
						updateActivity()
							.then(() => (errSignal!._ = undefined))
							.catch(trace.err.withContext("Failed to set activity"));
					}}
				>
					{availablePipes.map((pipe) => (
						<LunaSelectItem key={pipe} value={pipe.toString()}>
							Pipe {pipe}
						</LunaSelectItem>
					))}
				</LunaSelectSetting>
			)}
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
			<LunaTextSetting
				title="Status text"
				desc={
					<>
						Customize the status text for Discord activity.
						<br />
						You can use the following tags:
						<ul>
							<li>{`{track}`}</li>
							<li>{`{artist}`}</li>
							<li>{`{album}`}</li>
						</ul>
						Default: <b>{"{track} by {artist}"}</b>
					</>
				}
				value={customStatusText}
				onChange={(e) => {
					if (e.target.value === "" || !e.target.value) setCustomStatusText((settings.customStatusText = defaultCustomStatusText));
					else setCustomStatusText((settings.customStatusText = e.target.value));
					updateActivity()
						.then(() => (errSignal!._ = undefined))
						.catch(trace.err.withContext("Failed to set activity"));
				}}
			/>
		</LunaSettings>
	);
};
