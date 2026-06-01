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
	/**
	 * Aborts on runtime shutdown. Threaded into the job-events SSE loop so
	 * a long-lived stream ends promptly instead of holding the connection
	 * open past `server.close()`'s drain window.
	 */
	readonly shutdownSignal?: AbortSignal;
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

	// SSE route. `text/event-stream` doesn't fit the zod-openapi typed
	// JSON response model (and we want a real keep-alive stream, not a
	// finite JSON blob), so we register the path in the OpenAPI document
	// explicitly — giving the key async-progress endpoint a machine-
	// readable contract — while keeping the hand-rolled handler below.
	const jobEventsRoute = createRoute({
		method: "get",
		path: "/{workspaceId}/jobs/{jobId}/events",
		tags: ["jobs"],
		summary: "Stream job progress (SSE)",
		description:
			"Server-Sent Events stream of a job's progress. Each `data:` frame is a JSON-encoded JobRecord (the same shape as `GET /jobs/{jobId}`), replayed immediately on connect and re-emitted on every update; the stream closes once the job reaches a terminal state. Every frame carries `id: <updatedAt>`, so a dropped client can reconnect with `Last-Event-ID` and resume from the last snapshot it saw instead of replaying from scratch.",
		request: {
			params: z.object({
				workspaceId: WorkspaceIdParamSchema,
				jobId: JobIdParamSchema,
			}),
			headers: z.object({
				"last-event-id": z.string().optional().openapi({
					description:
						"Last event `id` (a JobRecord `updatedAt`) the client received; resumes the stream from the next update rather than replaying from scratch.",
					example: "2026-05-31T12:00:00.000Z",
				}),
			}),
		},
		responses: {
			200: {
				content: {
					"text/event-stream": {
						schema: z.string().openapi({
							description:
								"SSE frames — `id: <updatedAt>` then `data: <JobRecord JSON>` per update, each terminated by a blank line.",
						}),
					},
				},
				description: "Job-progress event stream",
			},
			...errorResponse(404, "Job not found"),
		},
	});
	app.openAPIRegistry.registerPath(jobEventsRoute);

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
				drainSignal: deps.shutdownSignal,
			});
		});
	});

	return app;
}
