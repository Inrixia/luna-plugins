import { fetchRequest, isTidalUrl, type HttpInit, type HttpRequest } from "./http";

// The TIDAL Connect receiver: the protocol TIDAL's own tidal_connect_application speaks to the phone,
// as worked out by Brskt for Lunar's own implementation (https://github.com/Brskt/TidaLuna/tree/lunar-cef, src/connect).
// Written anew from it, the protocol is the same
// a TLS Phone with JSON messages. The phone only trusts TIDAL's CA, so the server needs TIDAL's desktop certificate and its key.
// The connections are PhoneServer's (the native module), the receiver runs in the renderer and only sees each phone's
// messages: a plugin update that changes the protocol does not change the native module (Luna asks for its permissions again then).
// Playback itself is the renderer's (TIDAL's player), the receiver tells it what to load and play and hears back what it does.

// Sent to the player (the renderer)
export type PlayerCommand =
	// positionMs: where it starts, part of the load (a seek sent after it may come too late for a media TIDAL starts at once)
	| { type: "load"; mediaId: string; mediaType: number; autoplay: boolean; positionMs: number }
	| { type: "play" }
	| { type: "pause" }
	| { type: "seek"; positionMs: number }
	| { type: "stop" }
	| { type: "volume"; level: number }
	| { type: "mute"; mute: boolean }
	// The session ended or its last phone left, the player stops following the receiver
	| { type: "release" }
	// A phone resumed the session, the player follows the receiver again
	// (it loads the phone's media again, paused where it was, when the desktop played something else meanwhile)
	| { type: "attach"; mediaId: string; mediaType: number; positionMs: number }
	// The desktop plays its own media: the player stops following the receiver and reports what the desktop plays
	// (desktopMedia, state, progress), the phone's play, pause, seek, next and previous go to TIDAL's own controls
	| { type: "mirror" }
	| { type: "next" }
	| { type: "previous" };

export type PlayerState = "IDLE" | "BUFFERING" | "PAUSED" | "PLAYING";
// Heard from the player
export type PlayerEvent =
	| { type: "state"; state: PlayerState }
	// seeked: a jump (a desktop seek), told the phone at once also right after another update
	| { type: "progress"; positionMs: number; seeked?: boolean }
	| { type: "ended" }
	// unavailable: TIDAL does not have the media (not a timeout or a failed request), the queue goes on past it
	| { type: "error"; message?: string; unavailable?: boolean }
	// The desktop user pressed next or previous
	| { type: "next" }
	| { type: "previous" }
	// The desktop user pressed play on the phone's media that ended or could not be loaded, played like the phone's play
	| { type: "play" }
	// The desktop user played something of their own (another album or track): the phone's media stopped, the player is let go
	| { type: "takenOver" }
	// While mirroring: the media the desktop plays now. elementId: its place in TIDAL's queue (the same track twice is two)
	// queue: TIDAL's queue (or a part of it around the media), the phone is given a cloud queue of it to show the media from
	| { type: "desktopMedia"; elementId: string; mediaId: string; mediaType: number; positionMs: number; metadata: DesktopMetadata; queue?: DesktopQueueItem[] }
	// The desktop's volume (0..1) and mute, also after the phone set them: the phone's volume slider goes from it
	| { type: "volume"; level: number; mute: boolean };

// As the phone's SDK takes a media's metadata: a title is required, artists are names, duration in ms (left out when not known)
export type DesktopMetadata = { title: string; albumTitle?: string; artists?: string[]; duration?: number };
// An entry of TIDAL's queue: elementId is its place (the same track twice is two)
export type DesktopQueueItem = { elementId: string; mediaId: string; mediaType: number };

type Json = Record<string, any>;

type OAuthParameters = { accessToken: string; refreshToken: string };
type ServerInfo = {
	serverUrl: string;
	authInfo?: {
		headerAuth?: string;
		oauthParameters?: OAuthParameters;
		oauthServerInfo?: {
			serverUrl: string;
			authInfo: { headerAuth?: string; oauthParameters?: OAuthParameters };
			formParameters?: { grant_type: string; scope: string };
		};
	};
};
type RepeatMode = "NONE" | "ONE" | "ALL";
type WindowSizes = { before: number; after: number };
type QueueInfo = { queueId: string; repeatMode: RepeatMode; shuffled: boolean; maxBeforeSize: number; maxAfterSize: number };
type MediaInfo = {
	itemId: string;
	mediaId: string;
	mediaType: number;
	metadata?: Json;
	policy?: Json;
	streamType?: string;
};

// A connected phone, as PhoneServer tells of it (onPhone)
type Phone = { readonly id: string; open: boolean };

export type ReceiverOptions = {
	toPlayer: (command: PlayerCommand) => void;
	// The phone's connection (PhoneServer's send and close)
	toPhone: (phoneId: string, text: string) => void;
	closePhone: (phoneId: string) => void;
	// HTTP to TIDAL's servers (fetch when not given)
	request?: HttpRequest;
	log?: (...args: unknown[]) => void;
	// Tests point the receiver at a local queue server
	isTrustedUrl?: (url: string) => boolean;
	// Whether a phone signed in to this TIDAL account (user id) may use the receiver, any phone when not given (tests).
	// The account is asked of TIDAL with the token the phone loads its first queue with: until then the phone's session
	// only waits, the session held (another phone's) and the player are left alone
	isAllowedAccount?: (userId: string) => boolean;
	// Where the account is asked for (tests)
	accountUrl?: string;
};

// Answers the token's account: {"userId": 123, "countryCode": ..., ...}
export const tidalAccountUrl = "https://api.tidal.com/v1/sessions";
// Short: the check runs in turn with the commands, the held session waits for it
const accountTimeoutMs = 4_000;

// After the phone set the volume its slider is left alone this long: the player's late reports of the drag are not sent back
const phoneVolumeQuietMs = 1_000;
const progressIntervalMs = 1_000;
const httpTimeoutMs = 30_000;
// Repeat all walks the queue to its other end in windows this long (the server may send shorter ones),
// a queue longer than this many windows is not walked
const walkWindowSize = 100;
const maxWindowMoves = 50;
// Nor for longer than this, the phone's commands wait meanwhile
const walkTimeMs = 20_000;
// Media that cannot play in a row are skipped up to this many, not round and round when none can
const maxFailedInARow = 10;
// While mirroring, the desktop's media is told again this long after the phone was given the cloud queue (it moves to the item once it read it)
const mirrorResendMs = 1_500;

export { isTidalUrl };

// The phone's window sizes, the default for anything else
const windowSizeOf = (size: unknown) => {
	const value = Number(size);
	return Number.isInteger(value) && value > 0 ? value : 10;
};

