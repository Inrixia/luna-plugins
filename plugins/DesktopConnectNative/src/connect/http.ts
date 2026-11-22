// An HTTP request as the receiver makes it: the renderer has the native module make it (as the receiver did when it ran
// there, the page's own fetch would be under CORS), tests make it themselves. Part of the native module: keep it small
export type HttpInit = { method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number };
export type HttpResponse = { status: number; text: string };
export type HttpRequest = (url: string, init: HttpInit) => Promise<HttpResponse>;

export const fetchRequest: HttpRequest = async (url, { timeoutMs, ...init }) => {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
	return { status: res.status, text: await res.text() };
};

// The phone hands over its own tokens, they must only ever go to TIDAL's servers
export const isTidalUrl = (url: string) => {
	try {
		const { protocol, hostname } = new URL(url);
		if (protocol !== "https:") return false;
		return ["tidal.com", "tidalhifi.com"].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
	} catch {
		return false;
	}
};
