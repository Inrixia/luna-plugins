// Run: pnpm exec tsx --test plugins/PersistSettings/src/index.test.ts
// Covers: index.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { after, beforeEach, describe, mock, test } from "node:test";

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("PersistSettings", async () => {
	const { storage } = await import("../../../test/stubs/Settings");
	const { redux, dispatched } = await import("../../../test/stubs/lunaLib");

	/** TIDAL's state matching every stored setting, so a check dispatches nothing */
	const inSync = () => ({
		player: { activeDeviceMode: "exclusive", activeDeviceId: "dev", forceVolume: { dev: true } },
		settings: { autoPlay: true, audioNormalization: "ALBUM", explicitContentEnabled: false },
	});

	// The plugin starts its once a second check on import, so the mocked clock has to outlive single tests
	mock.timers.enable({ apis: ["setInterval"] });
	after(() => mock.timers.reset());
	const { unloads } = await import("./index");
	/** Runs one check, returns what it dispatched */
	const check = () => {
		mock.timers.tick(1000);
		return dispatched.splice(0);
	};

	beforeEach(() => {
		Object.assign(storage, { exclusiveMode: true, forceVolume: true, autoplay: true, normalizeVolume: true, explicitContent: false });
		redux.store.state = inSync();
		dispatched.length = 0;
	});

	test("dispatches nothing while TIDAL matches the stored settings", () => {
		assert.deepEqual(check(), []);
	});

	test("puts every setting TIDAL reset back", () => {
		redux.store.state = {
			player: { activeDeviceMode: "shared", activeDeviceId: "dev", forceVolume: {} },
			settings: { autoPlay: false, audioNormalization: "NONE", explicitContentEnabled: true },
		};
		assert.deepEqual(check(), [
			{ type: "player/SET_DEVICE_MODE", payload: "exclusive" },
			{ type: "player/SET_FORCE_VOLUME", payload: { deviceId: "dev", on: true } },
			{ type: "settings/TOGGLE_AUTOPLAY", payload: undefined },
			{ type: "settings/TOGGLE_NORMALIZATION", payload: undefined },
			{ type: "settings/SET_EXPLICIT_CONTENT_TOGGLE", payload: { isEnabled: false } },
		]);
	});

	test("turns force volume off and toggles settings the other way when stored off", () => {
		Object.assign(storage, { forceVolume: false, autoplay: false, normalizeVolume: false, explicitContent: true });
		assert.deepEqual(
			check().map(({ type, payload }) => [type, payload]),
			[
				["player/SET_FORCE_VOLUME", { deviceId: "dev", on: false }],
				["settings/TOGGLE_AUTOPLAY", undefined],
				["settings/TOGGLE_NORMALIZATION", undefined],
				["settings/SET_EXPLICIT_CONTENT_TOGGLE", { isEnabled: true }],
			],
		);
	});

	test("leaves shared device mode alone when exclusive mode is off", () => {
		storage.exclusiveMode = false;
		redux.store.state.player.activeDeviceMode = "shared";
		assert.deepEqual(check(), []);
	});

	test("stops checking after unload", () => {
		for (const unload of unloads) unload();
		redux.store.state.settings.autoPlay = false;
		assert.deepEqual(check(), []);
	});
});
