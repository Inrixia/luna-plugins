// Test-only module hooks: import this first, then load the code under test with a dynamic import().
// They swap the parts of Luna that need a running TIDAL (its modules, Redux store, Electron, the plugin settings UI) for the fakes in ./stubs,
// so the plugins' own logic runs for real under node:test.
import { registerHooks } from "node:module";

// Page globals plugins expect at import time
(<{ window?: unknown }>globalThis).window ??= globalThis;

const stub = (file: string) => new URL(`./stubs/${file}`, import.meta.url).href;

/** Bare specifiers replaced wherever they are imported */
const bySpecifier: Record<string, string> = {
	"@luna/core": stub("lunaCore.ts"),
	"@luna/lib": stub("lunaLib.ts"),
	"@luna/lib.native": stub("lunaLibNative.ts"),
	electron: stub("electron.ts"),
};
/** Files replaced wherever they are imported from, by the end of their resolved url */
const byFile: Record<string, string> = {
	// Settings pages need React and @luna/ui, the stub is one shared settings/storage object tests fill
	"/src/Settings.tsx": stub("Settings.ts"),
	// DiscordRPC: its index registers TIDAL listeners and discord.native opens the Discord IPC pipe
	"/plugins/DiscordRPC/src/index.ts": stub("discordIndex.ts"),
	"/plugins/DiscordRPC/src/discord.native.ts": stub("discordNative.ts"),
};

registerHooks({
	resolve(specifier, context, next) {
		const url = bySpecifier[specifier];
		if (url !== undefined) return { url, format: "module", shortCircuit: true };
		let resolved = next(specifier, context);
		for (const [suffix, url] of Object.entries(byFile)) if (resolved.url.endsWith(suffix)) return { ...resolved, url, format: "module" };
		// Plugin package.jsons have no "type": "module", but plugins are ESM (top-level await) once esbuild bundles them
		if (/\/plugins\/[^/]+\/src\/.+\.tsx?$/.test(resolved.url)) resolved = { ...resolved, format: "module" };
		return resolved;
	},
});
