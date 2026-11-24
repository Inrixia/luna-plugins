// Run: pnpm exec tsx --test plugins/VolumeScroll/src/index.test.ts
// Covers: index.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

/** Fake volume slider that keeps its wheel listeners and counts every addEventListener("wheel") call (a Set alone would hide a second add of the same fn) */
const slider = { listeners: new Set<(e: any) => void>(), wheelAdds: 0 } as any;
slider.addEventListener = (type: string, fn: (e: any) => void) => {
	if (type !== "wheel") return;
	slider.wheelAdds++;
	slider.listeners.add(fn);
};
slider.removeEventListener = (type: string, fn: (e: any) => void) => type === "wheel" && slider.listeners.delete(fn);
let sliders: unknown[] = [];

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("VolumeScroll", async () => {
	(<any>globalThis).document = {
		querySelectorAll: (selector: string) => (selector === 'div[class^="_sliderContainer"]' ? sliders : []),
	};
	const { storage } = await import("../../../test/stubs/Settings");
	const { redux, dispatched, intercepts } = await import("../../../test/stubs/lunaLib");
	// No slider on the page yet when the plugin loads
	const { unloads } = await import("./index");

	const scroll = (deltaY: number, shiftKey = false) => {
		for (const listener of slider.listeners) listener({ deltaY, shiftKey });
		return dispatched.splice(0).map(({ type, payload }) => [type, (<any>payload).volume]);
	};

	/** The page loads: every SET_PAGE_ID interceptor runs once more */
	const pageLoads = () => {
		sliders = [slider];
		for (const cb of intercepts["page/SET_PAGE_ID"]) cb(undefined);
	};

	beforeEach(() => {
		Object.assign(storage, { changeBy: 10, changeByShift: 1 });
		redux.store.state = { playbackControls: { volume: 50 } };
		dispatched.length = 0;
		// Each test starts with the slider hooked (hooking again is a no-op, see the first test)
		if (slider.listeners.size === 0) pageLoads();
	});

	test("hooks the volume slider once the page loads, and only once", () => {
		// beforeEach hooked it; more page loads add nothing
		pageLoads();
		pageLoads();
		assert.equal(slider.wheelAdds, 1);
		assert.equal(slider.listeners.size, 1);
	});

	test("scrolling up raises and scrolling down lowers the volume by changeBy", () => {
		assert.deepEqual(scroll(-100), [["playbackControls/SET_VOLUME", 60]]);
		assert.deepEqual(scroll(100), [["playbackControls/SET_VOLUME", 40]]);
	});

	test("uses changeByShift while shift is held", () => {
		assert.deepEqual(scroll(-1, true), [["playbackControls/SET_VOLUME", 51]]);
		assert.deepEqual(scroll(1, true), [["playbackControls/SET_VOLUME", 49]]);
	});

	test("keeps the volume between 0 and 100", () => {
		redux.store.state.playbackControls.volume = 95;
		assert.deepEqual(scroll(-1), [["playbackControls/SET_VOLUME", 100]]);
		redux.store.state.playbackControls.volume = 4;
		assert.deepEqual(scroll(1), [["playbackControls/SET_VOLUME", 0]]);
	});

	test("ignores horizontal only scrolling", () => {
		assert.deepEqual(scroll(0), []);
	});

	test("unloading removes the wheel listener", () => {
		for (const unload of unloads) unload();
		assert.equal(slider.listeners.size, 0);
	});
});
