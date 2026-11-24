// Run: pnpm exec tsx --test plugins/NativeFullscreen/src/index.test.ts
// Covers: index.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/** Just the parts of the page NativeFullscreen touches */
const page = {
	bar: { style: { display: "" } },
	wimp: { classes: new Set<string>(), classList: <any>undefined },
	rootStyle: new Map<string, string>(),
	fullscreenRequests: 0,
	exits: 0,
	keyListeners: new Set<(e: any) => void>(),
};
page.wimp.classList = {
	contains: (c: string) => page.wimp.classes.has(c),
	add: (c: string) => page.wimp.classes.add(c),
	remove: (c: string) => page.wimp.classes.delete(c),
};
const document = {
	fullscreenElement: <unknown>null,
	querySelector: (selector: string) => (selector === "div[class^='_bar']" ? page.bar : selector === "#wimp > div" ? page.wimp : null),
	documentElement: {
		style: {
			setProperty: (name: string, value: string) => page.rootStyle.set(name, value),
			removeProperty: (name: string) => page.rootStyle.delete(name),
		},
		requestFullscreen: () => {
			page.fullscreenRequests++;
			document.fullscreenElement = document.documentElement;
		},
	},
	exitFullscreen: () => {
		page.exits++;
		document.fullscreenElement = null;
	},
};

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("NativeFullscreen", async () => {
	Object.assign(globalThis, {
		document,
		// window is globalThis in tests (test/hooks)
		addEventListener: (type: string, fn: (e: any) => void) => type === "keydown" && page.keyListeners.add(fn),
		removeEventListener: (type: string, fn: (e: any) => void) => type === "keydown" && page.keyListeners.delete(fn),
	});
	const { storage } = await import("../../../test/stubs/Settings");
	Object.assign(storage, { useTidalFullscreen: false, hideTopBar: false });
	const { intercepts } = await import("../../../test/stubs/lunaLib");
	const { setTopBarVisibility, unloads } = await import("./index");

	const press = (key: string) => {
		let prevented = false;
		for (const fn of page.keyListeners) fn({ key, preventDefault: () => (prevented = true) });
		return prevented;
	};
	const barHidden = () => page.bar.style.display === "none" && page.rootStyle.get("--os-title-bar-height") === "0px";
	const barShown = () => page.bar.style.display === "" && !page.rootStyle.has("--os-title-bar-height");
	const fullscreenAllowed = () => intercepts["view/FULLSCREEN_ALLOWED"].map((cb) => cb(undefined));

	beforeEach(() => {
		Object.assign(storage, { useTidalFullscreen: false, hideTopBar: false });
		document.fullscreenElement = null;
		page.wimp.classes.clear();
		page.fullscreenRequests = page.exits = 0;
		setTopBarVisibility(true);
	});

	describe("TIDAL's fullscreen", () => {
		test("is blocked when TIDAL allows it by itself (eg on window maximise)", () => {
			assert.deepEqual(fullscreenAllowed(), [true]);
		});

		test("goes through once after the user asked for it", () => {
			for (const cb of intercepts["view/REQUEST_FULLSCREEN"]) cb(undefined);
			assert.deepEqual(fullscreenAllowed(), [undefined]);
			assert.deepEqual(fullscreenAllowed(), [true]);
		});

		test("is never blocked with useTidalFullscreen on", () => {
			storage.useTidalFullscreen = true;
			assert.deepEqual(fullscreenAllowed(), [undefined]);
		});
	});

	describe("setTopBarVisibility", () => {
		test("hides the top bar and the space TIDAL keeps for it, and brings both back", () => {
			setTopBarVisibility(false);
			assert.ok(barHidden());
			setTopBarVisibility(true);
			assert.ok(barShown());
		});
	});

	describe("F11", () => {
		test("enters native fullscreen and hides the top bar, then exits and shows it again", () => {
			assert.equal(press("F11"), true);
			assert.equal(page.fullscreenRequests, 1);
			assert.ok(barHidden());

			press("F11");
			assert.equal(page.exits, 1);
			assert.ok(barShown());
		});

		test("keeps the top bar hidden on exit when hideTopBar is on", () => {
			storage.hideTopBar = true;
			press("F11");
			press("F11");
			assert.equal(page.exits, 1);
			assert.ok(barHidden());
		});

		test("toggles TIDAL's in-window fullscreen with useTidalFullscreen on", () => {
			storage.useTidalFullscreen = true;
			press("F11");
			assert.ok(page.wimp.classes.has("is-fullscreen"));
			assert.equal(page.fullscreenRequests, 0);
			press("F11");
			assert.ok(!page.wimp.classes.has("is-fullscreen"));
			assert.equal(page.exits, 0);
		});

		test("ignores other keys", () => {
			assert.equal(press("F10"), false);
			assert.equal(page.fullscreenRequests, 0);
		});
	});

	test("unloading removes the F11 handler and shows the top bar", () => {
		setTopBarVisibility(false);
		for (const unload of unloads) unload();
		assert.equal(page.keyListeners.size, 0);
		assert.ok(barShown());
	});
});
