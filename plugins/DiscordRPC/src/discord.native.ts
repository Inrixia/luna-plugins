import { Client, StatusDisplayType, type ClientOptions, type SetActivity } from "@xhayper/discord-rpc";
import { asyncDebounce } from "@inrixia/helpers";
import { getAvailablePipes } from "./getAvailablePipes.native";

let rpcClient: Client | null = null;
let currentPipeId: number = -1;

export const getClient = asyncDebounce(async (preferredPipeId: number) => {
	const availablePipes = await getAvailablePipes();
	const targetPipe = availablePipes.length > 0 && !availablePipes.includes(preferredPipeId) ? availablePipes[0] : preferredPipeId;

	if (rpcClient && currentPipeId !== targetPipe) await rpcClient.destroy();

	if (rpcClient?.transport.isConnected && rpcClient.user) return rpcClient;

	const clientOptions: ClientOptions = { clientId: "1130698654987067493" };
	if (targetPipe >= 0) clientOptions.pipeId = targetPipe;

	rpcClient = new Client(clientOptions);
	await rpcClient.connect();
	currentPipeId = targetPipe;

	return rpcClient;
});

export const setActivity = async (activity?: SetActivity, preferredPipeId: number = -1) => {
	const client = await getClient(preferredPipeId);
	if (!client?.user) return;
	if (!activity) return client.user.clearActivity();
	return await client.user.setActivity(activity);
};

export const cleanupRPC = () => rpcClient?.destroy();

export const StatusDisplayTypeEnum = () => ({
	Name: StatusDisplayType.NAME,
	State: StatusDisplayType.STATE,
	Details: StatusDisplayType.DETAILS,
});
