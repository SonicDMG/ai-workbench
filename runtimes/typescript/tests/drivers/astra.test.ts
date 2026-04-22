import { AstraVectorStoreDriver } from "../../src/drivers/astra/store.js";
import { EnvSecretProvider } from "../../src/secrets/env.js";
import { SecretResolver } from "../../src/secrets/provider.js";
import { FakeDb } from "./astra-fake.js";
import { runDriverContract } from "./contract.js";

runDriverContract("astra (fake Db)", async () => {
	const savedToken = process.env.TEST_ASTRA_TOKEN;
	process.env.TEST_ASTRA_TOKEN = "fake-token";

	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const fakeDb = new FakeDb();
	const driver = new AstraVectorStoreDriver({
		secrets,
		dbFactory: () => fakeDb,
	});

	// The contract suite uses a mock-kind workspace with no url/token,
	// but we intercept the dbFactory so astra-db-ts's real
	// WorkspaceMisconfigured checks are bypassed. Give the driver a
	// workspace it finds acceptable via the factory override below.
	// We wrap the driver to inject a valid url/token on every call
	// while leaving the contract-suite workspace otherwise untouched.
	const wrapped: import("../../src/drivers/vector-store.js").VectorStoreDriver =
		{
			createCollection: (ctx) =>
				driver.createCollection({
					workspace: {
						...ctx.workspace,
						url: "https://fake.example",
						credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
					},
					descriptor: ctx.descriptor,
				}),
			dropCollection: (ctx) =>
				driver.dropCollection({
					workspace: {
						...ctx.workspace,
						url: "https://fake.example",
						credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
					},
					descriptor: ctx.descriptor,
				}),
			upsert: (ctx, records) =>
				driver.upsert(
					{
						workspace: {
							...ctx.workspace,
							url: "https://fake.example",
							credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
						},
						descriptor: ctx.descriptor,
					},
					records,
				),
			deleteRecord: (ctx, id) =>
				driver.deleteRecord(
					{
						workspace: {
							...ctx.workspace,
							url: "https://fake.example",
							credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
						},
						descriptor: ctx.descriptor,
					},
					id,
				),
			search: (ctx, req) =>
				driver.search(
					{
						workspace: {
							...ctx.workspace,
							url: "https://fake.example",
							credentialsRef: { token: "env:TEST_ASTRA_TOKEN" },
						},
						descriptor: ctx.descriptor,
					},
					req,
				),
		};

	return {
		driver: wrapped,
		cleanup: async () => {
			if (savedToken === undefined) delete process.env.TEST_ASTRA_TOKEN;
			else process.env.TEST_ASTRA_TOKEN = savedToken;
		},
	};
});
