import { LunaPlugin, type LunaUnload, type Tracer } from "@luna/core";
import { confirm } from "@luna/ui";

// DesktopConnect is replaced by DesktopConnectNative (its own TIDAL Connect receiver), published in the Lunatic UI store
const nativeName = "@solomag/desktop-connect-native";
export const nativeUrl = "https://github.com/Solomag/lunatic-ui/tree/master/plugins/DesktopConnectNative";
// The plugin as the Lunatic UI store lists it
const nativePluginUrl = "https://github.com/Solomag/lunatic-ui/releases/download/latest/solomag.desktop-connect-native";
const deprecatedMessage = "DesktopConnect is deprecated, install DesktopConnectNative from Settings → Plugin Store instead";

type Trace = ReturnType<typeof Tracer>["trace"];
type ConfirmOptions = Parameters<typeof confirm>[0];

// Luna has one confirm dialog: another prompt (eg Luna's update prompt at startup) replaces this one and its answer never comes.
// So it is shown only while no other dialog is open, and shown again when it was replaced
const dialogCheckMs = 1000;
const askUntilAnswered = (unloads: Set<LunaUnload>, options: ConfirmOptions) =>
	new Promise<boolean>((resolve) => {
		let answered = false;
		const check = setInterval(() => {
			if (answered || document.querySelector("[role=dialog]") !== null) return;
			confirm(options).then(({ confirmed }) => {
				answered = true;
				clearInterval(check);
				resolve(confirmed);
			});
		}, dialogCheckMs);
		unloads.add(() => clearInterval(check));
	});

// Asked every time DesktopConnect loads: installs (or enables) DesktopConnectNative, then disables DesktopConnect
export const askToSwitch = async (trace: Trace, unloads: Set<LunaUnload>) => {
	const native = LunaPlugin.getByName(nativeName);
	const hasNative = native?.installed === true;
	const confirmed = await askUntilAnswered(unloads, {
		title: "DesktopConnect is deprecated",
		description: hasNative
			? "DesktopConnect is no longer developed and may be removed. DesktopConnectNative replaces it and is already installed."
			: "DesktopConnect is no longer developed and may be removed. DesktopConnectNative replaces it with its own TIDAL Connect receiver.",
		confirmationText: hasNative ? "Use DesktopConnectNative" : "Install DesktopConnectNative",
		cancellationText: "Later",
	});
	if (!confirmed) return trace.msg.warn(deprecatedMessage);
	if (!hasNative) await (await LunaPlugin.fromStorage({ url: nativePluginUrl })).install();
	else if (!native.enabled) await native.enable();
	await LunaPlugin.getByName("DesktopConnect")?.disable();
};
