/**
 * RLAC backfill — one-shot migration for the prototype.
 *
 * Walks a {@link FileControlPlaneStore} root and:
 *   1. Creates an `admin` principal in every workspace that doesn't
 *      already have one.
 *   2. Sets `visibleTo = ["admin"]` and `ownerPrincipalId = "admin"`
 *      on every rag document whose `visibleTo` is null (pre-RLAC rows).
 *   3. Leaves rows whose `visibleTo` is already populated alone.
 *
 * Idempotent — safe to re-run. Run *before* flipping `policyEnabled`
 * on any KB, otherwise that KB instantly hides every legacy document.
 *
 * Usage:
 *   pnpm tsx runtimes/typescript/scripts/backfill-rlac.ts \
 *     --root /var/lib/workbench/state
 */

import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { FileControlPlaneStore } from "../src/control-plane/file/store.js";

interface Args {
	readonly root: string;
	readonly dryRun: boolean;
}

function parseScriptArgs(): Args {
	const { values } = parseArgs({
		options: {
			root: { type: "string", default: "/var/lib/workbench/state" },
			"dry-run": { type: "boolean", default: false },
		},
	});
	return {
		root: values.root as string,
		dryRun: values["dry-run"] === true,
	};
}

async function main(): Promise<void> {
	const args = parseScriptArgs();
	await mkdir(args.root, { recursive: true });
	const store = new FileControlPlaneStore({ root: args.root });
	await store.init?.();

	const workspaces = await store.listWorkspaces();
	console.log(
		`backfill: scanning ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}` +
			(args.dryRun ? " (dry run)" : ""),
	);

	let principalsCreated = 0;
	let documentsBackfilled = 0;
	let documentsSkipped = 0;

	for (const workspace of workspaces) {
		const admin = await store.getPrincipal(workspace.uid, "admin");
		if (!admin) {
			if (args.dryRun) {
				console.log(`  [${workspace.uid}] would create principal 'admin'`);
			} else {
				await store.createPrincipal(workspace.uid, {
					principalId: "admin",
					label: "Admin (backfill)",
					attributes: { role: "admin" },
				});
				console.log(`  [${workspace.uid}] created principal 'admin'`);
			}
			principalsCreated += 1;
		}

		const kbs = await store.listKnowledgeBases(workspace.uid);
		for (const kb of kbs) {
			const docs = await store.listRagDocuments(
				workspace.uid,
				kb.knowledgeBaseId,
			);
			for (const doc of docs) {
				if (doc.visibleTo !== null) {
					documentsSkipped += 1;
					continue;
				}
				if (args.dryRun) {
					console.log(
						`  [${workspace.uid}] [${kb.knowledgeBaseId}] would backfill ${doc.documentId}`,
					);
				} else {
					await store.updateRagDocument(
						workspace.uid,
						kb.knowledgeBaseId,
						doc.documentId,
						{
							visibleTo: ["admin"],
							ownerPrincipalId: "admin",
						},
					);
				}
				documentsBackfilled += 1;
			}
		}
	}

	console.log(
		`\nbackfill summary: principals_created=${principalsCreated}, documents_backfilled=${documentsBackfilled}, documents_skipped=${documentsSkipped}`,
	);
	if (args.dryRun) {
		console.log("(dry run — no writes performed)");
	}
}

main().catch((err: unknown) => {
	console.error(err);
	process.exitCode = 1;
});