const repeatModeOf = (mode: unknown): RepeatMode => (mode === "ONE" || mode === "ALL" ? mode : "NONE");

export class ConnectReceiver {
	// The phones connected, by PhoneServer's id
	private readonly phones = new Map<string, Phone>();
	private readonly log: (...args: unknown[]) => void;
	private readonly isTrustedUrl: (url: string) => boolean;
	private readonly request: HttpRequest;

	private session?: { id: string; members: Set<Phone>; suspended: boolean };
	// Phones told their session started whose TIDAL account is not checked yet (isAllowedAccount), with the queue server they gave
	private readonly waiting = new Map<Phone, { id: string; servers?: ServerInfo }>();
	// TIDAL accounts a phone was refused for, logged once
	private readonly refusedAccounts = new Set<string>();

	// The queue the phone loaded, the queue server sends a window of it around the current item
	private queueServer?: ServerInfo;
	private queueInfo?: QueueInfo;
	private items: Json[] = [];
	private index?: number;
	// The current item was removed from the queue: index is the item before or after it
	private removed?: "before" | "after";
	// Whether the window reaches the queue's first and last item
	private includesHead = true;
	private includesTail = true;
	private media?: MediaInfo;
	// The desktop took the player for its own media: the phone is shown what the desktop plays (media is that, not the queue's),
	// and its controls go to the desktop's. A load of the phone's (or its next with the queue) takes the player back
	private mirroring = false;
	// The phone shows only items of its cloud queue (notifyMediaChanged's metadata is not shown): while mirroring it is given
	// a cloud queue made of the desktop's queue. signature: the desktop's queue it was made of, itemIds: its item per element
	private mirrorQueue?: { signature: string; itemIds: Map<string, string> };
	// The desktop's queue a cloud queue is being made of, and the latest one asked for while it is (made after it)
	private mirrorQueueMaking?: string;
	private mirrorQueueNext?: DesktopQueueItem[];
	// Counted when mirroring starts or ends: a cloud queue made for an earlier one is not given to the phone
	private mirrorGeneration = 0;
	private mirrorResendTimer?: ReturnType<typeof setTimeout>;
	// The desktop's media's entry in its queue
	private mirrorElementId?: string;

	// What the player reported last
	private playerState: PlayerState = "IDLE";
	private positionMs = 0;
	private lastProgressSent = 0;
	// Set at the end of the queue: TIDAL still reports the stopped track (paused), the phone must see the receiver idle
	private finished = false;
	private failedInARow = 0;
	// Counted at once (not in turn) when the desktop takes the player: a step still waiting for the queue server then loads nothing
	private takeovers = 0;
	// Whether the media was loaded to play, a media skipped after it starts the same way
	private autoplay = true;

	// Commands and player events are handled one after another, a queue request must not let a later command overtake it
	private pending: Promise<unknown> = Promise.resolve();
	private serial(task: () => unknown, what: string) {
		const run = this.pending.then(task).catch((err) => this.log(what, "failed", err));
		this.pending = run;
		return run;
	}

	constructor(private readonly options: ReceiverOptions) {
		this.log = options.log ?? (() => {});
		this.isTrustedUrl = options.isTrustedUrl ?? isTidalUrl;
		this.request = options.request ?? fetchRequest;
	}

	private stopped = false;
	stop() {
		this.stopped = true;
		clearTimeout(this.volumeTimer);
		clearTimeout(this.mirrorResendTimer);
		this.waiting.clear();
		this.endSession(false);
		for (const phone of this.phones.values()) this.closePhone(phone);
		this.phones.clear();
	}

	// #region Phones
	// PhoneServer's events, in the order they happened
	onPhoneOpen(id: string) {
		if (this.stopped) return this.options.closePhone(id);
		this.phones.set(id, { id, open: true });
	}

	onPhoneMessage(id: string, text: string) {
		const phone = this.phones.get(id);
		if (phone === undefined) return;
		let message: Json;
		try {
			message = JSON.parse(text);
		} catch {
			return this.log("invalid message", text);
		}
		if (message === null || typeof message !== "object") return this.log("invalid message", text);
		this.serial(() => this.onMessage(phone, message), `command ${message.command}`);
	}

	onPhoneClose(id: string) {
		const phone = this.phones.get(id);
		if (phone === undefined) return;
		this.phones.delete(id);
		phone.open = false;
		this.onClose(phone);
	}

	private closePhone(phone: Phone) {
		if (!phone.open) return;
		phone.open = false;
		this.options.closePhone(phone.id);
	}

	private onClose(socket: Phone) {
		this.waiting.delete(socket);
		const session = this.session;
		if (session === undefined || !session.members.delete(socket)) return;
		// Kept for a resumeSession, the phone reconnects to it after a network change or when the app comes back
		if (session.members.size === 0 && !session.suspended) {
			session.suspended = true;
			this.log("session suspended");
			this.options.toPlayer({ type: "release" });
		}
	}

	private send(socket: Phone, message: Json) {
		if (socket.open) this.options.toPhone(socket.id, JSON.stringify(message));
	}

	// HTTP to TIDAL's servers, JSON back ({} for an empty answer)
	private async requestJson(url: string, init: HttpInit) {
		const { status, text } = await this.request(url, init);
		const ok = status >= 200 && status < 300;
		return { status, ok, json: (): Json => (text ? JSON.parse(text) : {}) };
	}

	private toSession(message: Json) {
		for (const socket of this.session?.members ?? []) this.send(socket, message);
	}

	// The desktop's volume (TIDAL's notifyDeviceStatusChanged, level 0..1) and what the phone was told or set itself
	private volume: { level: number; mute: boolean } | undefined;
	private told: { level?: number; mute?: boolean } = {};
	// While the phone drags its slider the player's reports lag behind it: an older level would move the slider back
	private phoneVolumeUntil = 0;
	private volumeTimer: ReturnType<typeof setTimeout> | undefined;
	private deviceStatus() {
		const { level, mute } = this.volume!;
		this.told = { level, mute };
		return { command: "notifyDeviceStatusChanged", volume: { level, mute } };
	}
	private sendVolume(socket: Phone) {
		if (this.volume !== undefined) this.send(socket, this.deviceStatus());
	}
	private setVolume(level: number, mute: boolean) {
		if (!Number.isFinite(level)) return;
		this.volume = { level: Math.min(Math.max(level, 0), 1), mute };
		this.tellVolume();
	}
	private phoneSetVolume(volume: { level?: number; mute?: boolean }) {
		this.told = { ...this.told, ...volume };
		this.phoneVolumeUntil = Date.now() + phoneVolumeQuietMs;
	}
	private tellVolume() {
		clearTimeout(this.volumeTimer);
		this.volumeTimer = undefined;
		if (this.volume === undefined || this.session === undefined || this.session.suspended) return;
		const wait = this.phoneVolumeUntil - Date.now();
		// Told once the phone stopped, if the player then has another level than the phone's last
		if (wait > 0) return void (this.volumeTimer = setTimeout(() => this.tellVolume(), wait));
		const { level, mute } = this.volume;
		// The player rounds what the phone set, that is no change to tell
		if (this.told.level !== undefined && Math.abs(this.told.level - level) < 0.01 && this.told.mute === mute) return;
		this.toSession(this.deviceStatus());
	}
	// #endregion

