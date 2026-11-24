// Stand-in for plugins/DiscordRPC/src/discord.native.ts: records activities instead of talking to Discord
export const activities: { activity: unknown; pipeId: number }[] = [];
export const discord = {
	setActivity: async (activity: unknown, pipeId: number = -1) => void activities.push({ activity, pipeId }),
};
export const setActivity = (activity?: unknown, pipeId?: number) => discord.setActivity(activity, pipeId);
export const cleanupRPC = () => {};
export const StatusDisplayTypeEnum = () => ({ Name: 0, State: 1, Details: 2 });
