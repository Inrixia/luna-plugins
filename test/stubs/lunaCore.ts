// Minimal @luna/core for node:test. Only what the plugins import.
import { rejectNotOk, toJson } from "@inrixia/helpers";

export type LunaUnload = () => unknown;
export type LunaUnloads = Set<LunaUnload>;

/** Errors/messages logged through any Tracer, newest last */
export const traced: { level: string; context?: string; args: unknown[] }[] = [];

const makeLogger = (level: string) => {
	const log = (...args: unknown[]) => void traced.push({ level, args });
	log.withContext =
		(context: string) =>
		(...args: unknown[]) =>
			void traced.push({ level, context, args });
	return log;
};
const makeLevels = (prefix = "") => ({
	log: makeLogger(`${prefix}log`),
	warn: makeLogger(`${prefix}warn`),
	err: makeLogger(`${prefix}err`),
	debug: makeLogger(`${prefix}debug`),
});

export const Tracer = (_name: string) => ({
	trace: { ...makeLevels(), msg: makeLevels("msg.") },
	errSignal: <{ _: string | undefined }>{ _: undefined },
});

/** Values findModuleProperty looks through, set them before importing the code under test */
export const moduleProperties: Record<string, unknown> = {};
export const findModuleProperty = <T>(fn: (key: string, value: unknown) => boolean): { value: T } | undefined => {
	for (const [key, value] of Object.entries(moduleProperties)) if (fn(key, value)) return { value: <T>value };
	return undefined;
};

// Same as luna's render/src/helpers/fetch.ts: non 2xx responses reject with "<status> <statusText>" before the body is read
export const ftch = {
	json: <T>(...args: Parameters<typeof fetch>) =>
		fetch(...args)
			.then(rejectNotOk)
			.then(toJson<T>),
};

export const ReactiveStore = {
	getPluginStorage: async <T extends object>(_name: string, defaults?: T): Promise<T> => <T>{ ...defaults },
};