	// #region Commands
	private async onMessage(socket: Phone, message: Json) {
		const { command, requestId } = message;
		// Let go already (it ended its session, its account was refused): what it sent before it heard is dropped
		if (!socket.open) return this.log("dropped", command, "(the phone was let go)");
		this.log("<-", command, requestId ?? "");
		switch (command) {
			case "startSession":
				return this.startSession(socket);
			case "resumeSession":
				return this.resumeSession(socket, message.sessionId);
			case "endSession":
				if (this.waiting.get(socket)?.id === message.sessionId) {
					this.waiting.delete(socket);
					this.send(socket, { command: "notifySessionEnded", sessionId: message.sessionId, suspended: false });
				} else if (!this.session?.members.has(socket) || message.sessionId !== this.session.id) {
					this.send(socket, { command: "notifySessionError", requestedCommand: "endSession", error: "Invalid SessionId" });
					// A phone of the session held stays in it
					if (this.session?.members.has(socket)) return;
				} else this.endSession(message.stopCasting === true);
				// The phone leaving for another device connects to it only once this connection is closed (checked with
				// TIDAL Android 2026-11: left open, it stays "connecting" on this receiver). Closed after the answers above
				return this.closePhone(socket);
		}
		const waiting = this.waiting.get(socket);
		if (waiting !== undefined) {
			const checked = await this.checkAccount(socket, waiting, message);
			if (checked !== true) {
				if (typeof requestId === "number") this.send(socket, { command: "notifyRequestResult", requestId, resultCode: checked });
				return;
			}
		}
		// Everything else is only for the session's phones
		if (!this.session?.members.has(socket)) return this.log("dropped", command, "(not in the session)");
		const result = await this.onSessionCommand(message);
		if (typeof requestId === "number") this.send(socket, { command: "notifyRequestResult", requestId, resultCode: result });
	}

	// Answers 0 when done, 1002 when there is no queue for it
	private async onSessionCommand(message: Json): Promise<number> {
		const toPlayer = this.options.toPlayer;
		if (this.mirroring) {
			switch (message.command) {
				// The desktop's own next and previous (its queue, not the phone's)
				case "next":
				case "previous":
					toPlayer({ type: message.command });
					return 0;
				// The desktop's media is not let go: it pauses, the phone keeps showing it
				case "stop":
					if (this.media !== undefined) toPlayer({ type: "pause" });
					return 0;
			}
			// Play, pause and seek go to the player as they are, a load of the phone's takes it back (setMedia)
		}
		switch (message.command) {
			case "play":
				this.play();
				return 0;
			case "pause":
				if (this.media !== undefined) toPlayer({ type: "pause" });
				return 0;
			case "seek":
				if (this.media !== undefined && typeof message.position === "number") {
					this.positionMs = message.position;
					toPlayer({ type: "seek", positionMs: message.position });
				}
				return 0;
			case "stop":
				this.media = undefined;
				toPlayer({ type: "stop" });
				this.setPlayerState("IDLE");
				// TIDAL reports the stopped media paused afterwards
				this.finished = true;
				return 0;
			case "setVolume":
				if (typeof message.level !== "number" || !Number.isFinite(message.level)) return 0;
				this.phoneSetVolume({ level: message.level });
				toPlayer({ type: "volume", level: message.level });
				return 0;
			case "setMute":
				if (typeof message.mute !== "boolean") return 0;
				this.phoneSetVolume({ mute: message.mute });
				toPlayer({ type: "mute", mute: message.mute });
				return 0;
			case "loadCloudQueue":
				await this.loadCloudQueue(message);
				return 0;
			case "loadMedia":
			case "loadMediaInfo":
				if (message.mediaInfo) {
					// A single media, not from the queue loaded before: its end is the end
					this.clearItems();
					this.queueInfo = undefined;
					this.setMedia(this.mediaInfoOf(message.mediaInfo), message.autoplay !== false, message.position);
				}
				return 0;
			case "updateServerInfo":
				this.setServers(message);
				return 0;
		}
		// Queue commands
		// Also when no window is known (the first one failed, or the queue was emptied): the commands load it
		if (this.queueInfo === undefined) {
			this.log("no queue for", message.command);
			return 1002;
		}
		switch (message.command) {
			case "next":
				await this.step(1, false);
				return 0;
			case "previous":
				await this.step(-1, false);
				return 0;
			case "selectQueueItem": {
				const media = message.mediaInfo ? this.mediaInfoOf(message.mediaInfo) : undefined;
				if (media === undefined) return 0;
				const index = this.items.findIndex((item) => this.itemIdOf(item) === media.itemId);
				// Not in the window: no position until the window around it is loaded, the old one would be another item's
				this.index = index !== -1 ? index : undefined;
				this.removed = undefined;
				this.setMedia(media);
				await this.loadWindow({ itemId: media.itemId });
				return 0;
			}
			case "refreshQueue":
				await this.loadWindow({ itemId: this.currentItemId() });
				this.toSession({ command: "notifyQueueItemsChanged", queueInfo: this.queueInfo, reason: "REFRESH_REQUESTED" });
				return 0;
			// Only a change the queue server saved is kept, the phone reads the queue back from there
			case "setRepeatMode": {
				const repeatMode = repeatModeOf(message.repeatMode);
				// The queue server's names are lower case and "off" for none
				if (await this.putQueue("repeatmode", { repeat_mode: repeatMode === "NONE" ? "off" : repeatMode.toLowerCase() }))
					this.queueInfo.repeatMode = repeatMode;
				this.toSession({ command: "notifyQueueItemsChanged", queueInfo: this.queueInfo, reason: "REPEAT_MODE_CHANGED" });
				return 0;
			}
			case "setShuffle": {
				const shuffle = message.shuffle === true;
				if (await this.putQueue("shuffle", { shuffle })) {
					this.queueInfo.shuffled = shuffle;
					// The server reorders the queue, the window around the current item changes
					await this.loadWindow({ itemId: this.currentItemId() });
				}
				this.toSession({ command: "notifyQueueItemsChanged", queueInfo: this.queueInfo, reason: "SHUFFLE_CHANGED" });
				return 0;
			}
		}
		this.log("unknown command", message.command);
		return 0;
	}
	// #endregion

