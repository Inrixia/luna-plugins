import { BlockList, isIPv4, isIPv6 } from "net";

// The receiver has no authorization of its own (whoever reaches the port can take over the session),
// so by default only the home network, the computer itself and Tailscale may connect
const defaultRanges: [address: string, prefix: number, type: "ipv4" | "ipv6"][] = [
	["127.0.0.0", 8, "ipv4"],
	["10.0.0.0", 8, "ipv4"],
	["172.16.0.0", 12, "ipv4"],
	["192.168.0.0", 16, "ipv4"],
	["169.254.0.0", 16, "ipv4"],
	// Tailscale
	["100.64.0.0", 10, "ipv4"],
	["::1", 128, "ipv6"],
	// Unique local and link-local
	["fc00::", 7, "ipv6"],
	["fe80::", 10, "ipv6"],
];

// A socket's address: IPv4 on a dual-stack socket comes as ::ffff:a.b.c.d, link-local may carry a zone (fe80::1%eth0)
const normalize = (address: string) => {
	const plain = address.split("%")[0];
	const mapped = plain.toLowerCase().startsWith("::ffff:") ? plain.slice(7) : undefined;
	return mapped !== undefined && isIPv4(mapped) ? mapped : plain;
};
const typeOf = (address: string) => (isIPv4(address) ? "ipv4" : isIPv6(address) ? "ipv6" : undefined);

// Addresses and ranges the user added ("203.0.113.5, 198.51.100.0/24 2001:db8::/32"), the ones not understood are returned
export const parseAddresses = (text: string) => {
	const ranges: [address: string, prefix: number, type: "ipv4" | "ipv6"][] = [];
	const invalid: string[] = [];
	for (const entry of text.split(/[\s,;]+/).filter((entry) => entry !== "")) {
		const [address, prefixText, ...rest] = entry.split("/");
		const plain = normalize(address);
		const type = typeOf(plain);
		const maxPrefix = type === "ipv4" ? 32 : 128;
		const prefix = prefixText === undefined ? maxPrefix : /^\d+$/.test(prefixText) ? Number(prefixText) : NaN;
		if (type === undefined || rest.length !== 0 || !(prefix >= 0 && prefix <= maxPrefix)) invalid.push(entry);
		else ranges.push([plain, prefix, type]);
	}
	return { ranges, invalid };
};

// Whether a connection from the address is let in
export const addressFilter = (extra: string, allowAny: boolean) => {
	if (allowAny) return () => true;
	const list = new BlockList();
	for (const [address, prefix, type] of [...defaultRanges, ...parseAddresses(extra).ranges]) list.addSubnet(address, prefix, type);
	return (address: string | undefined) => {
		if (address === undefined) return false;
		const plain = normalize(address);
		const type = typeOf(plain);
		return type !== undefined && list.check(plain, type);
	};
};
