import { ReactiveStore } from "@luna/core";
import { MediaItem, Quality, type redux } from "@luna/lib";
import { LunaButtonSetting, LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting, LunaTextSetting } from "@luna/ui";

import React from "react";
import { getDownloadFolder } from "./helpers";

const defaultFilenameFormat = "{artist} - {album} - {title}";

type Settings = {
	downloadQuality: redux.AudioQuality;
	defaultPath?: string;
	pathFormat: string;
	useRealMAX: boolean;
};
export const settings = await ReactiveStore.getPluginStorage<Settings>("SongDownloader", {
	downloadQuality: Quality.Max.audioQuality,
	pathFormat: defaultFilenameFormat,
	useRealMAX: true,
});

// Sanitize download quality
if (Quality.fromAudioQuality(settings.downloadQuality) === undefined) settings.downloadQuality = Quality.Max.audioQuality;

export const Settings = () => {
	const [downloadQuality, setDownloadQuality] = React.useState(settings.downloadQuality);
	const [defaultPath, setDefaultPath] = React.useState(settings.defaultPath);
	const [pathFormat, setPathFormat] = React.useState(settings.pathFormat);
	const [useRealMAX, setUseRealMAX] = React.useState(settings.useRealMAX);

	return (
		<LunaSettings>
			<LunaSelectSetting
				title="Download quality"
				value={downloadQuality}
				onChange={(e) => setDownloadQuality((settings.downloadQuality = e.target.value))}
			>
				{Object.values(Quality.lookups.audioQuality).map((quality) => {
					if (typeof quality !== "string" && quality.audioQuality !== Quality.MQA.audioQuality)
						return <LunaSelectItem key={quality.name} value={quality.audioQuality} children={quality.name} />;
				})}
			</LunaSelectSetting>
			<LunaSwitchSetting
				title="Use RealMAX to find the highest quality"
				value={useRealMAX}
				onChange={(_, checked) => setUseRealMAX((settings.useRealMAX = checked))}
			/>
			<LunaButtonSetting
				title="Default save path"
				desc={
					<>
						Set a default folder to save files to (will disable prompting for path on download)
						{defaultPath && (
							<>
								<br />
								Using {defaultPath}
							</>
						)}
					</>
				}
				children={defaultPath === undefined ? "Set default folder" : "Clear default folder"}
				onClick={async () => {
					if (defaultPath !== undefined) return setDefaultPath((settings.defaultPath = undefined));
					setDefaultPath((settings.defaultPath = await getDownloadFolder()));
				}}
			/>
			<LunaTextSetting
				title="Path format"
				desc={
					<>
						Define subfolders using <b>/</b>.
						<br />
						For example: {"{artist}/{album}/{title}"}
						<br />
						Saves in subfolder artist/album/ named <b>title.flac</b>.
						<div style={{ marginTop: 8 }} />
						You can use the following tags:
						<ul>
							{MediaItem.availableTags.map((tag) => (
								<li key={tag}>{tag}</li>
							))}
						</ul>
					</>
				}
				value={pathFormat}
				onChange={(e) => setPathFormat((settings.pathFormat = e.target.value))}
			/>
		</LunaSettings>
	);
};
