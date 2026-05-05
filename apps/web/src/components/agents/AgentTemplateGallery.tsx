import { Bot, Check, Loader2, Plus, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import {
	useAgentTemplates,
	useCreateAgentFromTemplate,
} from "@/hooks/useConversations";
import { formatApiError } from "@/lib/api";
import type { AgentRecord, AgentTemplate } from "@/lib/schemas";
import { cn } from "@/lib/utils";

interface AgentTemplateGalleryProps {
	readonly workspaceId: string;
	/**
	 * Agents already in the workspace. Templates whose `name` collides
	 * with an existing agent's name render an "Already added" badge
	 * and have their Add button disabled. This is a soft check —
	 * collision means *probably* this template already runs in the
	 * workspace, not a hard guarantee, since users are free to rename
	 * agents after instantiation.
	 */
	readonly existingAgents?: ReadonlyArray<Pick<AgentRecord, "name">>;
	/**
	 * Fired after a successful instantiation so the parent can switch
	 * to the new agent (chat zero-state) or refresh its list. Defaults
	 * to a no-op.
	 */
	readonly onAdded?: (agent: AgentRecord) => void;
	/**
	 * Hide the "Recommended" badge for default-on templates. Useful
	 * when the gallery runs alongside a separate "we already added
	 * these" callout (the onboarding step) where the badge becomes
	 * redundant noise.
	 */
	readonly hideRecommendedBadge?: boolean;
	readonly className?: string;
}

/**
 * Shared gallery of agent templates from the runtime catalog (ADR
 * 0003). Renders a grid of cards; each card has a one-click Add
 * button that POSTs `from-template` and toasts on success/failure.
 *
 * Used in three places — the onboarding "extras" step, the workspace
 * agents-page header, and the chat zero-state — so the visual + UX
 * treatment of templates stays consistent across the product.
 */
export function AgentTemplateGallery({
	workspaceId,
	existingAgents,
	onAdded,
	hideRecommendedBadge,
	className,
}: AgentTemplateGalleryProps) {
	const templatesQuery = useAgentTemplates(workspaceId);
	const create = useCreateAgentFromTemplate(workspaceId);

	// Track which templateId is currently being instantiated so each
	// card shows its own loading state. Using a single mutation across
	// cards keeps the React Query cache invariants simple — one
	// mutation = one in-flight call — at the cost of disabling the
	// other cards while one is in flight, which matches the slow,
	// sequential nature of agent creation.
	const [pendingId, setPendingId] = useState<string | null>(null);

	const existingNames = useMemo(
		() =>
			new Set((existingAgents ?? []).map((a) => a.name.trim().toLowerCase())),
		[existingAgents],
	);

	if (templatesQuery.isLoading) {
		return <LoadingState label="Loading templates…" />;
	}
	// We don't render an explicit error state — if the catalog request
	// fails the parent surface (onboarding / agents page / chat) keeps
	// working without the gallery. Surface the failure as a toast so
	// the user knows, but don't block the rest of the page.
	if (templatesQuery.isError) {
		return (
			<p className="text-sm text-slate-500">
				Couldn't load templates: {formatApiError(templatesQuery.error)}
			</p>
		);
	}
	const templates = templatesQuery.data ?? [];
	if (templates.length === 0) {
		return null;
	}

	const handleAdd = async (template: AgentTemplate) => {
		setPendingId(template.templateId);
		try {
			const agent = await create.mutateAsync(template.templateId);
			toast.success(`'${agent.name}' added`);
			onAdded?.(agent);
		} catch (err) {
			toast.error("Couldn't add template", {
				description: formatApiError(err),
			});
		} finally {
			setPendingId(null);
		}
	};

	return (
		<div
			className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}
			data-testid="agent-template-gallery"
		>
			{templates.map((template) => (
				<TemplateCard
					key={template.templateId}
					template={template}
					alreadyAdded={existingNames.has(template.name.trim().toLowerCase())}
					pending={pendingId === template.templateId}
					anyPending={pendingId !== null}
					hideRecommendedBadge={hideRecommendedBadge}
					onAdd={() => handleAdd(template)}
				/>
			))}
		</div>
	);
}

interface TemplateCardProps {
	readonly template: AgentTemplate;
	readonly alreadyAdded: boolean;
	readonly pending: boolean;
	readonly anyPending: boolean;
	readonly hideRecommendedBadge: boolean | undefined;
	readonly onAdd: () => void;
}

function TemplateCard({
	template,
	alreadyAdded,
	pending,
	anyPending,
	hideRecommendedBadge,
	onAdd,
}: TemplateCardProps) {
	const disabled = alreadyAdded || anyPending;
	return (
		<div
			className={cn(
				"flex flex-col gap-3 rounded-xl border bg-white p-4 transition-shadow",
				alreadyAdded
					? "border-slate-200 opacity-75"
					: "border-slate-200 hover:shadow-sm",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex items-center gap-2 min-w-0">
					<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
						<Bot className="h-4 w-4" aria-hidden="true" />
					</span>
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold text-slate-900">
							{template.name}
						</p>
						<p className="truncate text-xs text-slate-500">
							{template.description}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{alreadyAdded ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
							<Check className="h-3 w-3" aria-hidden="true" />
							Added
						</span>
					) : template.defaultOnNewWorkspace && !hideRecommendedBadge ? (
						<span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-brand-700)]">
							<Sparkles className="h-3 w-3" aria-hidden="true" />
							Recommended
						</span>
					) : null}
				</div>
			</div>
			<p className="text-xs text-slate-600 leading-relaxed">
				{template.persona}
			</p>
			<div className="flex justify-end">
				<Button
					type="button"
					variant={alreadyAdded ? "ghost" : "secondary"}
					size="sm"
					disabled={disabled}
					onClick={onAdd}
					aria-label={`Add ${template.name}`}
				>
					{pending ? (
						<>
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
							Adding…
						</>
					) : alreadyAdded ? (
						<>
							<Check className="h-4 w-4" aria-hidden="true" />
							In workspace
						</>
					) : (
						<>
							<Plus className="h-4 w-4" aria-hidden="true" />
							Add
						</>
					)}
				</Button>
			</div>
		</div>
	);
}
