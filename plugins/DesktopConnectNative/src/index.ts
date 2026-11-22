import { LunaPlugin, type LunaUnload, Tracer } from "@luna/core";

import { startOwnReceiver } from "./receiver";
export { Settings } from "./Settings";

export const unloads = new Set<LunaUnload>();

const { trace } = Tracer("[DesktopConnectNative]");

// Both would answer the phone (two devices), the one enabled last stays. When both start with TIDAL this one stays
// (DesktopConnect only disables it when the user enables DesktopConnect)
let unloaded = false;
unloads.add(() => (unloaded = true));
const disableDeprecated = async () => {
	const deprecated = LunaPlugin.getByName("DesktopConnect");
	// Plugins load together at startup, a disable before it finished loading would be undone by its load
	const loading = () => deprecated?.enabled && deprecated.loadError._ === undefined && (deprecated.loading._ || deprecated.exports === undefined);
	for (let waitedMs = 0; loading() && waitedMs < 30_000; waitedMs += 100) await new Promise((resolve) => setTimeout(resolve, 100));
	if (unloaded || !deprecated?.enabled) return;
	trace.msg.warn("Disabled DesktopConnect, DesktopConnectNative replaces it");
	await deprecated.disable();
};
disableDeprecated().catch(trace.err.withContext("disable DesktopConnect"));

if (!(await startOwnReceiver(unloads))) trace.msg.warn("DesktopConnectNative could not start its TIDAL Connect receiver, see the console");
