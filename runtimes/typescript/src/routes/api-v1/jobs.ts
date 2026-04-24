/**
 * `/api/v1/workspaces/{workspaceId}/jobs` — poll + SSE for background
 * operations kicked off by async-capable routes (today: ingest).
 *
 * `GET /jobs/{jobId}` is a point-in-time fetch suitable for polling.
 *
 * `GET /jobs/{jobId}/events` is an SSE stream that emits one
 * `data: <JobRecord JSON>` event per update and closes once the job
 * reaches a terminal state. The initial record is replayed
 * immediately so clients don't race the first update.
 *
 * Workspace-scoped so authorization reuses `assertWorkspaceAccess` —
 * a scoped token for workspace A cannot read jobs from workspace B.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { JobStore } from "../../jobs/store.js";
import type { JobRecord } from "../../jobs/types.js";
import { isTerminal } from "../../jobs/types.js";
import { makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	ErrorEnvelopeSchema,
	JobIdParamSchema,
	JobRecordSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export interface JobsRouteDeps {
	readonly jobs: JobStore;
}

export function jobRoutes(deps: JobsRouteDeps): OpenAPIHono<AppEnv> {
	const { jobs } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/jobs/{jobId}",
			tags: ["jobs"],
			summary: "Get a job",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					jobId: JobIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: JobRecordSchema } },
					description: "Job",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Job not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, jobId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const job = await jobs.get(workspaceId, jobId);
			if (!job) throw new ControlPlaneNotFoundError("job", jobId);
			return c.json(toWireShape(job), 200);
		},
	);

	// SSE route — registered directly on the app, not via `openapi()`,
	// because `text/event-stream` doesn't fit the zod-openapi JSON
	// response model and we want the stream to be a legitimate
	// keep-alive rather than a finite JSON blob.
	app.get("/:workspaceId/jobs/:jobId/events", async (c) => {
		const workspaceId = c.req.param("workspaceId");
		const jobId = c.req.param("jobId");
		assertWorkspaceAccess(c, workspaceId);
		const initial = await jobs.get(workspaceId, jobId);
		if (!initial) {
			return c.json(
				{
					error: {
						code: "job_not_found",
						message: `job '${jobId}' not found`,
						requestId: c.get("requestId") ?? "unknown",
					},
				},
				404,
			);
		}

		return streamSSE(c, async (stream) => {
			// Each subscriber gets its own queue so a slow consumer can't
			// block a fast one. The listener just pushes into the queue;
			// the async loop drains it.
			const queue: JobRecord[] = [];
			let resolveNext: (() => void) | null = null;
			let aborted = false;

			const unsub = await jobs.subscribe(workspaceId, jobId, (record) => {
				queue.push(record);
				resolveNext?.();
				resolveNext = null;
			});

			// Clean up when the client disconnects.
			stream.onAbort(() => {
				aborted = true;
				unsub();
				resolveNext?.();
			});

			try {
				while (!aborted) {
					if (queue.length === 0) {
						await new Promise<void>((resolve) => {
							resolveNext = resolve;
						});
						if (aborted) break;
					}
					const record = queue.shift();
					if (!record) continue;
					await stream.writeSSE({
						event: "job",
						data: JSON.stringify(toWireShape(record)),
					});
					if (isTerminal(record.status)) {
						// One more `done` so clients have an unambiguous
						// terminator even when they don't parse `data`.
						await stream.writeSSE({
							event: "done",
							data: JSON.stringify({ status: record.status }),
						});
						break;
					}
				}
			} finally {
				unsub();
			}
		});
	});

	return app;
}

/** Convert a {@link JobRecord} to a mutable JSON-friendly object. The
 * Hono response inference prefers non-readonly maps in `result`, so a
 * shallow copy is cheaper than fighting the types. */
function toWireShape(job: JobRecord) {
	return {
		...job,
		result: job.result ? { ...job.result } : null,
	};
}