	// #region Session
	private startSession(socket: Phone) {
		const id = crypto.randomUUID();
		// A phone that started before and still waits starts again
		this.waiting.delete(socket);
		// A phone of the session held was checked already
		const member = this.session?.members.has(socket) === true;
		if (this.options.isAllowedAccount !== undefined && !member) {
			this.waiting.set(socket, { id });
			this.log("session waits for the phone's TIDAL account", id);
			return this.send(socket, { command: "notifySessionStarted", sessionId: id, joined: false });
		}
		this.openSession(socket, id);
		this.send(socket, { command: "notifySessionStarted", sessionId: id, joined: false });
		this.sendVolume(socket);
	}

	// A waiting phone's command: its first queue load (with its token) asks TIDAL for its account. True when the session
	// opened (the command then runs in it), otherwise the result for the phone
	private async checkAccount(socket: Phone, waiting: { id: string; servers?: ServerInfo }, message: Json): Promise<true | number> {
		if (message.queueServerInfo) waiting.servers = message.queueServerInfo;
		if (message.command === "updateServerInfo") return 0;
		if (message.command !== "loadCloudQueue") {
			this.log("dropped", message.command, "(the phone's TIDAL account is not checked yet)");
			return 1002;
		}
		let userId: string | undefined;
		try {
			userId = await this.accountOf(waiting.servers);
		} catch (err) {
			this.log("could not ask TIDAL for the phone's account", err);
		}
		// Closed, started again or the receiver stopped meanwhile
		if (this.stopped || this.waiting.get(socket) !== waiting) return 1002;
		this.waiting.delete(socket);
		if (userId !== undefined && this.options.isAllowedAccount!(userId)) {
			this.log("the phone's TIDAL account", userId, "is allowed");
			this.openSession(socket, waiting.id);
			this.queueServer = waiting.servers;
			this.sendVolume(socket);
			return true;
		}
		if (userId === undefined) this.log("Refused a phone: TIDAL did not tell its account");
		else if (!this.refusedAccounts.has(userId)) {
			this.refusedAccounts.add(userId);
			this.log("Refused a phone of TIDAL account", userId, "(not an allowed account)");
		}
		this.send(socket, { command: "notifySessionEnded", sessionId: waiting.id, suspended: false });
		this.closePhone(socket);
		return 1002;
	}

	// The TIDAL account (user id) of the token, undefined without one
	private async accountOf(server: ServerInfo | undefined) {
		const auth = server === undefined ? undefined : this.authHeader(server);
		if (auth === undefined) return undefined;
		const url = this.options.accountUrl ?? tidalAccountUrl;
		if (!this.isTrustedUrl(url)) throw new Error(`Untrusted account url ${url}`);
		const res = await this.requestJson(url, { headers: { Authorization: auth }, timeoutMs: accountTimeoutMs });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const { userId } = res.json();
		return typeof userId === "number" || (typeof userId === "string" && userId !== "") ? String(userId) : undefined;
	}

	// The TIDAL accounts a phone was refused for
	get refusedTidalAccounts() {
		return [...this.refusedAccounts];
	}

	private openSession(socket: Phone, id: string) {
		// A new session replaces the one held, its other phones are told it is over
		const old = this.session;
		if (old !== undefined) {
			for (const member of old.members) if (member !== socket) this.send(member, { command: "notifySessionEnded", sessionId: old.id, suspended: false });
			if (!old.suspended) this.options.toPlayer({ type: "release" });
			this.clearQueue();
		}
		this.session = { id, members: new Set([socket]), suspended: false };
		this.log("session started", id);
	}

	private resumeSession(socket: Phone, sessionId: unknown) {
		const session = this.session;
		if (session === undefined) return this.send(socket, { command: "notifySessionError", requestedCommand: "resumeSession", error: "No Session" });
		if (session.id !== sessionId)
			return this.send(socket, { command: "notifySessionError", requestedCommand: "resumeSession", error: "Invalid SessionId" });
		session.members.add(socket);
		this.send(socket, { command: "notifySessionResumed", sessionId: session.id });
		if (session.suspended) {
			session.suspended = false;
			// The desktop's own media: the player reports what it plays now (maybe something else by then)
			if (this.mirroring) this.options.toPlayer({ type: "mirror" });
			else if (this.media !== undefined) {
				// What the player does now is not known, it may load the phone's media again (it tells once it knows)
				if (!this.finished) this.playerState = "BUFFERING";
				this.options.toPlayer({ type: "attach", mediaId: this.media.mediaId, mediaType: this.media.mediaType, positionMs: this.positionMs });
			}
		}
		// Bring the phone up to date
		if (this.queueInfo !== undefined) this.send(socket, { command: "notifyQueueChanged", queueInfo: this.queueInfo });
		if (this.media !== undefined) this.send(socket, this.mediaChanged(this.media));
		this.send(socket, this.playerStatus());
		this.sendVolume(socket);
	}

	private endSession(stopCasting: boolean) {
		const session = this.session;
		if (session === undefined) return;
		this.toSession({ command: "notifySessionEnded", sessionId: session.id, suspended: false });
		this.session = undefined;
		this.log("session ended, stopCasting:", stopCasting);
		if (stopCasting && this.media !== undefined) this.options.toPlayer({ type: "stop" });
		if (!session.suspended) this.options.toPlayer({ type: "release" });
		this.clearQueue();
	}

	private clearQueue() {
		this.queueServer = this.queueInfo = this.media = undefined;
		this.setMirroring(false);
		this.clearItems();
		this.playerState = "IDLE";
		this.positionMs = 0;
	}
	private clearItems() {
		this.items = [];
		this.index = undefined;
		this.removed = undefined;
		this.includesHead = this.includesTail = true;
		this.failedInARow = 0;
	}
	// #endregion

	// #region Queue
	// The content server is TIDAL's player's business, only the queue server is used here
	private setServers(message: Json) {
		if (message.queueServerInfo) this.queueServer = message.queueServerInfo;
	}

