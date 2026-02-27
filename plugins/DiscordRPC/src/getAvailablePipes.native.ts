import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

export const getAvailablePipes = async (): Promise<number[]> => {
	const pipes = new Set<number>();
	try {
		if (process.platform === "win32") {
			const files = await readdir("\\\\.\\pipe\\");
			for (const file of files) {
				if (file.startsWith("discord-ipc-")) {
					const id = parseInt(file.replace("discord-ipc-", ""), 10);
					if (!isNaN(id)) pipes.add(id);
				}
			}
		} else {
			const tempDir = process.env.XDG_RUNTIME_DIR ?? tmpdir();
			const files = await readdir(tempDir);
			for (const file of files) {
				if (file.startsWith("discord-ipc-")) {
					const id = parseInt(file.replace("discord-ipc-", ""), 10);
					if (!isNaN(id)) pipes.add(id);
				}
			}
		}
	} catch {
		// Ignore read errors
	}
	return Array.from(pipes).sort((a, b) => a - b);
};
