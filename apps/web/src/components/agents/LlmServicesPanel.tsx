import { Cpu, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LlmServiceForm } from "@/components/agents/LlmServiceForm";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	useCreateLlmService,
	useDeleteLlmService,
	useLlmServices,
	useUpdateLlmService,
} from "@/hooks/useConversations";
import { formatApiError } from "@/lib/api";
import type {
	CreateLlmServiceInput,
	LlmServiceRecord,
	UpdateLlmServiceInput,
} from "@/lib/schemas";
import { formatDate } from "@/lib/utils";

export interface LlmServicesPanelProps {
	readonly workspace: string;
}

export function LlmServicesPanel({ workspace }: LlmServicesPanelProps) {
	const list = useLlmServices(workspace);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<LlmServiceRecord | null>(null);
	const [deleting, setDeleting] = useState<LlmServiceRecord | null>(null);

	if (list.isLoading) {
		return <LoadingState label="Loading LLM services…" />;
	}
	if (list.isError) {
		return (
			<ErrorState
				title="Couldn't load LLM services"
				message={formatApiError(list.error)}
			/>
		);
	}

	const services = list.data ?? [];

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
				<div>
					<CardTitle className="flex items-center gap-2">
						<Cpu className="h-5 w-5 text-slate-500" />
						LLM services
					</CardTitle>
					<p className="text-xs text-slate-500 mt-1">
						Workspace-scoped chat-completion model definitions. Agents
						optionally bind to one via <code>agent.llmServiceId</code>; unbound
						agents fall back to the runtime's global <code>chat:</code> block.
					</p>
				</div>
				<Button onClick={() => setCreating(true)}>
					<Plus className="h-4 w-4" />
					New service
				</Button>
			</CardHeader>
			<CardContent>
				{services.length === 0 ? (
					<div className="rounded-md border border-dashed border-slate-300 p-6 text-center">
						<p className="text-sm text-slate-600">
							No LLM services configured yet.
						</p>
						<p className="text-xs text-slate-500 mt-1">
							The runtime's global <code>chat:</code> block (when present) is
							used by agents that don't bind to a service explicitly.
						</p>
					</div>
				) : (
					<ul className="divide-y divide-slate-100">
						{services.map((svc) => (
							<li
								key={svc.llmServiceId}
								className="flex items-start justify-between gap-3 py-3"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<p className="text-sm font-semibold truncate">{svc.name}</p>
										<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
											{svc.provider}
										</span>
									</div>
									<p className="mt-1 text-xs text-slate-500 truncate">
										{svc.modelName}
									</p>
									{svc.description ? (
										<p className="mt-1 line-clamp-2 text-xs text-slate-500">
											{svc.description}
										</p>
									) : null}
									<p className="mt-1 text-[11px] text-slate-400">
										Updated {formatDate(svc.updatedAt)}
									</p>
								</div>
								<div className="flex shrink-0 gap-1">
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setEditing(svc)}
										title="Edit LLM service"
									>
										<Pencil className="h-4 w-4" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setDeleting(svc)}
										title="Delete LLM service"
									>
										<Trash2 className="h-4 w-4 text-red-600" />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</CardContent>

			<CreateDialog
				workspace={workspace}
				open={creating}
				onOpenChange={setCreating}
			/>
			<EditDialog
				workspace={workspace}
				service={editing}
				onClose={() => setEditing(null)}
			/>
			<DeleteConfirm
				workspace={workspace}
				service={deleting}
				onClose={() => setDeleting(null)}
			/>
		</Card>
	);
}

function CreateDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (v: boolean) => void;
}) {
	const create = useCreateLlmService(workspace);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>New LLM service</DialogTitle>
					<DialogDescription>
						Define a chat-completion model that agents in this workspace can
						bind to via <code>agent.llmServiceId</code>.
					</DialogDescription>
				</DialogHeader>
				<LlmServiceForm
					mode="create"
					submitting={create.isPending}
					onSubmit={async (values) => {
						try {
							await create.mutateAsync(values as CreateLlmServiceInput);
							toast.success("LLM service created");
							onOpenChange(false);
						} catch (err) {
							toast.error("Couldn't create service", {
								description: formatApiError(err),
							});
						}
					}}
					onCancel={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function EditDialog({
	workspace,
	service,
	onClose,
}: {
	workspace: string;
	service: LlmServiceRecord | null;
	onClose: () => void;
}) {
	const update = useUpdateLlmService(
		workspace,
		service?.llmServiceId ?? "__missing__",
	);
	if (!service) return null;
	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Edit LLM service</DialogTitle>
					<DialogDescription>{service.name}</DialogDescription>
				</DialogHeader>
				<LlmServiceForm
					mode="edit"
					service={service}
					submitting={update.isPending}
					onSubmit={async (values) => {
						try {
							await update.mutateAsync(values as UpdateLlmServiceInput);
							toast.success("LLM service updated");
							onClose();
						} catch (err) {
							toast.error("Couldn't save changes", {
								description: formatApiError(err),
							});
						}
					}}
					onCancel={onClose}
				/>
			</DialogContent>
		</Dialog>
	);
}

function DeleteConfirm({
	workspace,
	service,
	onClose,
}: {
	workspace: string;
	service: LlmServiceRecord | null;
	onClose: () => void;
}) {
	const del = useDeleteLlmService(workspace);
	if (!service) return null;
	return (
		<Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete LLM service?</DialogTitle>
					<DialogDescription>
						<strong>{service.name}</strong> will be removed from this workspace.
						Agents that bind to it via <code>agent.llmServiceId</code> block
						deletion with a 409 — unbind those agents first if you hit a
						conflict.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose} disabled={del.isPending}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={del.isPending}
						onClick={async () => {
							try {
								await del.mutateAsync(service.llmServiceId);
								toast.success("LLM service deleted");
								onClose();
							} catch (err) {
								toast.error("Couldn't delete service", {
									description: formatApiError(err),
								});
							}
						}}
					>
						{del.isPending ? "Deleting…" : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
