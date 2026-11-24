// Run: pnpm exec tsx --test plugins/Avatar/src/md5.test.ts
// Covers: md5.native.ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("Avatar md5", async () => {
	const { md5 } = await import("./md5.native");

	test("returns the lowercase hex md5 that Gravatar expects", async () => {
		// Gravatar's documented example: md5("myemailaddress@example.com")
		assert.equal(await md5("myemailaddress@example.com"), "0bc83cb571cd1c50ba6f3e8a78ef1346");
		assert.equal(await md5(""), "d41d8cd98f00b204e9800998ecf8427e");
	});
});
