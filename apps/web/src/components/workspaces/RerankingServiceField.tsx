import { FieldLabel } from "@/components/ui/field-label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { RerankingServiceRecord } from "@/lib/schemas";

// Radix Select can't model an empty-string item value, so "no reranker"
// rides on this sentinel internally. The public `value` / `onChange`
// contract uses `null` for "no reranker" — the sentinel never leaks out
// to callers, which keeps each dialog free to store "none" however its
// own form state prefers.
const NO_RERANKER = "_none_";

const DEFAULT_HELP =
	"Optional second-pass ranking that can reorder retrieved matches after the vector search returns candidates.";

/**
 * The reranking-service picker shared by the create and edit KB dialogs.
 * Renders the labelled `<Select>` with a leading "No reranker" option and
 * one entry per service (showing `provider:modelName`). `null` means no
 * reranker is selected.
 */
export function RerankingServiceField({
	id,
	value,
	onChange,
	services,
	disabled,
	help = DEFAULT_HELP,
}: {
	id: string;
	value: string | null;
	onChange: (rerankingServiceId: string | null) => void;
	services: readonly RerankingServiceRecord[];
	disabled?: boolean;
	help?: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<FieldLabel htmlFor={id} help={help}>
				Reranking service (optional)
			</FieldLabel>
			<Select
				value={value ?? NO_RERANKER}
				onValueChange={(v) => onChange(v === NO_RERANKER ? null : v)}
				disabled={disabled}
			>
				<SelectTrigger id={id}>
					<SelectValue placeholder="No reranker" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={NO_RERANKER}>No reranker</SelectItem>
					{services.map((s) => (
						<SelectItem key={s.rerankingServiceId} value={s.rerankingServiceId}>
							{s.name}
							<span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
								({s.provider}:{s.modelName})
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
