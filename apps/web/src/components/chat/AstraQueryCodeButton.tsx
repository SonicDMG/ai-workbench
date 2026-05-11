/**
 * Chat-specific wrapper around the generic
 * {@link ../astra/AstraCodeChip}. Pulls the snapshot list out of the
 * persisted `message.metadata.astra_queries` blob and forwards it.
 *
 * The chat surface has its own UX shape (one chip per assistant
 * message, multiple snapshots in a row when the agent fanned out
 * across several KBs), so it stays a focused wrapper rather than
 * folding into the generic component's prop surface.
 *
 * Pre-discriminator persisted rows (legacy chat history) lacked the
 * `kind` field and matched the `vector_search` shape; the parser
 * defaults missing `kind` to `"vector_search"` so old conversations
 * keep rendering.
 */

import { useMemo } from "react";
import {
	AstraCodeChip,
	parseAstraSnapshotsBlob,
} from "@/components/astra/AstraCodeChip";
import type { ChatMessage } from "@/lib/schemas";

export function AstraQueryCodeButton({ message }: { message: ChatMessage }) {
	const snapshots = useMemo(
		() => parseAstraSnapshotsBlob(message.metadata.astra_queries),
		[message.metadata.astra_queries],
	);
	return (
		<AstraCodeChip
			snapshots={snapshots}
			triggerTitle="View the Astra Data API query AI Workbench made for this reply"
			dialogTitle="Astra Data API query"
			dialogDescription={
				snapshots.length === 1
					? `The exact call AI Workbench made against ${snapshots[0]?.kbName ?? "this knowledge base"} to ground this reply.`
					: `${snapshots.length} calls AI Workbench made to ground this reply. Switch knowledge bases below.`
			}
			testId="astra-query-code-button"
		/>
	);
}
