import { ReactiveStore } from "@luna/core";
import { LunaSetting, LunaSettings, LunaSwitchSetting, LunaTrashButton } from "@luna/ui";
import React from "react";

import type { ExclusionList } from "./exclusions";

export const settings = await ReactiveStore.getPluginStorage("RealMAX", {
	displayInfoPopups: true,
	// trackId -> label
	keepVersion: {} as Record<string, string>,
	neverUse: {} as Record<string, string>,
});

const TrackList = ({ list, title, desc }: { list: ExclusionList; title: string; desc: string }) => {
	const [tracks, setTracks] = React.useState(() => ({ ...settings[list] }));
	const ids = Object.keys(tracks);
	return (
		<LunaSetting
			title={title}
			desc={ids.length === 0 ? `${desc}. Empty, add tracks from their context menu.` : desc}
			direction="column"
			alignItems="stretch"
		>
			<div style={{ display: "flex", flexDirection: "column" }}>
				{ids.map((id) => (
					<div key={id} style={{ display: "flex", alignItems: "center" }}>
						<span style={{ flexGrow: 1 }}>{tracks[id]}</span>
						<LunaTrashButton
							title="Remove"
							onClick={() => {
								delete settings[list][id];
								setTracks({ ...settings[list] });
							}}
						/>
					</div>
				))}
			</div>
		</LunaSetting>
	);
};

export const Settings = () => {
	const [displayInfoPopups, setDisplayInfoPopups] = React.useState(settings.displayInfoPopups);
	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="Display info popups"
				desc="Display a popup when a track is replaced in the play queue by RealMAX"
				checked={displayInfoPopups}
				onChange={(_, checked) => {
					setDisplayInfoPopups((settings.displayInfoPopups = checked));
				}}
			/>
			<TrackList list="keepVersion" title="Kept versions" desc="RealMAX never replaces these tracks" />
			<TrackList list="neverUse" title="Never used versions" desc="RealMAX never picks these tracks as a replacement" />
		</LunaSettings>
	);
};