	private async loadCloudQueue(message: Json) {
		this.setServers(message);
		const queueInfo = message.queueInfo;
		if (queueInfo) {
			// Another queue: its window is not known until loaded
			if (String(queueInfo.queueId ?? "") !== this.queueInfo?.queueId) this.clearItems();
			this.queueInfo = {
				queueId: String(queueInfo.queueId ?? ""),
				repeatMode: repeatModeOf(queueInfo.repeatMode),
				shuffled: queueInfo.shuffled === true,
				maxBeforeSize: windowSizeOf(queueInfo.maxBeforeSize),
				maxAfterSize: windowSizeOf(queueInfo.maxAfterSize),
			};
		}
		const current = message.currentMediaInfo ? this.mediaInfoOf(message.currentMediaInfo) : undefined;
		if (current !== undefined) {
			// The position is the new current item's (item ids are the queue's own), not the old one's when the new window fails
			const index = this.items.findIndex((item) => this.itemIdOf(item) === current.itemId);
			this.index = index !== -1 ? index : undefined;
			this.removed = undefined;
			this.failedInARow = 0;
		}
		// Start loading the media at once, the queue window only matters for what comes after it.
		// A phone that was paused sends autoplay false, and where it was in the track
		if (current !== undefined) this.setMedia(current, message.autoplay !== false, message.position);
		await this.loadWindow({ itemId: current?.itemId, mediaId: current?.mediaId });
		if (this.queueInfo !== undefined) this.toSession({ command: "notifyQueueChanged", queueInfo: this.queueInfo });
	}

	// The part of the cloud queue around an item. False when the queue server failed (the window stays as it was)
	private async loadWindow(
		options: { itemId?: string; mediaId?: string; sizes?: WindowSizes; quiet?: boolean; timeoutMs?: number } = {},
	): Promise<boolean> {
		const { itemId, mediaId, sizes, quiet = false, timeoutMs } = options;
		const window = await this.requestWindow(itemId, sizes, quiet, timeoutMs);
		if (window === undefined) return false;
		const items = this.windowItems(window);
		if (items === undefined) {
			// The phone emptied the queue (the server says the window is all of it): nothing comes after the media playing.
			// Otherwise the window stays, an empty one around an item says nothing about the queue
			if (window.includes_head === true && window.includes_tail === true) this.clearItems();
			return true;
		}
		const currentId = window.itemId ?? itemId ?? this.media?.itemId;
		// The current item and its neighbours in the old window, it may be gone from the new one
		const listed = currentId !== undefined && this.items.some((item) => this.itemIdOf(item) === currentId);
		const previousId = this.index === undefined ? undefined : this.itemIdOf(this.items[this.removed === "before" ? this.index : this.index - 1]);
		const nextId = this.index === undefined ? undefined : this.itemIdOf(this.items[this.removed === "after" ? this.index : this.index + 1]);
		const saved = this.saveWindow();
		this.setWindow(window, items);
		let index = this.items.findIndex((item) => this.itemIdOf(item) === currentId);
		// By its media when the ids differ, not for an item that was in the queue and is gone (the same track elsewhere is another item)
		const currentMediaId = mediaId ?? this.media?.mediaId;
		if (index === -1 && !listed && currentMediaId !== undefined) index = this.items.findIndex((item) => this.mediaIdOf(item) === currentMediaId);
		if (index !== -1) {
			this.index = index;
			this.removed = undefined;
		} else if (!this.placeRemoved(previousId, nextId)) {
			const neighbourId = nextId ?? previousId;
			if (neighbourId === undefined) {
				this.index = this.removed = undefined;
			} else {
				// The window is elsewhere (the server did not find the removed item), ask for the one around its neighbour
				const around = await this.requestWindow(neighbourId, sizes, quiet, timeoutMs);
				const aroundItems = around && this.windowItems(around);
				if (around === undefined || aroundItems === undefined) {
					this.restoreWindow(saved);
					return false;
				}
				this.setWindow(around, aroundItems);
				if (!this.placeRemoved(previousId, nextId)) this.index = this.removed = undefined;
			}
		}
		this.log("queue window", this.items.length, "items, current", this.index, this.removed ?? "");
		return true;
	}

	// The queue server's window, undefined when it failed (the phone is told unless quiet)
	private async requestWindow(
		itemId: string | undefined,
		sizes: WindowSizes | undefined,
		quiet: boolean,
		timeoutMs?: number,
	): Promise<Json | undefined> {
		if (this.queueInfo === undefined || this.queueServer === undefined) return undefined;
		const { queueId, maxBeforeSize, maxAfterSize } = this.queueInfo;
		const { before, after } = sizes ?? { before: maxBeforeSize, after: maxAfterSize };
		let url = `${this.queueServer.serverUrl}/${queueId}/window?beforesize=${before}&aftersize=${after}&onlyactives=true`;
		if (itemId !== undefined) url += `&itemid=${encodeURIComponent(itemId)}`;
		try {
			return await this.queueRequest("GET", url, { timeoutMs });
		} catch (err) {
			this.log("queue window failed", err);
			if (!quiet) this.queueServerError(err);
			return undefined;
		}
	}
	private windowItems(window: Json): Json[] | undefined {
		const items = window.items ?? window.mediaInfos;
		return Array.isArray(items) && items.length !== 0 ? items : undefined;
	}
	private setWindow(window: Json, items: Json[]) {
		this.items = items;
		this.includesHead = window.includes_head !== false;
		this.includesTail = window.includes_tail !== false;
	}
	private saveWindow() {
		const { items, index, removed, includesHead, includesTail } = this;
		return { items, index, removed, includesHead, includesTail };
	}
	private restoreWindow(saved: ReturnType<ConnectReceiver["saveWindow"]>) {
		Object.assign(this, saved);
	}
	// The current item was removed from the queue: the queue goes on with the item after it (or ends after the one before it)
	private placeRemoved(previousId: string | undefined, nextId: string | undefined) {
		const nextIndex = nextId === undefined ? -1 : this.items.findIndex((item) => this.itemIdOf(item) === nextId);
		if (nextIndex !== -1) {
			this.index = nextIndex;
			this.removed = "after";
			return true;
		}
		const previousIndex = previousId === undefined ? -1 : this.items.findIndex((item) => this.itemIdOf(item) === previousId);
		if (previousIndex === -1) return false;
		this.index = previousIndex;
		this.removed = "before";
		return true;
	}

