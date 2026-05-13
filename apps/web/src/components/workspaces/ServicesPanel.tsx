import { LlmServicesPanel } from "@/components/agents/LlmServicesPanel";
import { ChunkingSubpanel } from "./ChunkingSubpanel";
import { EmbeddingSubpanel } from "./EmbeddingSubpanel";
import { RerankingSubpanel } from "./RerankingSubpanel";

/**
 * Workspace-scoped service panel.
 * LLM, embedding, chunking, and reranking services sit alongside each
 * other because agents and knowledge bases bind to them at create time.
 *
 * Each subpanel is a self-contained list/create/edit/delete unit; shared
 * shells (`ServiceCard`, `ServiceRow`, `PresetPicker`,
 * `SelectWithCustom`, `Field`) live in `ServicesPanelHelpers.tsx`.
 */
export function ServicesPanel({ workspace }: { workspace: string }) {
	return (
		<div
			data-testid="settings-services-grid"
			className="grid grid-cols-1 gap-3 md:grid-cols-2"
		>
			<LlmServicesPanel workspace={workspace} />
			<EmbeddingSubpanel workspace={workspace} />
			<ChunkingSubpanel workspace={workspace} />
			<RerankingSubpanel workspace={workspace} />
		</div>
	);
}
