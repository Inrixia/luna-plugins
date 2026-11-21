import init, { recognizeBytes, type DecodedSignature } from "shazamio-core/web";
init();

import { memoize } from "@inrixia/helpers";
import { v4 } from "uuid";

import type { ShazamData } from "./api.types";

// Keyed by the signature's values, an object argument would be a new cache key on every call
const fetchShazamData = memoize(async (samplems: number, uri: string): Promise<ShazamData> => {
	// TODO: Re implement lib.native
	const res = await fetch(
		`https://amp.shazam.com/discovery/v5/en-US/US/iphone/-/tag/${v4()}/${v4()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`,
		{
			headers: { "Content-Type": "application/json" },
			method: "POST",
			body: JSON.stringify({ signature: { samplems, uri } }),
		}
	);
	if (!res.ok) throw new Error(`Failed to fetch Shazam data: ${res.statusText}`);
	return res.json();
});

type Opts = {
	bytes: ArrayBuffer;
	startInMiddle: boolean;
	exitOnFirstMatch: boolean;
};

const using = async <T>(signatures: DecodedSignature[], fun: (signatures: ReadonlyArray<DecodedSignature>) => T) => {
	try {
		return await fun(signatures);
	} finally {
		// Free them when a request fails too
		for (const signature of signatures) signature.free();
	}
};

export const recognizeTrack = async ({ bytes, startInMiddle, exitOnFirstMatch }: Opts) => {
	const matches: ShazamData[] = [];
	await using(recognizeBytes(new Uint8Array(bytes), 0, Number.MAX_SAFE_INTEGER), async (signatures) => {
		let i = startInMiddle ? Math.floor(signatures.length / 2) : 1;
		for (; i < signatures.length; i += 4) {
			const sig = signatures[i];
			const shazamData = await fetchShazamData(sig.samplems, sig.uri);
			matches.push(shazamData);
			if (shazamData.matches.length === 0) continue;
			if (exitOnFirstMatch) return;
		}
	});
	return matches;
};
