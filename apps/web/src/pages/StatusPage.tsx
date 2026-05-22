/**
 * `/status` — operator-facing runtime health page.
 *
 * Cards (top → bottom):
 *   1. Control-plane probe (backend kind + reachability + latency)
 *   2. Chat provider probe (when one is configured)
 *   3. Ingest queue (active / queued / capacity, from the semaphore)
 *   4. Recent errors (last 100, newest first, no PII)
 *
 * All four panels degrade gracefully when the runtime is unreachable
 * (the underlying hooks return `null` and the card shows a dim
 * "unavailable" state instead of crashing the page).
 */
import { AlertTriangle, Database, MessageSquare, Workflow } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useHealthDetails, useRecentErrors } from "@/hooks/useHealthDetails";
import type { ProbeResult } from "@/lib/schemas";

type StatusTone = "ok" | "degraded" | "down" | "unknown";

function toneFromStatus(status: ProbeResult["status"]): StatusTone {
	if (status === "ok" || status === "degraded" || status === "down") {
		return status;
	}
	return "unknown";
}

function StatusBadge({ tone }: { readonly tone: StatusTone }) {
	const label =
		tone === "ok"
			? "OK"
			: tone === "degraded"
				? "DEGRADED"
				: tone === "down"
					? "DOWN"
					: "—";
	const className =
		tone === "ok"
			? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
			: tone === "degraded"
				? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200"
				: tone === "down"
					? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
					: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
		>
			{label}
		</span>
	);
}

interface ProbeCardProps {
	readonly icon: React.ReactNode;
	readonly title: string;
	readonly description: string;
	readonly probe: ProbeResult | undefined;
}

function ProbeCard({ icon, title, description, probe }: ProbeCardProps) {
	const tone: StatusTone = probe ? toneFromStatus(probe.status) : "unknown";
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						{icon}
						<CardTitle>{title}</CardTitle>
					</div>
					<StatusBadge tone={tone} />
				</div>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="text-sm text-slate-700 dark:text-slate-200">
					{probe ? probe.detail : "Runtime unreachable from this page."}
				</div>
				{probe ? (
					<div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
						probed in {probe.durationMs} ms
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

export function StatusPage() {
	const health = useHealthDetails();
	const errors = useRecentErrors();
	const data = health.data ?? null;

	return (
		<div className="mx-auto max-w-4xl space-y-6">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
					System status
				</h1>
				<p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
					Live snapshot of the runtime's backend health, ingest queue, and most
					recent error envelopes. Polled every 10 seconds.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<ProbeCard
					icon={<Database className="h-5 w-5" aria-hidden="true" />}
					title="Control plane"
					description="Round-trips listWorkspaces() through the active backend."
					probe={data?.controlPlane}
				/>
				<ProbeCard
					icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
					title="Chat provider"
					description="Cheapest authed call against the configured chat provider (HF whoami / OpenAI /models)."
					probe={data?.chat}
				/>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<Workflow className="h-5 w-5" aria-hidden="true" />
						<CardTitle>Ingest queue</CardTitle>
					</div>
					<CardDescription>
						In-flight + waiting ingest workers on this replica, bounded by{" "}
						<code className="font-mono">runtime.maxConcurrentIngestJobs</code>.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{data?.ingest ? (
						<div className="grid grid-cols-3 gap-4 text-sm">
							<div>
								<div className="text-xs text-slate-500">Active</div>
								<div className="font-mono text-lg">{data.ingest.active}</div>
							</div>
							<div>
								<div className="text-xs text-slate-500">Queued</div>
								<div className="font-mono text-lg">{data.ingest.queued}</div>
							</div>
							<div>
								<div className="text-xs text-slate-500">Capacity</div>
								<div className="font-mono text-lg">{data.ingest.capacity}</div>
							</div>
						</div>
					) : (
						<div className="text-sm text-slate-500">Stats unavailable.</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<AlertTriangle
								className="h-5 w-5 text-amber-600"
								aria-hidden="true"
							/>
							<CardTitle>Recent errors</CardTitle>
						</div>
						<span className="text-xs text-slate-500">
							{errors.data
								? `${errors.data.entries.length} / ${errors.data.capacity}`
								: ""}
						</span>
					</div>
					<CardDescription>
						In-memory ring buffer of the most recent error envelopes. No bodies,
						no request paths beyond the matched route pattern.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{errors.data && errors.data.entries.length > 0 ? (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm">
								<thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-700">
									<tr>
										<th className="px-2 py-1">When</th>
										<th className="px-2 py-1">Status</th>
										<th className="px-2 py-1">Code</th>
										<th className="px-2 py-1">Route</th>
										<th className="px-2 py-1">Request ID</th>
									</tr>
								</thead>
								<tbody>
									{errors.data.entries.map((e) => (
										<tr
											key={e.requestId + e.ts}
											className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
										>
											<td className="px-2 py-1 font-mono text-xs">
												{new Date(e.ts).toLocaleTimeString()}
											</td>
											<td className="px-2 py-1 font-mono">{e.status}</td>
											<td className="px-2 py-1 font-mono">{e.code}</td>
											<td className="px-2 py-1 font-mono text-xs">
												{e.method} {e.routePattern}
											</td>
											<td className="px-2 py-1 font-mono text-xs text-slate-500">
												{e.requestId}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<div className="text-sm text-slate-500">No recent errors.</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
