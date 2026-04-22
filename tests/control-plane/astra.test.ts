import { AstraControlPlaneStore } from "../../src/control-plane/astra/store.js";
import { createFakeTablesBundle } from "./astra-fake.js";
import { runContract } from "./contract.js";

/**
 * Runs the shared control-plane contract suite against the astra-backed
 * store using an in-memory fake of the TablesBundle. Validates that the
 * store's CRUD + conversion logic is correct independent of Astra
 * transport.
 *
 * A separate integration test against a real Astra endpoint is gated
 * behind env vars and ships with the route layer (Phase 1a.3).
 */
runContract("astra (fake tables)", async () => ({
	store: new AstraControlPlaneStore(createFakeTablesBundle()),
}));
