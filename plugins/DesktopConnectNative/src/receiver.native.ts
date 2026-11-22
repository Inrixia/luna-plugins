import { getResponder, type CiaoService, type Responder } from "@homebridge/ciao";
import { createHash } from "crypto";
import { app, webContents } from "electron";
import { readFile } from "fs/promises";
import { createServer } from "net";
import { hostname, networkInterfaces } from "os";
import path from "path";

import { addressFilter, parseAddresses } from "./connect/allowedAddresses";
import { fetchRequest, isTidalUrl, type HttpInit } from "./connect/http";
import { PhoneServer, type PhoneEvent, type ServiceInfo } from "./connect/PhoneServer";
// TIDAL's desktop server certificate, public. The phone only trusts it (signed by TIDAL's CA)
import tidalCert from "file://./connect/tidal_server_cert.pem";

// The native part of the own receiver: the phones' TLS WebSocket server, its mDNS record and HTTP to TIDAL's servers.
// The TIDAL Connect protocol runs in the renderer (receiver.ts, ConnectReceiver). Luna asks the user again for this
// module's permissions whenever its code changes, so it knows nothing of the protocol and should rarely need to change.

// The mDNS responder is this module's own (luna bundles ciao into it, a reload gets a new one), it is shut down with the server
type Running = { server: PhoneServer; responder: Responder; service?: CiaoService; watchAddresses?: NodeJS.Timeout; deviceName?: string; access: Access };
// Replaced when the user changes the allowed addresses, also for the server already running
type Access = { allows: (address: string | undefined) => boolean };
// __desktopConnectNativeReceiver: the receiver of versions up to 1.0.10 (the protocol was native then), kept across a reload
type OldRunning = { receiver: { stop: () => Promise<void> }; responder: Responder; service?: CiaoService; watchAddresses?: NodeJS.Timeout };
declare const luna: { __desktopConnectNativeServer?: Running; __desktopConnectNativeReceiver?: OldRunning; __desktopConnectNativeChange?: Promise<unknown> };

// The renderer hears the phones on it (receiver.ts)
const phoneChannel = "desktopConnectNative.phone";

// A certificate and key in this folder replace the built-in ones (development, tests)
export const keyFolder = () => path.join(app.getPath("userData"), "DesktopConnectNative");
const certFile = "tidal_server_cert.pem";
const keyFile = "tidal_server_key.pem";

// Luna evaluates the native module again (in a new sandbox) when the plugin reloads, so the running server is kept on luna,
// otherwise the next stopReceiver would not find it and it would hold the port
const running = luna;

// A stop while the server starts (the plugin unloaded quickly) runs after the start, and a start after a stop, also across reloads
const oneAtATime = <T>(change: () => Promise<T>): Promise<T> => {
	const result = (running.__desktopConnectNativeChange ?? Promise.resolve()).catch(() => {}).then(change);
	running.__desktopConnectNativeChange = result;
	return result;
};

// TIDAL's page (luna.tidalWindow is not set in the main process). False when there is none (it reloads, its window closed)
const toRenderer = (event: PhoneEvent) => {
	let heard = false;
	for (const contents of webContents.getAllWebContents()) {
		if (!contents.isDestroyed() && contents.getURL().startsWith("https://desktop.tidal.com/")) {
			contents.send(phoneChannel, event);
			heard = true;
		}
	}
	return heard;
};
const log = (...args: unknown[]) => console.log("[DesktopConnectNative]", ...args);

// Not TIDAL's own device id (its receiver may be advertised too), stable so the phone remembers the device.
// Each TIDAL profile on the computer is a device of its own (the phone tells devices apart by it)
const deviceId = () => createHash("md5").update(`TidaLuna:${hostname()}:${app.getPath("userData")}`).digest("hex");

// The certificate and key from the key folder, otherwise TIDAL's certificate with the key the plugin was built with
const loadKeys = async (builtInKeyBase64: string) => {
	const folder = keyFolder();
	const [cert, key] = await Promise.all([readFile(path.join(folder, certFile)), readFile(path.join(folder, keyFile))]).catch(() => []);
	if (cert !== undefined && key !== undefined) {
		log(`Using ${certFile} and ${keyFile} from ${folder}`);
		return { cert, key };
	}
	if (builtInKeyBase64 !== "") return { cert: tidalCert, key: Buffer.from(builtInKeyBase64, "base64") };
	log(`Built without TIDAL's server key and no ${certFile} and ${keyFile} in ${folder}, the own receiver is off`);
	return undefined;
};

// The phone connects to the port in the mDNS record (checked with TIDAL Android 2026-11). 9000 is TIDAL's own receiver's
// and TidaLunar's: the receiver takes the first port from the user's that no one listens on, so they run side by side
const portsTried = 20;
const isFree = (port: number, host: string) =>
	new Promise<boolean>((resolve) => {
		const probe = createServer();
		probe.once("error", () => resolve(false));
		probe.listen(port, host, () => probe.close(() => resolve(true)));
	});
const freePort = async (setting: number) => {
	const firstPort = Number.isInteger(setting) && setting >= 1 && setting <= 65535 ? setting : 9000;
	for (let port = firstPort; port < firstPort + portsTried && port <= 65535; port++) {
		const hosts = ["0.0.0.0", ...listenHosts()];
		const free = await Promise.all(hosts.map((host) => isFree(port, host)));
		if (free.every(Boolean)) return port;
	}
	log(`No free port from ${firstPort} to ${firstPort + portsTried - 1}, trying ${firstPort}`);
	return firstPort;
};

