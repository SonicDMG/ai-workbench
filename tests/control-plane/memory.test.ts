import { MemoryControlPlaneStore } from "../../src/control-plane/memory/store.js";
import { runContract } from "./contract.js";

runContract("memory", async () => ({
	store: new MemoryControlPlaneStore(),
}));
