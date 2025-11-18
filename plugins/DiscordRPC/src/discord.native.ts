import { Client, StatusDisplayType, type SetActivity } from "@xhayper/discord-rpc";

let rpcClient: Client | null = null;
export const getClient = async () => {
	const isAvailable = rpcClient && rpcClient.transport.isConnected && rpcClient.user;
	if (isAvailable) return rpcClient!;

	if (rpcClient) await rpcClient.destroy();
	rpcClient = new Client({ clientId: "1130698654987067493" });
	await rpcClient.connect();

	return rpcClient;
};

export const setActivity = async (activity?: SetActivity) => {
	const client = await getClient();
	if (!client.user) return;
	if (!activity) return client.user.clearActivity();
	return client.user.setActivity(activity);
};

export const cleanupRPC = () => rpcClient?.destroy()!;
export const StatusDisplayTypeEnum = () => ({
	Details: StatusDisplayType.DETAILS,
	Name: StatusDisplayType.NAME,
	State: StatusDisplayType.STATE,
});
