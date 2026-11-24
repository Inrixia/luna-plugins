// Waits for something async the code under test kicks off without returning a promise (a fire-and-forget IIFE, a listener's async work).
// Polls `check` on the real clock until it returns a truthy value, so tests don't depend on how many microtask/immediate hops the code takes.
// setTimeout is captured at import, so this keeps working while a test mocks timers with t.mock.timers.
// Only for positive assertions: to check that nothing happened, a fixed flush is enough.
const realSetTimeout = globalThis.setTimeout;

/** Resolves with `check()`'s value once it is truthy, rejects after `timeoutMs` */
export const waitFor = async <T>(check: () => T, what = "the condition", timeoutMs = 5000): Promise<T> => {
	for (let waited = 0; ; waited += 5) {
		const value = check();
		if (value) return value;
		if (waited >= timeoutMs) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
		await new Promise((resolve) => realSetTimeout(resolve, 5));
	}
};
