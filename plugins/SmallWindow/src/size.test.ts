// Run: pnpm exec tsx --test plugins/SmallWindow/src/size.test.ts
// Covers: size.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { describe, test } from "node:test";

/** Fake BrowserWindow that records setMinimumSize calls */
const fakeWindow = (min: [number, number]) => {
	const calls: number[][] = [];
	let current = min;
	return {
		calls,
		getMinimumSize: () => [...current],
		setMinimumSize: (w: number, h: number) => {
			calls.push([w, h]);
			current = [w, h];
		},
	};
};

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("SmallWindow", async () => {
	const { windows } = await import("../../../test/stubs/electron");
	const win = fakeWindow([800, 600]);
	windows.push(win);
	const { removeLimits, restoreLimits } = await import("./size.native");

	test("restoreLimits does nothing before the limits were removed", () => {
		restoreLimits();
		assert.deepEqual(win.calls, []);
	});

	test("removeLimits drops the window's minimum size to 0x0", () => {
		removeLimits();
		assert.deepEqual(win.calls, [[0, 0]]);
	});

	test("restoreLimits puts back the size from before the first removeLimits, even after removing twice", () => {
		removeLimits();
		restoreLimits();
		assert.deepEqual(win.calls.at(-1), [800, 600]);
	});

	test("loading the plugin removes the limits and unloading restores them", async () => {
		win.calls.length = 0;
		const { unloads } = await import("./index");
		assert.deepEqual(win.calls, [[0, 0]]);
		for (const unload of unloads) unload();
		assert.deepEqual(win.calls, [
			[0, 0],
			[800, 600],
		]);
	});
});
