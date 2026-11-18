import { Tracer, type LunaUnload } from "@luna/core";

export const unloads = new Set<LunaUnload>();
export const { trace, errSignal } = Tracer("[TidalTags]");
