// Stand-in for plugins/DiscordRPC/src/index.ts (the real one registers TIDAL listeners on import)
import { Tracer } from "./lunaCore";
export const { trace, errSignal } = Tracer("[DiscordRPC]");
