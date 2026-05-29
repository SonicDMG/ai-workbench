import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/common/states";
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
	useCreateMcpServer,
	useDeleteMcpServer,
	useMcpServers,
	useUpdateMcpServer,
} from "@/hooks/useMcpServers";
import { formatApiError } from "@/lib/api";
import {
	CreateMcpServerInputSchema,
	type McpServerRecord,
	UpdateMcpServerInputSchema,
} from "@/lib/schemas";

/**
 * Workspace-scoped external-MCP-server registry (0.4.0 A6).
 *
 * Lists the remote MCP servers the workspace's agents can reach over
 * Streamable HTTP and lets the operator add / edit / delete them. Each
 * enabled server's tools are discovered at turn time and exposed to
 * agents as `mcp:{mcpServerId}:{tool}` (opt-in via the agent's tool
 * allow-list). Modeled on the PrincipalsPanel CRUD shape.
 *
 * Registering a server is workspace *content* (gated to `write`, not the
 * admin `manage` scope), so this panel sits alongside Services rather
 * than behind the admin-only gate.
 */
export function McpServersPanel({ workspace }: { workspace: string }) {
	const servers = useMcpServers(workspace);
	const [createOpen, setCreateOpen] = useState(false);
	const [toEdit, setToEdit] = useState<McpServerRecord | null>(null);
	const [toDelete, setToDelete] = useState<McpServerRecord | null>(null);

	if (servers.isLoading) return <LoadingState label="Loading MCP servers…" />;
	if (servers.isError)
		return (
			<ErrorState
				title="Couldn't load MCP servers"
				message={formatApiError(servers.error)}
			/>
		);

	const rows = [...(servers.data ?? [])];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-end">
				<Button variant="brand" onClick={() => setCreateOpen(true)}>
					<Plus className="h-4 w-4" />
					Add MCP server
				</Button>
			</div>

			{rows.length === 0 ? (
				<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
					No external MCP servers registered. Add one to let this workspace's
					agents call its tools (opt-in per agent via the tool picker).
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="border-slate-200 border-b text-xs text-slate-500 uppercase tracking-wide dark:border-slate-700 dark:text-slate-400">
							<tr>
								<th className="pb-2 pr-3">Label</th>
								<th className="pb-2 pr-3">URL</th>
								<th className="pb-2 pr-3">Tools</th>
								<th className="pb-2 pr-3">Status</th>
								<th className="pb-2 text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((s) => (
								<tr
									key={s.mcpServerId}
									className="border-slate-200 border-b last:border-b-0 dark:border-slate-800"
								>
									<td className="py-2 pr-3 font-medium text-slate-700 dark:text-slate-200">
										{s.label}
									</td>
									<td className="py-2 pr-3 font-mono text-xs text-slate-600 dark:text-slate-400">
										<span className="block max-w-[18rem] truncate">
											{s.url}
										</span>
									</td>
									<td className="py-2 pr-3 text-xs text-slate-600 dark:text-slate-400">
										{s.allowedTools === null ? (
											<span className="italic">all advertised</span>
										) : s.allowedTools.length === 0 ? (
											<span className="italic">none</span>
										) : (
											`${s.allowedTools.length} allow-listed`
										)}
									</td>
									<td className="py-2 pr-3">
										<span
											className={
												s.enabled
													? "inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
													: "inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300"
											}
										>
											{s.enabled ? "Enabled" : "Disabled"}
										</span>
									</td>
									<td className="py-2 text-right">
										<div className="flex items-center justify-end gap-1">
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Edit ${s.label}`}
												onClick={() => setToEdit(s)}
												className="text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
											>
												<Pencil className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Delete ${s.label}`}
												onClick={() => setToDelete(s)}
											>
												<Trash2 className="h-4 w-4 text-red-600" />
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<CreateMcpServerDialog
				workspace={workspace}
				open={createOpen}
				onOpenChange={setCreateOpen}
			/>
			<EditMcpServerDialog
				workspace={workspace}
				server={toEdit}
				onClose={() => setToEdit(null)}
			/>
			<DeleteMcpServerDialog
				workspace={workspace}
				server={toDelete}
				onClose={() => setToDelete(null)}
			/>
		</div>
	);
}

/** Parse the comma/newline-separated allow-list textarea into the wire shape. */
function parseAllowedTools(text: string): string[] | null {
	const trimmed = text.trim();
	if (trimmed.length === 0) return null; // empty → expose every advertised tool
	const items = trimmed
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return items;
}

