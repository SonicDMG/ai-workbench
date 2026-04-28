import { CheckCircle2 } from "lucide-react";
import type { AstraCliInfo } from "@/lib/schemas";

/**
 * Confirmation card shown above the workspace form when the runtime
 * detected an Astra database from a configured `astra` CLI profile
 * at startup. The form's default `env:` refs resolve to this
 * database's token and endpoint at workspace-creation time, so
 * "Create" is enough — no copy-paste required.
 */
export function AstraCliDetectionCard({ info }: { info: AstraCliInfo }) {
	if (!info.detected) return null;
	const { profile, database } = info;
	return (
		<div
			className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50/70 p-5 text-emerald-900"
			role="status"
			aria-live="polite"
			data-testid="astra-cli-detection-card"
		>
			<div className="flex items-start gap-3">
				<CheckCircle2
					className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600"
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold">Astra CLI profile detected</p>
					<p className="mt-1 text-sm text-emerald-800/90">
						The runtime auto-loaded credentials from your{" "}
						<code className="font-mono text-xs">astra-cli</code> profile{" "}
						<strong className="font-semibold">"{profile}"</strong>. The form
						below is pre-filled — click <strong>Create workspace</strong> to use
						this database.
					</p>
					<dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
						<dt className="font-medium text-emerald-900/70">database</dt>
						<dd className="truncate font-mono text-emerald-900">
							{database.name}
						</dd>
						<dt className="font-medium text-emerald-900/70">region</dt>
						<dd className="truncate font-mono text-emerald-900">
							{database.region}
						</dd>
						<dt className="font-medium text-emerald-900/70">endpoint</dt>
						<dd
							className="truncate font-mono text-emerald-900"
							title={database.endpoint}
						>
							{database.endpoint}
						</dd>
						<dt className="font-medium text-emerald-900/70">keyspace</dt>
						<dd className="truncate font-mono text-emerald-900">
							{database.keyspace ?? "default_keyspace"}
						</dd>
					</dl>
				</div>
			</div>
		</div>
	);
}