	// Moves through the queue: by the phone's or desktop's next/previous (repeat one is skipped), when a track ended
	// or when a media failed (failed: on to the next one, also with repeat one)
	private async step(by: 1 | -1, ended: boolean, failed = false) {
		// The queue server failed (the phone was told), the queue does not end: its next can try again.
		// Nothing plays after an ended or failed media, the phone must not show it playing
		const serverFailed = () => {
			if (ended) this.setPlayerState("PAUSED");
		};
		const takeovers = this.takeovers;
		// No window known (its request failed): load it around the current item first
		if (this.index === undefined && this.queueInfo !== undefined && this.media?.itemId !== undefined) {
			if (!(await this.loadWindow({ itemId: this.media.itemId, mediaId: this.media.mediaId }))) return serverFailed();
		}
		if (this.index === undefined || this.queueInfo === undefined) {
			// A single media, or one not in the queue: its end is the end
			if (ended) {
				this.setPlayerState("IDLE");
				this.finished = true;
			}
			return;
		}
		const { repeatMode } = this.queueInfo;
		// The desktop played its own media while the queue server answered: that plays, not the phone's next
		const takenOver = () => this.takeovers !== takeovers;
		if (takenOver()) return;
		if (ended && !failed && repeatMode === "ONE") {
			// The removed item still plays again, it is the phone's media
			if (this.removed !== undefined && this.media !== undefined) return this.setMedia(this.media);
			return this.playItem(this.index);
		}
		// After a removed current item index is already its neighbour on that side
		const nextIndex = () => this.index! + (this.removed === (by === 1 ? "after" : "before") ? 0 : by);
		let next = nextIndex();
		// The window ends before the queue does (it was not moved in time), move it over the current item
		if ((next < 0 && !this.includesHead) || (next >= this.items.length && !this.includesTail)) {
			if (!(await this.loadWindow({ itemId: this.currentItemId() })) || this.index === undefined) return serverFailed();
			next = nextIndex();
		}
		if (next < 0) {
			const moved = repeatMode === "ALL" ? await this.moveWindowTo("tail") : "unreached";
			if (moved === "failed") return serverFailed();
			next = moved === "moved" ? this.items.length - 1 : 0;
		} else if (next >= this.items.length) {
			const moved = repeatMode === "ALL" ? await this.moveWindowTo("head") : "unreached";
			if (moved === "failed") return serverFailed();
			if (moved === "unreached") {
				// The end of the queue
				if (ended) {
					this.setPlayerState("IDLE");
					this.finished = true;
				}
				return;
			}
			next = 0;
		}
		if (takenOver()) return;
		// A skipped media's next one starts like it, paused when it was loaded paused
		this.playItem(next, !failed || this.autoplay);
		// Keep the window centred, the next items must be known before the track ends (not past the queue's own ends)
		if ((next >= this.items.length - 2 && !this.includesTail) || (next <= 1 && !this.includesHead))
			await this.loadWindow({ itemId: this.itemIdOf(this.items[next]) });
	}

	// Repeat all goes round to the other end of the queue, the window may not reach it.
	// It moves in long windows (fewer requests while the phone's commands wait), shorter ones down to the phone's size when the server refuses them.
	// Failed when the queue server failed (the phone was told), unreached when the queue is too long or the server does not move the window.
	// The window stays as it was unless moved
	private async moveWindowTo(end: "head" | "tail"): Promise<"moved" | "failed" | "unreached"> {
		const { maxBeforeSize, maxAfterSize } = this.queueInfo!;
		const phoneSize = end === "head" ? maxBeforeSize : maxAfterSize;
		const saved = this.saveWindow();
		const reached = () => (end === "head" ? this.includesHead : this.includesTail);
		const edgeId = () => this.itemIdOf(end === "head" ? this.items[0] : this.items[this.items.length - 1]);
		const deadline = Date.now() + walkTimeMs;
		// The server is too slow (not the queue too long): the phone is told like for a failed request, the queue does not end
		const tooSlow = () => {
			this.log("queue not walked to its", end, "in time");
			this.restoreWindow(saved);
			this.queueServerError(new Error("Queue server too slow"));
			return "failed" as const;
		};
		let size = Math.max(walkWindowSize, phoneSize);
		for (let moves = 0; !reached(); moves++) {
			if (moves === maxWindowMoves) {
				this.log("queue not walked to its", end, "in", moves, "windows");
				this.restoreWindow(saved);
				return "unreached";
			}
			if (Date.now() > deadline) return tooSlow();
			const edge = edgeId();
			let loaded = false;
			while (!loaded) {
				const remainingMs = deadline - Date.now();
				if (remainingMs <= 0) return tooSlow();
				// The last try is the phone's own window, the one the server is known to send
				const sizes =
					size === phoneSize
						? { before: maxBeforeSize, after: maxAfterSize }
						: end === "head"
							? { before: size, after: 0 }
							: { before: 0, after: size };
				// Only the phone's size is reported to the phone when it fails
				loaded = await this.loadWindow({ itemId: edge, sizes, quiet: size !== phoneSize, timeoutMs: Math.min(remainingMs, httpTimeoutMs) });
				if (loaded || size === phoneSize) break;
				size = Math.max(Math.floor(size / 2), phoneSize);
			}
			if (!loaded) {
				this.restoreWindow(saved);
				return "failed";
			}
			// The window ends at the same item, the server does not move it further
			if (!reached() && edgeId() === edge) {
				this.log("queue window does not move to its", end);
				this.restoreWindow(saved);
				return "unreached";
			}
		}
		return "moved";
	}

	private playItem(index: number, autoplay = true) {
		const item = this.items[index];
		if (item === undefined) return;
		this.index = index;
		this.removed = undefined;
		this.setMedia(this.mediaInfoOf(item), autoplay);
	}

	private currentItemId() {
		return this.index !== undefined ? this.itemIdOf(this.items[this.index]) : this.media?.itemId;
	}

	// Queue items use snake case, media infos camel case
	private itemIdOf(item: Json | undefined): string | undefined {
		const id = item?.itemId ?? item?.item_id ?? item?.id;
		return id === undefined ? undefined : String(id);
	}
	private mediaIdOf(item: Json | undefined): string | undefined {
		const id = item?.mediaId ?? item?.media_id;
		return id === undefined ? undefined : String(id);
	}
	private mediaInfoOf(item: Json): MediaInfo {
		const display = item.display_info ?? item.displayInfo;
		// The queue server's items carry their length as display_info.duration_ms, the phone's media infos as metadata.duration
		const duration = display?.duration ?? display?.duration_ms ?? item.duration_ms;
		let metadata =
			item.metadata ??
			(display && {
				title: display.title,
				albumTitle: display.album_title ?? display.albumTitle,
				artists: display.artists,
				duration,
				images: display.images,
			});
		if (metadata !== undefined && metadata.duration === undefined && typeof duration === "number") metadata = { ...metadata, duration };
		const video = item.video === true || item.mediaType === 1;
		return {
			itemId: this.itemIdOf(item) ?? "",
			mediaId: this.mediaIdOf(item) ?? "",
			mediaType: video ? 1 : 0,
			metadata,
			policy: item.policy,
			streamType: item.streamType,
		};
	}
	// #endregion

