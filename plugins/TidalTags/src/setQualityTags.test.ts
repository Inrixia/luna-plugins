// Run: pnpm exec tsx --test plugins/TidalTags/src/setQualityTags.test.ts
// Covers: setQualityTags.ts
import "../../../test/hooks";

import assert from "node:assert/strict";
import { describe, test } from "node:test";

/** Just enough of a DOM element for createQualityTags/setQualityTags (no happy-dom in this repo) */
class FakeElement {
	public nodeType = 1;
	public className = "";
	public textContent = "";
	public style: Record<string, string> = {};
	public children: FakeElement[] = [];
	public parent?: FakeElement;
	private attrs: Record<string, string> = {};
	constructor(public tagName: string) {}
	appendChild(child: FakeElement) {
		child.parent = this;
		this.children.push(child);
		return child;
	}
	remove() {
		if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
	}
	setAttribute(name: string, value: string) {
		this.attrs[name] = value;
	}
	getAttribute(name: string) {
		return this.attrs[name] ?? null;
	}
	/** Supports `.class` and `[attr="value"]` */
	querySelector(selector: string): FakeElement | null {
		const attr = selector.match(/^\[([\w-]+)="(.*)"\]$/);
		const matches = (el: FakeElement) => (attr ? el.getAttribute(attr[1]) === attr[2] : el.className.split(" ").includes(selector.slice(1)));
		for (const child of this.children) {
			if (matches(child)) return child;
			const found = child.querySelector(selector);
			if (found) return found;
		}
		return null;
	}
}

// This file loads as CommonJS (plugin package.jsons have no "type": "module"), so no top-level await: load the code in an async describe
describe("TidalTags quality tags", async () => {
	(<any>globalThis).document = { createElement: (tag: string) => new FakeElement(tag) };
	(<any>globalThis).Node = { ELEMENT_NODE: 1 };

	const { Quality } = await import("../../../test/stubs/lunaLib");
	const { createQualityTags, setQualityTags } = await import("./setQualityTags");
	const { hexToRgba } = await import("./lib/hexToRgba");
	const { isElement } = await import("./lib/isElement");

	const tagNames = (span?: any) => span?.children.map((c: FakeElement) => c.textContent);

	describe("createQualityTags", () => {
		test("makes no tags for a track without quality tags, or a plain lossless one", () => {
			assert.equal(createQualityTags([], Quality.HiRes), undefined);
			assert.equal(createQualityTags([Quality.High], Quality.High), undefined);
		});

		test("makes a coloured tag per quality, leaving out High", () => {
			const span = <any>createQualityTags([Quality.High, Quality.HiRes, Quality.Atmos], Quality.HiRes);
			assert.equal(span.className, "quality-tag-container");
			assert.deepEqual(tagNames(span), ["HiRes", "Atmos"]);
			assert.deepEqual(
				span.children.map((c: FakeElement) => [c.className, c.style.color]),
				[
					["quality-tag", Quality.HiRes.color],
					["quality-tag", Quality.Atmos.color],
				],
			);
		});

		test("adds a Low/Lowest tag first when the best quality is lossy", () => {
			assert.deepEqual(tagNames(createQualityTags([Quality.High], Quality.Low)), ["Low"]);
			assert.deepEqual(tagNames(createQualityTags([Quality.Atmos], Quality.Lowest)), ["Lowest", "Atmos"]);
		});

		// Pins current behaviour: only High is skipped, so High + a non High best quality gives an empty container
		test("returns an empty container for [High] when the best quality is above High", () => {
			assert.deepEqual(tagNames(createQualityTags([Quality.High], Quality.HiRes)), []);
		});
	});

	describe("setQualityTags", () => {
		const row = () => {
			const trackRow = new FakeElement("div");
			const title = trackRow.appendChild(new FakeElement("div"));
			title.setAttribute("data-test", "table-row-title");
			return { trackRow: <any>trackRow, title };
		};
		const item = (id: number, qualityTags: any[], bestQuality: any): any => ({ id, qualityTags, bestQuality });

		test("adds the tags to the row title, marked with the track id", () => {
			const { trackRow, title } = row();
			setQualityTags(trackRow, item(1, [Quality.HiRes], Quality.HiRes));
			assert.equal(title.children.length, 1);
			assert.equal(title.children[0].getAttribute("track-id"), "1");
			assert.deepEqual(tagNames(title.children[0]), ["HiRes"]);
		});

		test("leaves the row alone when it already shows this track's tags", () => {
			const { trackRow, title } = row();
			setQualityTags(trackRow, item(1, [Quality.HiRes], Quality.HiRes));
			const first = title.children[0];
			setQualityTags(trackRow, item(1, [Quality.MQA], Quality.MQA));
			assert.equal(title.children[0], first);
		});

		test("replaces tags of a recycled row, and removes them when the new track has none", () => {
			const { trackRow, title } = row();
			setQualityTags(trackRow, item(1, [Quality.HiRes], Quality.HiRes));
			setQualityTags(trackRow, item(2, [Quality.MQA], Quality.MQA));
			assert.equal(title.children.length, 1);
			assert.equal(title.children[0].getAttribute("track-id"), "2");
			assert.deepEqual(tagNames(title.children[0]), ["MQA"]);

			setQualityTags(trackRow, item(3, [], Quality.High));
			assert.equal(title.children.length, 0);
		});

		test("does nothing for a row without a title", () => {
			assert.doesNotThrow(() => setQualityTags(<any>new FakeElement("div"), item(1, [Quality.HiRes], Quality.HiRes)));
		});
	});

	describe("helpers", () => {
		test("hexToRgba converts #rrggbb, with or without the #, to an rgba() string", () => {
			assert.equal(hexToRgba("#ffd432", 0.3), "rgba(255, 212, 50, 0.3)");
			assert.equal(hexToRgba("33FFEE", 1), "rgba(51, 255, 238, 1)");
		});

		// Pins current behaviour: short #rgb colours are not expanded
		test("hexToRgba does not understand #rgb shorthand", () => {
			assert.equal(hexToRgba("#fff", 1), "rgba(255, 15, NaN, 1)");
		});

		test("isElement is true only for element nodes", () => {
			assert.equal(isElement(<any>{ nodeType: 1 }), true);
			assert.equal(isElement(<any>{ nodeType: 3 }), false);
			assert.equal(isElement(undefined), false);
		});
	});
});
