import { MemoryJobStore } from "../../src/jobs/memory-store.js";
import { runJobStoreContract } from "./contract.js";

runJobStoreContract("memory", async () => ({ store: new MemoryJobStore() }));
