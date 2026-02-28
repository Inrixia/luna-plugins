import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

export const getAvailablePipes = async (): Promise<number[]> => {
	const pipeDir = process.platform === "win32" ? "\\\\.\\pipe\\" : (process.env.XDG_RUNTIME_DIR ?? tmpdir());

	const pipes = new Set<number>();
	try {
		for (const file of await readdir(pipeDir)) {
			if (!file.startsWith("discord-ipc-")) continue;
			const id = parseInt(file.slice("discord-ipc-".length), 10);
			if (!isNaN(id)) pipes.add(id);
		}
	} catch {
		// Discord isn't running, or the pipe/temp directory can't be read
	}
	return Array.from(pipes).sort((a, b) => a - b);
};