function serializeAllowedTools(allowedTools: readonly string[] | null): string {
	return allowedTools === null ? "" : allowedTools.join("\n");
}

function FieldRow({
	htmlFor,
	label,
	children,
	hint,
}: {
	htmlFor: string;
	label: string;
	children: React.ReactNode;
	hint?: React.ReactNode;
}) {
	// Explicit `htmlFor`/`id` association (rather than label-wraps-input)
	// because the control is passed in as `children` — a wrapping label
	// wouldn't statically associate, and `getByLabelText` needs the link.
	return (
		<div className="space-y-1 text-sm">
			<label htmlFor={htmlFor} className="font-medium">
				{label}
			</label>
			{children}
			{hint ? (
				<span className="block text-slate-500 text-xs">{hint}</span>
			) : null}
		</div>
	);
}

const TEXT_INPUT_CLASS =
	"w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900";

function CreateMcpServerDialog({
	workspace,
	open,
	onOpenChange,
}: {
	workspace: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const create = useCreateMcpServer(workspace);
	const [label, setLabel] = useState("");
	const [url, setUrl] = useState("");
	const [credentialRef, setCredentialRef] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [allowedToolsText, setAllowedToolsText] = useState("");

	function reset() {
		setLabel("");
		setUrl("");
		setCredentialRef("");
		setEnabled(true);
		setAllowedToolsText("");
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		const candidate = {
			label: label.trim(),
			url: url.trim(),
			credentialRef: credentialRef.trim() || null,
			enabled,
			allowedTools: parseAllowedTools(allowedToolsText),
		};
		const parsed = CreateMcpServerInputSchema.safeParse(candidate);
		if (!parsed.success) {
			toast.error(
				`Invalid MCP server: ${parsed.error.issues[0]?.message ?? "check the fields"}`,
			);
			return;
		}
		try {
			await create.mutateAsync(parsed.data);
			toast.success(`Registered MCP server '${candidate.label}'`);
			reset();
			onOpenChange(false);
		} catch (err) {
			toast.error(`Couldn't register MCP server: ${formatApiError(err)}`);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Add MCP server</DialogTitle>
					<DialogDescription>
						Register a remote MCP server. Its tools are discovered at turn time
						and become available to agents that opt in via their tool
						allow-list.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-3">
					<FieldRow htmlFor="mcp-create-label" label="Label">
						<input
							id="mcp-create-label"
							required
							autoFocus
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="Docs MCP"
							className={TEXT_INPUT_CLASS}
						/>
					</FieldRow>
					<FieldRow
						htmlFor="mcp-create-url"
						label="URL"
						hint="Streamable HTTP endpoint, e.g. https://mcp.example.com/mcp. http(s) only — private/loopback hosts are blocked."
					>
						<input
							id="mcp-create-url"
							required
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://mcp.example.com/mcp"
							className={`${TEXT_INPUT_CLASS} font-mono`}
						/>
					</FieldRow>
					<FieldRow
						htmlFor="mcp-create-cred"
						label="Credential ref (optional)"
						hint={
							<>
								A secret ref like <code>env:DOCS_MCP_TOKEN</code> — never the
								token itself. Sent as a bearer token when dialing the server.
							</>
						}
					>
						<input
							id="mcp-create-cred"
							value={credentialRef}
							onChange={(e) => setCredentialRef(e.target.value)}
							placeholder="env:DOCS_MCP_TOKEN"
							className={`${TEXT_INPUT_CLASS} font-mono`}
						/>
					</FieldRow>
					<FieldRow
						htmlFor="mcp-create-tools"
						label="Allowed tools (optional)"
						hint="One tool name per line. Leave empty to expose every tool the server advertises."
					>
						<textarea
							id="mcp-create-tools"
							value={allowedToolsText}
							onChange={(e) => setAllowedToolsText(e.target.value)}
							placeholder={"search\nfetch"}
							rows={3}
							className={`${TEXT_INPUT_CLASS} font-mono text-xs`}
						/>
					</FieldRow>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={enabled}
							onChange={(e) => setEnabled(e.target.checked)}
							className="h-4 w-4"
						/>
						<span className="font-medium">Enabled</span>
					</label>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="brand"
							disabled={
								create.isPending ||
								label.trim().length === 0 ||
								url.trim().length === 0
							}
						>
							{create.isPending ? "Registering…" : "Register"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function EditMcpServerDialog({
	workspace,
	server,
	onClose,
}: {
	workspace: string;
	server: McpServerRecord | null;
	onClose: () => void;
}) {
	const update = useUpdateMcpServer(workspace, server?.mcpServerId ?? "");
	const open = server !== null;

	const [label, setLabel] = useState("");
	const [url, setUrl] = useState("");
	const [credentialRef, setCredentialRef] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [allowedToolsText, setAllowedToolsText] = useState("");

	const sid = server?.mcpServerId;
	const sLabel = server?.label;
	const sUrl = server?.url;
	const sCred = server?.credentialRef;
	const sEnabled = server?.enabled;
	const sAllowed = server?.allowedTools;

	// Re-seed local form state whenever the parent flips between servers.
	useEffect(() => {
		if (sid === undefined) return;
		setLabel(sLabel ?? "");
		setUrl(sUrl ?? "");
		setCredentialRef(sCred ?? "");
		setEnabled(sEnabled ?? true);
		setAllowedToolsText(serializeAllowedTools(sAllowed ?? null));
	}, [sid, sLabel, sUrl, sCred, sEnabled, sAllowed]);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!server) return;
		const candidate = {
			label: label.trim(),
			url: url.trim(),
			credentialRef: credentialRef.trim() || null,
			enabled,
			allowedTools: parseAllowedTools(allowedToolsText),
		};
		const parsed = UpdateMcpServerInputSchema.safeParse(candidate);
		if (!parsed.success) {
			toast.error(
				`Invalid MCP server: ${parsed.error.issues[0]?.message ?? "check the fields"}`,
			);
			return;
		}
		try {
			await update.mutateAsync(parsed.data);
			toast.success(`Updated MCP server '${server.label}'`);
			onClose();
		} catch (err) {
			toast.error(`Couldn't update MCP server: ${formatApiError(err)}`);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Edit MCP server</DialogTitle>
					<DialogDescription>{server?.label}</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} className="space-y-3">
					<FieldRow htmlFor="mcp-edit-label" label="Label">
						<input
							id="mcp-edit-label"
							required
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							className={TEXT_INPUT_CLASS}
						/>
					</FieldRow>
					<FieldRow htmlFor="mcp-edit-url" label="URL">
						<input
							id="mcp-edit-url"
							required
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							className={`${TEXT_INPUT_CLASS} font-mono`}
						/>
					</FieldRow>
					<FieldRow
						htmlFor="mcp-edit-cred"
						label="Credential ref (optional)"
						hint={
							<>
								A secret ref like <code>env:DOCS_MCP_TOKEN</code> — never the
								token itself.
							</>
						}
					>
						<input
							id="mcp-edit-cred"
							value={credentialRef}
							onChange={(e) => setCredentialRef(e.target.value)}
							placeholder="env:DOCS_MCP_TOKEN"
							className={`${TEXT_INPUT_CLASS} font-mono`}
						/>
					</FieldRow>
					<FieldRow
						htmlFor="mcp-edit-tools"
						label="Allowed tools (optional)"
						hint="One tool name per line. Leave empty to expose every advertised tool."
					>
						<textarea
							id="mcp-edit-tools"
							value={allowedToolsText}
							onChange={(e) => setAllowedToolsText(e.target.value)}
							rows={3}
							className={`${TEXT_INPUT_CLASS} font-mono text-xs`}
						/>
					</FieldRow>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={enabled}
							onChange={(e) => setEnabled(e.target.checked)}
							className="h-4 w-4"
						/>
						<span className="font-medium">Enabled</span>
					</label>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" variant="brand" disabled={update.isPending}>
							{update.isPending ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function DeleteMcpServerDialog({
	workspace,
	server,
	onClose,
}: {
	workspace: string;
	server: McpServerRecord | null;
	onClose: () => void;
}) {
	const del = useDeleteMcpServer(workspace);
	const open = server !== null;

	async function confirm() {
		if (!server) return;
		try {
			await del.mutateAsync(server.mcpServerId);
			toast.success(`Deleted MCP server '${server.label}'`);
			onClose();
		} catch (err) {
			toast.error(`Couldn't delete MCP server: ${formatApiError(err)}`);
		}
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						Delete <code>{server?.label}</code>?
					</DialogTitle>
					<DialogDescription>
						Agents that listed this server's tools in their allow-list will stop
						seeing them on the next turn. This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={confirm}
						disabled={del.isPending}
					>
						{del.isPending ? "Deleting…" : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
