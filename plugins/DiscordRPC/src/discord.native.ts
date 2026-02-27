import { Client, StatusDisplayType, type ClientOptions, type SetActivity } from "@xhayper/discord-rpc";
import { asyncDebounce } from "@inrixia/helpers";
import { getAvailablePipes } from "./getAvailablePipes.native";

let rpcClient: Client | null = null;
let currentPipeId: number = -1;

export const getClient = asyncDebounce(async (preferredPipeId: number = -1) => {
	const availablePipes = await getAvailablePipes();
	
	let targetPipe = preferredPipeId;
	if (availablePipes.length > 0) {
		targetPipe = availablePipes.includes(preferredPipeId) ? preferredPipeId : availablePipes[0];
	}

	if (rpcClient && currentPipeId !== targetPipe) {
		await rpcClient.destroy().catch(() => {});
		rpcClient = null;
	}

	const isAvailable = rpcClient && rpcClient.transport.isConnected && rpcClient.user;
	if (isAvailable) return rpcClient!;

	if (rpcClient) await rpcClient.destroy().catch(() => {});

	const clientOptions: ClientOptions = {
		clientId: "1130698654987067493"
	};

	if (targetPipe >= 0) {
		clientOptions.pipeId = targetPipe;
	}

	rpcClient = new Client(clientOptions);
	currentPipeId = targetPipe;

	try {
		await rpcClient.connect();
		return rpcClient;
	} catch (error) {
		rpcClient = null;
		throw error;
	}
});

export const setActivity = async (activity?: SetActivity, preferredPipeId: number = -1) => {
	const client = await getClient(preferredPipeId);
	if (!client || !client.user) return;
	if (!activity) return client.user.clearActivity();
	return await client.user.setActivity(activity);
};

export const cleanupRPC = () => {
	if (rpcClient) rpcClient.destroy().catch(() => {});
};

export const StatusDisplayTypeEnum = () => ({
	Name: StatusDisplayType.NAME,
	State: StatusDisplayType.STATE,
	Details: StatusDisplayType.DETAILS,
});
