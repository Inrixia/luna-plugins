import { createServer, type Server } from "https";
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from "net";
import { WebSocketServer, type WebSocket } from "ws";

// The phones' connections: a TLS WebSocket server that only passes text messages on. The TIDAL Connect protocol itself is
// ConnectReceiver's, in the renderer. Part of the native module: kept small and protocol free so a plugin update rarely
// changes it (Luna asks the user again for the native module's permissions whenever its code changes)

export const serviceInfoPath = "/tidalconnect/service";
export type ServiceInfo = { name: string; type: string; port: number; txt: Record<string, string> };

// What happens to the phones, told the renderer in order
export type PhoneEvent = { type: "open"; id: string } | { type: "message"; id: string; text: string } | { type: "close"; id: string };

export type PhoneServerOptions = {
	cert: string | Buffer;
	key: string | Buffer;
	// The port the mDNS record gives the phone, 0 picks a free port (tests)
	port: number;
	// Listens on these addresses only (setHosts follows network changes), on all of them when not given
	hosts?: string[];
	// False when no one heard it (no TIDAL page): the phone is let go, it would wait for answers forever
	onPhone: (event: PhoneEvent) => boolean;
	log?: (...args: unknown[]) => void;
	// The mDNS record the receiver is announced with, answered at serviceInfoPath
	serviceInfo?: () => ServiceInfo | undefined;
	// Whether a connection from the address is let in (the WebSocket and serviceInfoPath), any when not given (tests).
	// Checked before TLS, others are dropped at once
	isAllowedAddress?: (address: string | undefined) => boolean;
};

const pingIntervalMs = 15_000;
const pingTimeoutMs = 31_000;

export class PhoneServer {
	// Not listening itself, the TCP listeners hand it their connections
	private readonly server: Server;
	// By address, "" for all addresses
	private readonly listeners = new Map<string, TcpServer>();
	// Addresses it could not listen on, logged once
	private readonly failedHosts = new Set<string>();
	// Addresses a connection was refused from, logged once
	private readonly refusedAddresses = new Set<string>();
	private readonly wss: WebSocketServer;
	private readonly phones = new Map<string, { socket: WebSocket; alive: number }>();
	private nextId = 1;
	private readonly idPrefix = Date.now().toString(36);
	private readonly pingTimer: NodeJS.Timeout;
	private readonly log: (...args: unknown[]) => void;

	private constructor(private readonly options: PhoneServerOptions) {
		this.log = options.log ?? (() => {});
		this.server = createServer({ cert: options.cert, key: options.key }, (request, response) => {
			// Where mDNS does not reach (a phone over Tailscale on mobile data), a module on the phone asks for the record here
			const service = request.method === "GET" && request.url === serviceInfoPath ? options.serviceInfo?.() : undefined;
			if (service === undefined) return void response.writeHead(404).end();
			response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(service));
		});
		// The phone's messages are small JSON, ws would accept 100 MiB
		this.wss = new WebSocketServer({ server: this.server, maxPayload: 1024 * 1024 });
		// ws forwards the server's errors (port in use) and would throw them without a listener
		this.wss.on("error", (err) => this.log("server error", err));
		this.wss.on("connection", (socket) => this.onConnection(socket));
		this.pingTimer = setInterval(() => this.pingAll(), pingIntervalMs);
	}

	// Without hosts it rejects when the port is taken, with hosts it starts on the ones it can listen on (maybe none)
	static async start(options: PhoneServerOptions) {
		const server = new PhoneServer(options);
		if (options.hosts !== undefined) {
			await server.setHosts(options.hosts);
			return server;
		}
		await server.listen("").catch((err) => {
			clearInterval(server.pingTimer);
			throw err;
		});
		return server;
	}

	// Listens on the addresses the computer has now: new ones are added, gone ones closed
	setHosts(hosts: string[]) {
		// One change at a time, a second listen on the same address would fail
		const run = this.hostsChange.then(() => this.applyHosts(hosts));
		this.hostsChange = run;
		return run;
	}
	private hostsChange: Promise<void> = Promise.resolve();
	private stopped = false;
	private async applyHosts(hosts: string[]) {
		if (this.stopped) return;
		for (const [host, listener] of this.listeners) {
			if (hosts.includes(host)) continue;
			this.listeners.delete(host);
			listener.close();
			this.log("Stopped listening on", host);
		}
		for (const host of hosts) {
			if (this.stopped) return;
			if (this.listeners.has(host)) continue;
			await this.listen(host).then(
				() => {
					this.failedHosts.delete(host);
					this.log("Listening on", host, "port", this.port);
				},
				(err) => {
					if (this.failedHosts.has(host)) return;
					this.failedHosts.add(host);
					this.log("Cannot listen on", host, "port", this.options.port, err.code ?? err);
				},
			);
		}
	}

	get listening() {
		return this.listeners.size !== 0;
	}

	private listen(host: string) {
		const listener = createTcpServer((socket) => {
			const { remoteAddress } = socket;
			if (this.options.isAllowedAddress?.(remoteAddress) === false) {
				socket.destroy();
				const address = remoteAddress ?? "unknown address";
				if (this.refusedAddresses.has(address)) return;
				this.refusedAddresses.add(address);
				return this.log("Refused a connection from", address, "(not in the allowed addresses)");
			}
			this.server.emit("connection", socket);
		});
		return new Promise<void>((resolve, reject) => {
			listener.once("error", reject);
			listener.listen(this.options.port, host === "" ? undefined : host, () => {
				listener.off("error", reject);
				listener.on("error", (err) => this.log("listener error", err));
				this.listeners.set(host, listener);
				resolve();
			});
		});
	}

	get port() {
		const listener = this.listeners.values().next().value;
		return listener === undefined ? this.options.port : (listener.address() as AddressInfo).port;
	}

	// Sent only while the phone is connected
	send(id: string, text: string) {
		const socket = this.phones.get(id)?.socket;
		if (socket !== undefined && socket.readyState === socket.OPEN) socket.send(text);
	}

	// After what was sent before (a close handshake)
	close(id: string) {
		this.phones.get(id)?.socket.close();
	}

	async stop() {
		this.stopped = true;
		clearInterval(this.pingTimer);
		for (const { socket } of this.phones.values()) socket.terminate();
		this.wss.close();
		await this.hostsChange;
		const listeners = [...this.listeners.values()];
		this.listeners.clear();
		await Promise.all(listeners.map((listener) => new Promise<void>((resolve) => listener.close(() => resolve()))));
	}

	private onConnection(socket: WebSocket) {
		// Not the same as a phone's of a server before (its close may still be on its way to the renderer)
		const id = `${this.idPrefix}-${this.nextId++}`;
		this.phones.set(id, { socket, alive: Date.now() });
		this.log("phone connected", this.phones.size);
		if (!this.options.onPhone({ type: "open", id })) return void socket.terminate();
		socket.on("pong", () => {
			const phone = this.phones.get(id);
			if (phone) phone.alive = Date.now();
		});
		socket.on("message", (data, isBinary) => {
			if (!isBinary && !this.options.onPhone({ type: "message", id, text: data.toString() })) socket.terminate();
		});
		socket.on("close", () => {
			this.phones.delete(id);
			this.options.onPhone({ type: "close", id });
		});
		socket.on("error", (err) => this.log("socket error", err));
	}

	private pingAll() {
		const now = Date.now();
		for (const { socket, alive } of this.phones.values()) {
			if (now - alive > pingTimeoutMs) socket.terminate();
			else socket.ping();
		}
	}
}
