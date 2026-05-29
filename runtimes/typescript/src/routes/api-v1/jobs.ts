/**
 * `/api/v1/workspaces/{workspaceId}/jobs` — poll + SSE for background
 * operations kicked off by async-capable routes (today: ingest).
 *
 * `GET /jobs/{jobId}` is a point-in-time fetch suitable for polling.
 *
 * `GET /jobs/{jobId}/events` is an SSE stream that emits one
 * `data: <JobRecord JSON>` event per update and closes once the job
 * reaches a terminal state. The initial record is replayed
 * immediately so clients don't race the first update. Each `job` frame
 * carries an `id: <updatedAt>` so a client that drops and reconnects
 * can present `Last-Event-ID` and resume from the last snapshot it saw
 * instead of replaying from scratch (job records are idempotent
 * snapshots, so a terminal frame is always re-sent on reconnect).
 *
 * Workspace-scoped so the app-level workspace authz wrapper blocks a
 * scoped token for workspace A from reading jobs in workspace B.
 *
 * The queue + listener + abort + single-terminal-event machinery lives
 * in the shared `lib/sse.ts` helper, which the agent chat stream uses
 * too.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { JobStore } from "../../jobs/store.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { runJobEventStream } from "../../lib/sse.js";
import type { AppEnv } from "../../lib/types.js";
import {
	JobIdParamSchema,
	JobRecordSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import { toWireJob } from "./serdes/index.js";

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
				...errorResponse(404, "Job not found"),
			},
		}),
		async (c) => {
			const { workspaceId, jobId } = c.req.valid("param");
			const job = await jobs.get(workspaceId, jobId);
			if (!job) throw new ControlPlaneNotFoundError("job", jobId);
			return c.json(toWireJob(job), 200);
		},
	);

	// SSE route — registered directly on the app, not via `openapi()`,
	// because `text/event-stream` doesn't fit the zod-openapi JSON
	// response model and we want the stream to be a legitimate
	// keep-alive rather than a finite JSON blob.
	app.get("/:workspaceId/jobs/:jobId/events", async (c) => {
		const workspaceId = c.req.param("workspaceId");
		const jobId = c.req.param("jobId");
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

		// `Last-Event-ID` is echoed by EventSource on reconnect; when
		// present we resume from the last job-record version the client
		// saw rather than replaying the (idempotent) snapshot it already
		// has. The shared helper owns the queue + abort + terminal-event
		// guarantee.
		const lastEventId = c.req.header("last-event-id") ?? null;
		return streamSSE(c, async (stream) => {
			await runJobEventStream(stream, {
				jobs,
				workspaceId,
				jobId,
				lastEventId,
				serialize: (record) => JSON.stringify(toWireJob(record)),
				onAbort: (handler) => stream.onAbort(handler),
			});
		});
	});

	return app;
}
