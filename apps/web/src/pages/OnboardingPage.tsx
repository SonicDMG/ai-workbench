import { ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AgentTemplateGallery } from "@/components/agents/AgentTemplateGallery";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { AstraCliDetectionCard } from "@/components/workspaces/AstraCliDetectionCard";
import {
	AstraCliPicker,
	type AstraCliSelection,
} from "@/components/workspaces/AstraCliPicker";
import { KindPicker } from "@/components/workspaces/KindPicker";
import {
	WorkspaceForm,
	type WorkspaceFormPrefill,
} from "@/components/workspaces/WorkspaceForm";
import { useAstraCliInfo } from "@/hooks/useAstraCliInfo";
import { useAstraCliInventory } from "@/hooks/useAstraCliInventory";
import { useAgents } from "@/hooks/useConversations";
import { useCreateWorkspace, useWorkspaces } from "@/hooks/useWorkspaces";
import { api, formatApiError } from "@/lib/api";
import type { WorkspaceKind } from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Step = "kind" | "details" | "agents";

export function OnboardingPage() {
	const navigate = useNavigate();
	const { data: workspaces } = useWorkspaces();
	const { data: astraCli } = useAstraCliInfo();
	const { data: astraCliInventory } = useAstraCliInventory();
	const create = useCreateWorkspace();
	const [step, setStep] = useState<Step>("kind");
	// Default to Astra: it's the recommended (and production-grade)
	// backend, and the astra-cli auto-detection logic + workspace
	// test-connection flow downstream all assume the user picked
	// Astra unless they actively switched. Pre-selecting saves a
	// click on the happy path; users who want mock / HCD / OpenRAG
	// just click that tile to override before continuing.
	const [kind, setKind] = useState<WorkspaceKind | null>("astra");
	const [astraCliSelection, setAstraCliSelection] =
		useState<AstraCliSelection | null>(null);
	const [checkingConnection, setCheckingConnection] = useState(false);
	// Set when the workspace POST succeeds. Drives the step-3 agent
	// gallery — without an id, there's no workspace to instantiate
	// templates against.
	const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(
		null,
	);
	// The post-create workspace already has Bobby + Maven auto-seeded
	// by the runtime. Surface them in the gallery as "Added" so the
	// user knows they're not starting from zero.
	const seededAgents = useAgents(createdWorkspaceId ?? undefined);

	const isFirstRun = !workspaces || workspaces.length === 0;
	const astraLike = kind === "astra" || kind === "hcd";

	// Prefer the live picker (multiple profiles available) over the
	// boot-time detection card whenever the inventory endpoint reports
	// `available: true`. Otherwise fall back to the read-only banner.
	const inventoryAvailable = astraLike && astraCliInventory?.available === true;
	const astraCliDetected =
		!inventoryAvailable && astraCli?.detected === true && astraLike
			? astraCli
			: null;

	// Translate the picker selection into a WorkspaceForm prefill carrying
	// `astra-cli:<profile>:<dbId>:<token|endpoint>` refs. The form's
	// `key` is derived from the selection so a different pick remounts
	// the form with fresh defaults.
	const prefillFromPicker: WorkspaceFormPrefill | undefined =
		inventoryAvailable && astraCliSelection
			? {
					name: astraCliSelection.database.name,
					keyspace: astraCliSelection.database.keyspace ?? undefined,
					url: `astra-cli:${astraCliSelection.profile}:${astraCliSelection.database.id}:endpoint`,
					credentials: {
						token: `astra-cli:${astraCliSelection.profile}:${astraCliSelection.database.id}:token`,
					},
				}
			: undefined;
	const prefillFromDetection: WorkspaceFormPrefill | undefined =
		astraCliDetected
			? {
					name: astraCliDetected.database.name,
					keyspace: astraCliDetected.database.keyspace ?? undefined,
				}
			: undefined;
	const formPrefill = prefillFromPicker ?? prefillFromDetection;
	const formKey = prefillFromPicker
		? `picker-${astraCliSelection?.profile}-${astraCliSelection?.database.id}`
		: astraCliDetected
			? `prefill-${astraCliDetected.database.id}`
			: "no-prefill";

	return (
		<div className="mx-auto max-w-2xl">
			<div className="mb-6">
				<Button
					variant="ghost"
					size="sm"
					// Step 3 (agents) intentionally has no back-button affordance —
					// the workspace is already created at that point and going
					// "back" would be lying about the state.
					onClick={() => (step === "details" ? setStep("kind") : navigate("/"))}
					className="-ml-3"
					disabled={step === "agents"}
				>
					<ArrowLeft className="h-4 w-4" />
					{step === "details" ? "Change backend" : "Back"}
				</Button>
			</div>

			{isFirstRun ? (
				<div className="brand-surface mb-8 rounded-lg px-8 py-10 text-white shadow-lg shadow-[var(--color-brand-900)]/20">
					<div className="relative flex items-start gap-5">
						<BrandMark size={56} />
						<div>
							<p className="text-xs font-medium tracking-[0.08em] text-white/70">
								DataStax, an IBM company
							</p>
							<h1 className="mt-2 text-3xl font-semibold tracking-tight">
								Manage AI-ready data at scale
							</h1>
							<p className="mt-3 text-sm leading-relaxed text-white/85 max-w-lg">
								A <strong className="font-semibold">workspace</strong> is the
								top-level tenant for knowledge bases, services, and documents.
								Use it to organize ingestion, retrieval, and governed AI app
								data across Astra DB, HCD, and local mock environments.
							</p>
						</div>
					</div>
				</div>
			) : (
				<div className="mb-8">
					<h1 className="text-2xl font-semibold tracking-tight text-slate-900">
						New workspace
					</h1>
					<p className="mt-1 text-sm text-slate-500">
						Pick a backend, then fill in the details.
					</p>
				</div>
			)}

			<div className="mb-8 flex items-center gap-3">
				<StepDot
					index={1}
					label="Backend"
					active={step === "kind"}
					done={step !== "kind"}
				/>
				<div className="h-px flex-1 bg-slate-200" />
				<StepDot
					index={2}
					label="Details"
					active={step === "details"}
					done={step === "agents"}
				/>
				<div className="h-px flex-1 bg-slate-200" />
				<StepDot
					index={3}
					label="Agents"
					active={step === "agents"}
					done={false}
				/>
			</div>

			{step === "kind" ? (
				<Card>
					<CardHeader>
						<CardTitle>Choose a backend</CardTitle>
						<CardDescription>
							The backend drives this workspace's data plane. It's immutable
							after creation — if you need to switch later, delete and recreate.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<KindPicker value={kind} onChange={setKind} />
					</CardContent>
					<div className="flex items-center justify-end gap-2 p-5 pt-0">
						<Button
							variant="brand"
							disabled={!kind}
							onClick={() => setStep("details")}
						>
							Continue
						</Button>
					</div>
				</Card>
			) : null}

			{step === "agents" && createdWorkspaceId ? (
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<Sparkles
								className="h-5 w-5 text-[var(--color-brand-600)]"
								aria-hidden="true"
							/>
							<CardTitle>Pick your agents</CardTitle>
						</div>
						<CardDescription>
							We've added <span className="font-medium">Bobby</span> and{" "}
							<span className="font-medium">Maven</span> to get you started.
							Want any of these other personas too? You can always add more
							later from the workspace's Agents page.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<AgentTemplateGallery
							workspaceId={createdWorkspaceId}
							existingAgents={seededAgents.data ?? []}
							hideRecommendedBadge
						/>
					</CardContent>
					<div className="flex items-center justify-end gap-2 p-5 pt-0">
						<Button
							variant="brand"
							onClick={() => navigate(`/workspaces/${createdWorkspaceId}`)}
						>
							Continue to workspace
							<ArrowRight className="h-4 w-4" />
						</Button>
					</div>
				</Card>
			) : null}

			{step === "details" && kind ? (
				<>
					{inventoryAvailable && astraCliInventory ? (
						<AstraCliPicker
							inventory={astraCliInventory}
							value={astraCliSelection}
							onChange={setAstraCliSelection}
						/>
					) : astraCliDetected ? (
						<AstraCliDetectionCard info={astraCliDetected} />
					) : null}
					<Card>
						<CardHeader>
							<CardTitle>Workspace details</CardTitle>
							<CardDescription>
								{kind === "mock" ? (
									"Mock workspaces run entirely in memory — no credentials needed."
								) : astraLike && prefillFromPicker ? (
									<>
										Credentials use the{" "}
										<code className="font-mono">astra-cli:</code> resolver —
										they're fetched on demand from the profile + database you
										picked above. No restart, no env vars to copy.
									</>
								) : astraLike ? (
									<>
										Credentials are stored as{" "}
										<code className="font-mono">provider:path</code> references,
										never raw values. We've pre-filled the two env-var refs
										Astra's SDK docs use by convention (
										<code className="font-mono">
											ASTRA_DB_APPLICATION_TOKEN
										</code>{" "}
										and <code className="font-mono">ASTRA_DB_API_ENDPOINT</code>
										) — set them in your <code className="font-mono">.env</code>{" "}
										or shell and the Test-connection probe will pick them up.
									</>
								) : (
									"Credentials are stored as references (env:VAR / file:/path), never raw values."
								)}
							</CardDescription>
						</CardHeader>
						<CardContent>
							<WorkspaceForm
								mode="create"
								kind={kind}
								key={formKey}
								prefill={formPrefill}
								submitting={create.isPending || checkingConnection}
								submitLabel="Create workspace"
								onCancel={() => setStep("kind")}
								onSubmit={async (input) => {
									try {
										const ws = await create.mutateAsync(input);
										setCheckingConnection(true);
										try {
											const probe = await api.testConnection(ws.workspaceId);
											if (probe.ok) {
												toast.success(`Workspace '${ws.name}' created`, {
													description: probe.details,
												});
											} else {
												toast.warning(
													`Workspace '${ws.name}' created, but the connection check failed`,
													{ description: probe.details },
												);
											}
										} catch (err) {
											toast.warning(
												`Workspace '${ws.name}' created, but the connection check could not run`,
												{ description: formatApiError(err) },
											);
										} finally {
											setCheckingConnection(false);
										}
										// Pivot to step 3 instead of going straight to the
										// workspace page so the user sees the template
										// gallery while the workspace context is fresh.
										setCreatedWorkspaceId(ws.workspaceId);
										setStep("agents");
									} catch (err) {
										setCheckingConnection(false);
										toast.error("Couldn't create workspace", {
											description: formatApiError(err),
										});
									}
								}}
							/>
						</CardContent>
					</Card>
				</>
			) : null}
		</div>
	);
}

function StepDot({
	index,
	label,
	active,
	done,
}: {
	index: number;
	label: string;
	active: boolean;
	done: boolean;
}) {
	return (
		<div className="flex items-center gap-2">
			<span
				className={cn(
					"flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
					done
						? "bg-[var(--color-brand-600)] text-white"
						: active
							? "bg-[var(--color-brand-600)] text-white ring-4 ring-[var(--color-brand-50)]"
							: "bg-slate-100 text-slate-500",
				)}
			>
				{done ? <CheckCircle2 className="h-4 w-4" /> : index}
			</span>
			<span
				className={cn(
					"text-sm",
					active ? "font-medium text-slate-900" : "text-slate-500",
				)}
			>
				{label}
			</span>
		</div>
	);
}
