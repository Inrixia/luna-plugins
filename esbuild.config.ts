import { defaultBuildOptions } from "luna/build";

// TIDAL's desktop server key for DesktopConnectNative's TIDAL Connect receiver, from the CI secret (the PEM text).
// Baked into the output base64 encoded, so it is not there as plain text. Empty without it
const serverKey = process.env.TIDAL_SERVER_KEY_PEM?.trim() ?? "";
defaultBuildOptions.define = {
	...defaultBuildOptions.define,
	__TIDAL_SERVER_KEY_BASE64__: JSON.stringify(Buffer.from(serverKey).toString("base64")),
};

// Luna's plugin build, with the values above for every plugin
await import("luna/buildPlugins");
