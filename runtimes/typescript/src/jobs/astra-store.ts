/**
 * Astra-backed {@link JobStore}.
 *
 * Storage: `wb_jobs_by_workspace` — partition per workspace, sorted
 * by `job_id`. `result` round-trips through a serialized `result_json`
 * text column (same pattern as `filter_json` on saved queries).
 *
 * Pub/sub is in-process only (shared {@link JobSubscriptions} helper).
 * That's acceptable today because:
 *   - the Astra table gives us durable records that survive restart,
 *     which is the durability story we're after;
 *   - SSE subscribers are stuck to whichever replica accepts their
 *     `GET /jobs/{id}/events` until the connection drops, so they're
 *     always co-located with the `update()` caller that owns the
 *     pipeline (async ingest runs in the same process as the SSE
 *     reader).
 *
 * Cross-replica fan-out (Redis / Pulsar / …) becomes necessary if
 * async pipelines ever run on a different replica than the SSE
 * subscriber. The pub/sub seam is already isolated, so adding it is
 * a swap of {@link JobSubscriptions} for a remote variant.
 */

import { randomUUID } from "node:crypto";
import type { JobRow } from "../astra-client/row-types.js";
import type { TablesBundle } from "../astra-client/tables.js";
import { nowIso } from "../control-plane/defaults.js";
import { ControlPlaneNotFoundError } from "../control-plane/errors.js";
import { applyUpdate } from "./memory-store.js";
import type { JobListener, JobStore, Unsubscribe } from "./store.js";
import { JobSubscriptions } from "./subscriptions.js";
import type {
	CreateJobInput,
	JobKind,
	JobRecord,
	JobStatus,
	UpdateJobInput,
} from "./types.js";

export class AstraJobStore implements JobStore {
	private readonly subscriptions = new JobSubscriptions();

	constructor(private readonly tables: TablesBundle) {}

	async create(input: CreateJobInput): Promise<JobRecord> {
		const jobId = input.jobId ?? randomUUID();
		const now = nowIso();
		const record: JobRecord = {
			workspace: input.workspace,
			jobId,
			kind: input.kind,
			catalogUid: input.catalogUid ?? null,
			documentUid: input.documentUid ?? null,
			status: "pending",
			processed: 0,
			total: input.total ?? null,
			result: null,
			errorMessage: null,
			createdAt: now,
			updatedAt: now,
		};
		await this.tables.jobs.insertOne(jobToRow(record));
		return record;
	}

	async get(workspace: string, jobId: string): Promise<JobRecord | null> {
		const row = await this.tables.jobs.findOne({
			workspace,
			job_id: jobId,
		});
		return row ? jobFromRow(row) : null;
	}

	async update(
		workspace: string,
		jobId: string,
		patch: UpdateJobInput,
	): Promise<JobRecord> {
		const existing = await this.tables.jobs.findOne({
			workspace,
			job_id: jobId,
		});
		if (!existing) {
			throw new ControlPlaneNotFoundError("job", jobId);
		}
		const next = applyUpdate(jobFromRow(existing), patch);
		const nextRow = jobToRow(next);
		const { workspace: _w, job_id: _j, ...fields } = nextRow;
		await this.tables.jobs.updateOne(
			{ workspace, job_id: jobId },
			{ $set: fields },
		);
		this.subscriptions.fire(workspace, jobId, next);
		return next;
	}

	async subscribe(
		workspace: string,
		jobId: string,
		listener: JobListener,
	): Promise<Unsubscribe> {
		const unsub = this.subscriptions.add(workspace, jobId, listener);
		const current = await this.get(workspace, jobId);
		if (current) {
			try {
				listener(current);
			} catch {
				// ignore
			}
		}
		return unsub;
	}
}

/* ----- Row <-> Record conversion ---------------------------------- */

function jobToRow(r: JobRecord): JobRow {
	return {
		workspace: r.workspace,
		job_id: r.jobId,
		kind: r.kind,
		catalog_uid: r.catalogUid,
		document_uid: r.documentUid,
		status: r.status,
		processed: r.processed,
		total: r.total,
		result_json: r.result ? JSON.stringify(r.result) : null,
		error_message: r.errorMessage,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

function jobFromRow(row: JobRow): JobRecord {
	return {
		workspace: row.workspace,
		jobId: row.job_id,
		kind: row.kind as JobKind,
		catalogUid: row.catalog_uid,
		documentUid: row.document_uid,
		status: row.status as JobStatus,
		processed: row.processed,
		total: row.total,
		result: row.result_json
			? (JSON.parse(row.result_json) as Record<string, unknown>)
			: null,
		errorMessage: row.error_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}
