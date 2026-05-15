/**
 * Seed an RLAC demo against a {@link FileControlPlaneStore}.
 *
 * Usage:
 *
 *   pnpm tsx runtimes/typescript/scripts/seed-rlac-demo.ts \
 *     --root /tmp/rlac-demo
 *
 * Creates one workspace, three principals (alice / bob / admin), a KB
 * named "Mixed Documents" with the canonical Stefano predicate
 * enabled, and ~6 documents with mixed visible_to. Runs the
 * enforcer against each principal and prints the documents they can
 * see — same logic the route handler would run on a real request.
 *
 * This is the data substrate for the demo script under
 * `docs/rlac-prototype/demo-script.md`.
 */

import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { FileControlPlaneStore } from "../src/control-plane/file/store.js";
import type { RagDocumentRecord } from "../src/control-plane/types.js";
import {
	buildPolicyContext,
	type PolicyDecisionPayload,
} from "../src/policy/enforcer.js";
import {
	DEFAULT_POLICY_DSL,
	type PrincipalContext,
} from "../src/policy/index.js";

interface Args {
	readonly root: string;
}

function parseScriptArgs(): Args {
	const { values } = parseArgs({
		options: {
			root: { type: "string", default: "/tmp/rlac-demo" },
		},
	});
	return { root: values.root as string };
}

function applyFilter(
	decision: PolicyDecisionPayload,
	docs: readonly RagDocumentRecord[],
): readonly RagDocumentRecord[] {
	if (!decision.filter) return docs;
	const filter = decision.filter as {
		$or?: Array<Record<string, string>>;
	};
	const allowedValues = filter.$or
		? filter.$or.flatMap((b) => Object.values(b)).map(String)
		: [];
	return docs.filter((d) => {
		const vt = d.visibleTo ?? [];
		return allowedValues.some((a) => vt.includes(a));
	});
}

async function main(): Promise<void> {
	const args = parseScriptArgs();
	await mkdir(args.root, { recursive: true });
	const store = new FileControlPlaneStore({ root: args.root });
	await store.init?.();

	const workspaceId = "00000000-0000-4000-8000-000000000001";
	if (!(await store.getWorkspace(workspaceId))) {
		await store.createWorkspace({
			uid: workspaceId,
			name: "RLAC demo",
			kind: "mock",
			url: null,
			keyspace: null,
			credentials: {},
		});
	}

	const chunking =
		(await store.listChunkingServices(workspaceId))[0] ??
		(await store.createChunkingService(workspaceId, {
			name: "demo-chunking",
			engine: "langchain_ts",
		}));
	const embedding =
		(await store.listEmbeddingServices(workspaceId))[0] ??
		(await store.createEmbeddingService(workspaceId, {
			name: "demo-embedding",
			provider: "openai",
			modelName: "text-embedding-3-small",
			embeddingDimension: 1536,
			distanceMetric: "cosine",
		}));

	const existingKbs = await store.listKnowledgeBases(workspaceId);
	const kb =
		existingKbs.find((k) => k.name === "Mixed Documents") ??
		(await store.createKnowledgeBase(workspaceId, {
			name: "Mixed Documents",
			chunkingServiceId: chunking.chunkingServiceId,
			embeddingServiceId: embedding.embeddingServiceId,
			policyDsl: DEFAULT_POLICY_DSL,
			policyEnabled: true,
		}));

	for (const seed of [
		{ id: "alice", label: "Alice", attrs: { role: "viewer" } },
		{ id: "bob", label: "Bob", attrs: { role: "viewer" } },
		{ id: "admin", label: "Admin", attrs: { role: "admin" } },
	]) {
		if (!(await store.getPrincipal(workspaceId, seed.id))) {
			await store.createPrincipal(workspaceId, {
				principalId: seed.id,
				label: seed.label,
				attributes: seed.attrs,
			});
		}
	}

	const seedDocs = [
		{ name: "public-1.md", visibleTo: ["*"] },
		{ name: "public-2.md", visibleTo: ["*"] },
		{ name: "alice-only.md", visibleTo: ["alice"] },
		{ name: "alice-and-bob.md", visibleTo: ["alice", "bob"] },
		{ name: "bob-only.md", visibleTo: ["bob"] },
		{ name: "admin-only.md", visibleTo: ["admin"] },
	];
	const existingDocs = await store.listRagDocuments(
		workspaceId,
		kb.knowledgeBaseId,
	);
	for (const seed of seedDocs) {
		if (existingDocs.some((d) => d.sourceFilename === seed.name)) continue;
		await store.createRagDocument(workspaceId, kb.knowledgeBaseId, {
			sourceFilename: seed.name,
			visibleTo: seed.visibleTo,
			ownerPrincipalId: seed.visibleTo[0] ?? null,
			status: "ready",
		});
	}

	const allDocs = await store.listRagDocuments(workspaceId, kb.knowledgeBaseId);
	console.log(
		`\nSeeded ${allDocs.length} documents in KB '${kb.name}' (${kb.knowledgeBaseId})`,
	);
	console.log(`Policy: ${kb.policyDsl}\n`);

	for (const id of ["alice", "bob", "admin", "carol-no-principal"]) {
		const principal: PrincipalContext | null =
			id === "carol-no-principal" ? null : { id, attributes: {} };
		try {
			const decision = await buildPolicyContext({
				workspace: workspaceId,
				knowledgeBase: kb,
				principal,
				action: "list",
				resourceId: "*",
				audit: store,
				workspaceRlacEnabled: true,
			});
			const visible = applyFilter(decision, allDocs);
			console.log(
				`view as '${id}' (${visible.length}/${allDocs.length}): ` +
					`${visible.map((d) => d.sourceFilename).join(", ")}`,
			);
			if (decision.filter) {
				console.log(`  compiled filter: ${JSON.stringify(decision.filter)}`);
			}
		} catch (err: unknown) {
			console.log(`view as '${id}': denied — ${(err as Error).message}`);
		}
	}

	const audit = await store.listPolicyAudit(workspaceId, { limit: 10 });
	console.log(`\nAudit tail (${audit.length}):`);
	for (const a of audit) {
		console.log(
			`  ${a.ts}  ${a.principalId ?? "<none>"}  ${a.action}  ${a.decision}  ${a.reason}`,
		);
	}
}

main().catch((err: unknown) => {
	console.error(err);
	process.exitCode = 1;
});
