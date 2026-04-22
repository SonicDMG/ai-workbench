import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileControlPlaneStore } from "../../src/control-plane/file/store.js";
import { runContract } from "./contract.js";

runContract("file", async () => {
	const root = await mkdtemp(join(tmpdir(), "wb-cp-"));
	const store = new FileControlPlaneStore({ root });
	await store.init?.();
	return {
		store,
		cleanup: async () => {
			await rm(root, { recursive: true, force: true });
		},
	};
});
