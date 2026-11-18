import { ReactiveStore } from "@luna/core";
import { MediaItem } from "@luna/lib";
import { LunaSettings, LunaSwitchSetting } from "@luna/ui";
import React from "react";
import { updateAlbumCards } from "./setAlbumQualityTags";
import { formatInfoElem, setFormatInfo } from "./setFormatInfo";

export const settings = await ReactiveStore.getPluginStorage("TidalTags", {
	displayFormatBorder: true,
	displayQalityTags: true,
	displayAlbumQualityTags: true,
	displayFormatColumns: true,
	autoPopulateColumns: false,
});

export const Settings = () => {
	const [displayFormatBorder, setDisplayFormatBorder] = React.useState(settings.displayFormatBorder);
	const [displayQalityTags, setDisplayQalityTags] = React.useState(settings.displayQalityTags);
	const [displayAlbumQualityTags, setDisplayAlbumQualityTags] = React.useState(settings.displayAlbumQualityTags);
	const [displayFormatColumns, setDisplayFormatColumns] = React.useState(settings.displayFormatColumns);
	const [autoPopulateColumns, setAutoPopulateColumns] = React.useState(settings.autoPopulateColumns);
	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="Format info border"
				desc="Display a border around format Info"
				checked={displayFormatBorder}
				onChange={(_, checked) => {
					setDisplayFormatBorder((settings.displayFormatBorder = checked));
					if (!checked) formatInfoElem.style.border = "none";
					else MediaItem.fromPlaybackContext().then(setFormatInfo);
				}}
			/>
			<LunaSwitchSetting
				title="Quality tags"
				desc="Display quality tags in the tracklist"
				checked={displayQalityTags}
				onChange={(_, checked) => {
					setDisplayQalityTags((settings.displayQalityTags = checked));
				}}
			/>
			<LunaSwitchSetting
				title="Album quality tags"
				desc="Display quality tags on album cards"
				checked={displayAlbumQualityTags}
				onChange={(_, checked) => {
					setDisplayAlbumQualityTags((settings.displayAlbumQualityTags = checked));
					updateAlbumCards();
				}}
			/>
			<LunaSwitchSetting
				title="Format columns"
				desc="Display format columns in the tracklist"
				checked={displayFormatColumns}
				onChange={(_, checked) => {
					setDisplayFormatColumns((settings.displayFormatColumns = checked));
				}}
			/>
			<LunaSwitchSetting
				title="Auto populate columns"
				desc="Populate columns with format info without having to play the track"
				checked={autoPopulateColumns}
				onChange={(_, checked) => {
					setAutoPopulateColumns((settings.autoPopulateColumns = checked));
				}}
			/>
		</LunaSettings>
	);
};