const defaultDeviceName = () => `TidaLuna: ${hostname().split(".")[0]}`;
const lanAddresses = () =>
	Object.values(networkInterfaces())
		.flat()
		.filter((info) => info !== undefined && info.family === "IPv4" && !info.internal)
		.map((info) => info!.address);

// A new network (Wi-Fi, VPN, another address) is listened on within this time
const addressCheckMs = 10_000;

// The server listens on each network address (and loopback): when another receiver takes its port on all addresses
// later, Windows still gives a connection to the socket bound to its exact address. Listening on all addresses instead
// may succeed next to another receiver (IPv6 dual stack next to its IPv4) and get nothing.
// The addresses change with the network, they are checked again every few seconds
const listenHosts = () => [...lanAddresses(), "127.0.0.1"];
const listen = async (cert: string | Buffer, key: string | Buffer, firstPort: number, access: Access) => {
	const port = await freePort(firstPort);
	const server = await PhoneServer.start({ cert, key, port, onPhone: toRenderer, log, hosts: listenHosts(), serviceInfo, isAllowedAddress: (address) => access.allows(address) });
	if (!server.listening) log(`Cannot listen on port ${port} on any network address yet, phones will not find the receiver`);
	const watchAddresses = setInterval(() => server.setHosts(listenHosts()).catch(log), addressCheckMs);
	return { server, watchAddresses };
};

// Starts the phones' server, undefined without a key. The renderer listens on phoneChannel before it starts it
export type ReceiverSettings = { firstPort: number; deviceName: string; allowedAddresses: string; allowAnyAddress: boolean };
export const startReceiver = (builtInKeyBase64: string, settings: ReceiverSettings) => oneAtATime(() => start(builtInKeyBase64, settings));
const start = async (builtInKeyBase64: string, { firstPort, deviceName, allowedAddresses, allowAnyAddress }: ReceiverSettings): Promise<{ port: number } | undefined> => {
	// Phones connected to a server still running are not known to the renderer starting now: started anew
	await stop();
	const keys = await loadKeys(builtInKeyBase64);
	if (keys === undefined) return undefined;
	const { cert, key } = keys;
	const access: Access = { allows: addressFilter(allowedAddresses, allowAnyAddress) };
	const { server, watchAddresses } = await listen(cert, key, firstPort, access);
	// Kept at once, so a failed advertise below still stops the server
	const current: Running = { server, responder: getResponder(), watchAddresses, access };
	running.__desktopConnectNativeServer = current;
	try {
		await advertise(current, deviceName);
	} catch (err) {
		await stop();
		throw err;
	}
	log("Listening on port", server.port);
	return { port: server.port };
};

// The name the phone shows, the id stays: the phone keeps it as the same device
const deviceTxt = (deviceName: string) => {
	const id = deviceId();
	return { mn: "TidaLuna", id, fn: deviceName.trim() === "" ? defaultDeviceName() : deviceName.trim(), ca: "0", ve: "1" };
};
const advertise = async (current: Running, deviceName: string) => {
	current.deviceName = deviceName;
	current.service = current.responder.createService({
		disabledIpv6: true,
		port: current.server.port,
		type: "tidalconnect",
		name: `TidalConnect-${deviceId().slice(0, 8)}`,
		txt: deviceTxt(deviceName),
	});
	await current.service.advertise();
};

// The record as announced (ciao renames the service on a name conflict), for a phone mDNS does not reach
const serviceInfo = (): ServiceInfo | undefined => {
	const current = running.__desktopConnectNativeServer;
	if (current?.service === undefined) return undefined;
	// "<name>.<type PTR>"
	const fqdn = current.service.getFQDN();
	const name = fqdn.slice(0, fqdn.length - current.service.getTypePTR().length - 1);
	return { name, type: "_tidalconnect._tcp", port: current.server.port, txt: deviceTxt(current.deviceName ?? "") };
};

// Announced at once, after a start that is still running
export const setDeviceName = (deviceName: string) =>
	oneAtATime(async () => {
		const current = running.__desktopConnectNativeServer;
		if (current === undefined) return;
		current.deviceName = deviceName;
		current.service?.updateTxt(deviceTxt(deviceName));
	});

// Applies to new connections at once (connected phones stay), returns the entries not understood
export const setAllowedAddresses = (allowedAddresses: string, allowAnyAddress: boolean) =>
	oneAtATime(async () => {
		const current = running.__desktopConnectNativeServer;
		if (current !== undefined) current.access.allows = addressFilter(allowedAddresses, allowAnyAddress);
		return parseAddresses(allowedAddresses).invalid;
	});

// The renderer's answers to a phone (in the order sent), and its letting a phone go
export const sendToPhone = async (phoneId: string, text: string) => running.__desktopConnectNativeServer?.server.send(phoneId, text);
export const closePhone = async (phoneId: string) => running.__desktopConnectNativeServer?.server.close(phoneId);

// HTTP to TIDAL's servers only (the phone's tokens go with it)
export const httpRequest = async (url: string, init: HttpInit) => {
	if (!isTidalUrl(url)) throw new Error(`Not a TIDAL url: ${url}`);
	return fetchRequest(url, init);
};

export const stopReceiver = () => oneAtATime(stop);
const stop = async () => {
	const old = running.__desktopConnectNativeReceiver;
	running.__desktopConnectNativeReceiver = undefined;
	const current = running.__desktopConnectNativeServer;
	running.__desktopConnectNativeServer = undefined;
	for (const item of [old, current]) {
		if (item === undefined) continue;
		clearInterval(item.watchAddresses);
		await item.service?.end().catch(log);
		await item.service?.destroy().catch(log);
		await item.responder.shutdown().catch(log);
	}
	await old?.receiver.stop().catch(log);
	await current?.server.stop();
};
