// Stand-in for every plugin's Settings.tsx (no React/@luna/ui under node:test).
// `settings` and `storage` are the same mutable object: tests set the fields the code under test reads.
export const settings: Record<string, any> = {};
export const storage = settings;

export const setScrobbling = (enabled: boolean) => {
	const previous = storage.scrobbling;
	storage.scrobbling = enabled;
	return previous;
};

export const Settings = () => null;
