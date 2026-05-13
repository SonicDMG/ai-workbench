import { useState } from "react";
import { toast } from "sonner";
import { LlmServiceForm } from "@/components/agents/LlmServiceForm";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	ServiceCard,
	ServiceRow,
} from "@/components/workspaces/ServicesPanelHelpers";
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

export interface LlmServicesPanelProps {
	readonly workspace: string;
}

export function LlmServicesPanel({ workspace }: LlmServicesPanelProps) {
	const list = useLlmServices(workspace);
	const [open, setOpen] = useState(false);
	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<LlmServiceRecord | null>(null);
	const [deleting, setDeleting] = useState<LlmServiceRecord | null>(null);

	return (
		<ServiceCard
			label="LLM services"
			countLabel="LLM service"
			rows={list.data}
			loading={list.isLoading}
			error={list.isError ? formatApiError(list.error) : null}
			onRetry={() => list.refetch()}
			expanded={open}
			onToggle={() => setOpen((v) => !v)}
			onCreate={() => setCreating(true)}
			renderRow={(svc: LlmServiceRecord) => (
				<ServiceRow
					key={svc.llmServiceId}
					title={svc.name}
					subtitle={`${svc.provider}:${svc.modelName}`}
					status={svc.status}
					onEdit={() => setEditing(svc)}
					onDelete={() => setDeleting(svc)}
				/>
			)}
		>
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
		</ServiceCard>
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
