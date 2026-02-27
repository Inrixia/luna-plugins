import { Client, StatusDisplayType, type ClientOptions, type SetActivity } from "@xhayper/discord-rpc";
import fs from "node:fs";
import path from "node:path";

let rpcClient: Client | null = null;
let currentPipeId: number = -1;
let isConnecting: boolean = false;

export const getAvailablePipes = async (): Promise<number[]> => {
	const pipes: number[] = [];
	try {
		if (process.platform === "win32") {
			const files = fs.readdirSync("\\\\.\\pipe\\");
			for (const file of files) {
				if (file.startsWith("discord-ipc-")) {
					const id = parseInt(file.replace("discord-ipc-", ""), 10);
					if (!isNaN(id)) pipes.push(id);
				}
			}
		} else {
			const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
			const tempDir = fs.realpathSync(XDG_RUNTIME_DIR ?? TMPDIR ?? TMP ?? TEMP ?? `${path.sep}tmp`);
			const files = fs.readdirSync(tempDir);
			for (const file of files) {
				if (file.startsWith("discord-ipc-")) {
					const id = parseInt(file.replace("discord-ipc-", ""), 10);
					if (!isNaN(id)) pipes.push(id);
				}
			}
		}
	} catch {
		// Ignore read errors
	}
	return [...new Set(pipes)].sort((a, b) => a - b);
};

export const getClient = async (preferredPipeId: number = -1) => {
	if (isConnecting) return null;

	const availablePipes = await getAvailablePipes();
	if (availablePipes.length === 0) {
		if (rpcClient) await rpcClient.destroy().catch(() => {});
		rpcClient = null;
		currentPipeId = -1;
		return null;
	}

	const targetPipe = availablePipes.includes(preferredPipeId) ? preferredPipeId : availablePipes[0];

	if (rpcClient && currentPipeId !== targetPipe) {
		await rpcClient.destroy().catch(() => {});
		rpcClient = null;
	}

	const isAvailable = rpcClient && rpcClient.transport.isConnected && rpcClient.user;
	if (isAvailable) return rpcClient!;

	if (rpcClient) await rpcClient.destroy().catch(() => {});

	const clientOptions: ClientOptions = {
		clientId: "1130698654987067493",
		pipeId: targetPipe
	};

	rpcClient = new Client(clientOptions);
	currentPipeId = targetPipe;
	isConnecting = true;

	try {
		await rpcClient.connect();
	} catch {
		rpcClient = null;
	} finally {
		isConnecting = false;
	}

	return rpcClient;
};

export const setActivity = async (activity?: SetActivity, preferredPipeId: number = -1) => {
	try {
		const client = await getClient(preferredPipeId);
		if (!client || !client.user) return;
		if (!activity) return client.user.clearActivity();
		return await client.user.setActivity(activity);
	} catch {
		return;
	}
};

export const cleanupRPC = () => {
	if (rpcClient) rpcClient.destroy().catch(() => {});
};

export const StatusDisplayTypeEnum = () => ({
	Name: StatusDisplayType.NAME,
	State: StatusDisplayType.STATE,
	Details: StatusDisplayType.DETAILS,
});