	// #region Queue server
	private authHeader(server: ServerInfo) {
		const auth = server.authInfo;
		if (auth?.headerAuth) return auth.headerAuth;
		const params = auth?.oauthParameters ?? auth?.oauthServerInfo?.authInfo.oauthParameters;
		return params ? `Bearer ${params.accessToken}` : undefined;
	}

	private async queueRequest(
		method: "GET" | "POST" | "PUT",
		url: string,
		{ body, timeoutMs = httpTimeoutMs, retried = false }: { body?: Json; timeoutMs?: number; retried?: boolean } = {},
	): Promise<Json> {
		const server = this.queueServer;
		if (server === undefined) throw new Error("No queue server");
		if (!this.isTrustedUrl(url)) throw new Error(`Untrusted queue server ${url}`);
		const headers: Record<string, string> = {};
		const auth = this.authHeader(server);
		if (auth) headers.Authorization = auth;
		if (body !== undefined) headers["Content-Type"] = "application/json";
		const res = await this.requestJson(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			timeoutMs,
		});
		if (res.status === 401 && !retried && (await this.refreshToken())) return this.queueRequest(method, url, { body, timeoutMs, retried: true });
		if (!res.ok) throw Object.assign(new Error(`Queue server HTTP ${res.status}`), { status: res.status });
		return res.json();
	}

	private queueServerError(err: unknown) {
		this.toSession({ command: "notifyQueueServerError", errorCode: (err as { status?: number }).status ?? 0, details: { description: String(err) } });
	}

	// Changes the phone's queue on the queue server, the phone reads it back from there. False when it was not saved
	private async putQueue(path: string, body: Json) {
		if (this.queueServer === undefined || this.queueInfo === undefined) return false;
		try {
			await this.queueRequest("PUT", `${this.queueServer.serverUrl}/${this.queueInfo.queueId}/${path}`, { body });
			return true;
		} catch (err) {
			this.log(`queue ${path} failed`, err);
			this.queueServerError(err);
			return false;
		}
	}

	// The phone's access token expires, the refresh token in the queue server info gets a new one
	private async refreshToken() {
		const auth = this.queueServer?.authInfo;
		const oauth = auth?.oauthServerInfo;
		const params = auth?.oauthParameters ?? oauth?.authInfo.oauthParameters;
		if (oauth === undefined || params === undefined || !this.isTrustedUrl(oauth.serverUrl)) return false;
		const form = new URLSearchParams({ refresh_token: params.refreshToken });
		if (oauth.formParameters) {
			form.set("grant_type", oauth.formParameters.grant_type);
			form.set("scope", oauth.formParameters.scope);
		}
		try {
			const res = await this.requestJson(oauth.serverUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
					...(oauth.authInfo.headerAuth ? { Authorization: oauth.authInfo.headerAuth } : {}),
				},
				body: form.toString(),
				timeoutMs: httpTimeoutMs,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = res.json();
			if (typeof json.access_token !== "string") throw new Error("No access_token");
			params.accessToken = json.access_token;
			if (typeof json.refresh_token === "string") params.refreshToken = json.refresh_token;
			// headerAuth would still carry the old token
			if (auth?.headerAuth) delete auth.headerAuth;
			this.log("token refreshed");
			return true;
		} catch (err) {
			this.log("token refresh failed", err);
			return false;
		}
	}
	// #endregion

	// #region Player
	private setMedia(media: MediaInfo, autoplay = true, position?: unknown) {
		const positionMs = typeof position === "number" && Number.isFinite(position) && position > 0 ? position : 0;
		// The player follows the phone again (the load stops its mirroring)
		this.setMirroring(false);
		this.media = media;
		this.autoplay = autoplay;
		this.positionMs = positionMs;
		this.finished = false;
		// With its metadata: the phone's format (its images) is not documented
		this.log("media", media.mediaId, media.itemId, JSON.stringify(media.metadata ?? null));
		this.toSession(this.mediaChanged(media));
		this.setPlayerState("BUFFERING");
		this.options.toPlayer({ type: "load", mediaId: media.mediaId, mediaType: media.mediaType, autoplay, positionMs });
	}

	// TIDAL's phone app parses every field with a fixed type: no nulls
	private mediaChanged(media: MediaInfo) {
		return {
			command: "notifyMediaChanged",
			mediaInfo: {
				itemId: media.itemId,
				mediaId: media.mediaId,
				mediaType: media.mediaType,
				// An empty string fails the phone's check of the whole message (it then shows no duration and its seek bar sends 0),
				// no source and no stream type are left out
				...(media.streamType ? { streamType: media.streamType } : {}),
				customData: "{}",
				metadata: media.metadata ?? { title: "Unknown" },
				policy: media.policy ?? { canNext: true, canPrevious: true },
			},
		};
	}

	private playerStatus() {
		return { command: "notifyPlayerStatusChanged", playerState: this.playerState, progress: Math.round(this.positionMs) };
	}

	private setPlayerState(state: PlayerState) {
		if (state === this.playerState) return;
		this.playerState = state;
		this.lastProgressSent = Date.now();
		this.toSession(this.playerStatus());
	}

	// What the player did
	onPlayerEvent(event: PlayerEvent) {
		// Not the phone's media, also outside a session (told when one starts), not behind a step loading the queue
		if (event.type === "volume") return this.setVolume(event.level, event.mute);
		if (event.type === "takenOver") this.takeovers++;
		return this.serial(() => this.handlePlayerEvent(event), `player ${event.type}`);
	}
	private async handlePlayerEvent(event: PlayerEvent) {
		if (this.session === undefined || this.session.suspended) return;
		// TIDAL's own queue goes on by itself while mirroring, a late report of the phone's media does not step the phone's
		if (this.mirroring && ["ended", "error", "next", "previous", "play", "takenOver"].includes(event.type)) return;
		switch (event.type) {
			case "state":
				if (event.state === "PLAYING") this.failedInARow = 0;
				if (!this.finished) this.setPlayerState(event.state);
				return;
			case "progress": {
				if (!Number.isFinite(event.positionMs) || this.finished) return;
				this.positionMs = event.positionMs;
				const now = Date.now();
				if (event.seeked !== true && now - this.lastProgressSent < progressIntervalMs) return;
				this.lastProgressSent = now;
				return this.toSession(this.playerStatus());
			}
			case "ended":
				// Stopped by the phone: what the desktop played after it does not go on in the phone's queue
				if (this.media === undefined) return;
				return this.step(1, true);
			case "error":
				this.toSession({ command: "notifyPlaybackError", statusCode: event.message ?? "error" });
				// The queue goes on past a media that cannot play (unavailable, removed from TIDAL), like TIDAL's own player
				if (event.unavailable === true && this.queueInfo !== undefined && this.failedInARow < maxFailedInARow) {
					this.failedInARow++;
					return this.step(1, true, true);
				}
				this.setPlayerState("IDLE");
				// TIDAL reports the previous media paused afterwards
				this.finished = true;
				return;
			// The desktop's next and previous, also not in the phone's queue once it stopped
			case "next":
				if (this.media === undefined) return;
				return this.step(1, false);
			case "previous":
				if (this.media === undefined) return;
				return this.step(-1, false);
			case "play":
				return this.play();
			case "takenOver":
				// The phone is shown what the desktop plays and controls it, the queue stays for a load of the phone's (which takes the player back)
				this.log("the desktop played its own media");
				this.media = undefined;
				this.setMirroring(true);
				this.finished = false;
				this.options.toPlayer({ type: "mirror" });
				return;
			case "desktopMedia": {
				// A late one after the phone's load took the player back
				if (!this.mirroring) return;
				const { elementId, mediaId, mediaType, positionMs, metadata, queue } = event;
				// Its item in the cloud queue made of the desktop's queue, the phone shows it from there
				this.mirrorElementId = elementId;
				const itemId = this.mirrorQueue?.itemIds.get(elementId) ?? `desktop:${elementId}`;
				this.media = { itemId, mediaId, mediaType, metadata };
				if (Number.isFinite(positionMs)) this.positionMs = positionMs;
				this.log("desktop media", mediaId, itemId);
				this.toSession(this.mediaChanged(this.media));
				this.toSession(this.playerStatus());
				if (queue !== undefined && queue.length !== 0) this.makeMirrorQueue(queue);
				return;
			}
		}
	}

	// #region Mirror queue
	private setMirroring(mirroring: boolean) {
		this.mirroring = mirroring;
		this.mirrorGeneration++;
		this.mirrorQueue = this.mirrorQueueMaking = this.mirrorQueueNext = this.mirrorElementId = undefined;
		clearTimeout(this.mirrorResendTimer);
	}

	// Makes a cloud queue of the desktop's queue (with the phone's token) and gives it to the phone, unless it has it already.
	// Not waited for: a queue server that is slow does not hold the phone's commands
	private makeMirrorQueue(queue: DesktopQueueItem[]) {
		const signature = queue.map((item) => item.elementId).join(",");
		// The one being made is followed by the latest one asked for meanwhile (none when that is the one being made)
		if (this.mirrorQueueMaking !== undefined) return void (this.mirrorQueueNext = signature === this.mirrorQueueMaking ? undefined : queue);
		if (signature === this.mirrorQueue?.signature || this.queueServer === undefined) return;
		this.mirrorQueueMaking = signature;
		const generation = this.mirrorGeneration;
		this.createMirrorQueue(queue, signature, generation)
			.catch((err) => this.log("mirror queue failed", err))
			.finally(() => {
				if (generation !== this.mirrorGeneration) return;
				this.mirrorQueueMaking = undefined;
				const next = this.mirrorQueueNext;
				this.mirrorQueueNext = undefined;
				if (next !== undefined) this.makeMirrorQueue(next);
			});
	}

	private async createMirrorQueue(queue: DesktopQueueItem[], signature: string, generation: number) {
		const server = this.queueServer;
		if (server === undefined) return;
		// The queue server takes TIDAL's numeric ids only (an upload or a local file is left out)
		const entries = queue.filter((item) => /^\d+$/.test(item.mediaId));
		if (entries.length === 0) return;
		const created = await this.queueRequest("POST", server.serverUrl, {
			body: {
				items: entries.map((item, index) => ({
					media_id: Number(item.mediaId),
					type: item.mediaType === 1 ? "video" : "track",
					properties: { active: true, original_order: index },
				})),
				repeat_mode: "off",
				shuffled: false,
			},
		});
		if (generation !== this.mirrorGeneration || !this.mirroring) return;
		const queueId = typeof created.id === "string" || typeof created.id === "number" ? String(created.id) : undefined;
		if (queueId === undefined || queueId === "") throw new Error("No queue id");
		// The items come back in the order sent, each with its id
		let items: Json[] = Array.isArray(created.items) ? created.items : [];
		if (items.length < entries.length) {
			// Failing, the queue is given as it came (its items not named are by their element): not made again for each media
			const page = await this.queueRequest("GET", `${server.serverUrl}/${queueId}/items?offset=0&limit=${entries.length}`).catch((err) => {
				this.log("mirror queue items failed", err);
				return undefined;
			});
			if (generation !== this.mirrorGeneration || !this.mirroring) return;
			if (Array.isArray(page?.items)) items = page.items;
		}
		const itemIds = new Map<string, string>();
		entries.forEach((entry, index) => {
			const item = items[index];
			if (item !== undefined && item.id !== undefined && String(item.media_id) === entry.mediaId) itemIds.set(entry.elementId, String(item.id));
		});
		this.mirrorQueue = { signature, itemIds };
		this.queueInfo = {
			queueId,
			repeatMode: "NONE",
			shuffled: false,
			maxBeforeSize: this.queueInfo?.maxBeforeSize ?? windowSizeOf(undefined),
			maxAfterSize: this.queueInfo?.maxAfterSize ?? windowSizeOf(undefined),
		};
		// The receiver's window was the phone's queue
		this.clearItems();
		this.log("mirror queue", queueId, itemIds.size, "items");
		this.toSession({ command: "notifyQueueChanged", queueInfo: this.queueInfo });
		this.sendMirrorMedia();
		// The phone moves to the item only once it has read the new queue: told again a moment later
		clearTimeout(this.mirrorResendTimer);
		this.mirrorResendTimer = setTimeout(() => this.sendMirrorMedia(), mirrorResendMs);
	}

	// The desktop's media by its item in the cloud queue
	private sendMirrorMedia() {
		let media = this.media;
		if (!this.mirroring || media === undefined || this.mirrorElementId === undefined) return;
		const itemId = this.mirrorQueue?.itemIds.get(this.mirrorElementId) ?? `desktop:${this.mirrorElementId}`;
		this.media = media = { ...media, itemId };
		this.toSession(this.mediaChanged(media));
		this.toSession(this.playerStatus());
	}
	// #endregion

	// The phone's or the desktop's play, also of a media that ended (the player loads it again)
	// Without a media (stopped) nothing plays, the player's states stay the phone's no more
	private play() {
		if (this.media === undefined) return;
		this.finished = false;
		this.options.toPlayer({ type: "play" });
	}
	// #endregion
}
