import { MockVectorStoreDriver } from "../../src/drivers/mock/store.js";
import { runDriverContract } from "./contract.js";

runDriverContract("mock", async () => ({
	driver: new MockVectorStoreDriver(),
}));
