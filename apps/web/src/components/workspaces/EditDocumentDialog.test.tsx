import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrincipalRecord, RagDocumentRecord } from "@/lib/schemas";

const rlacState: { enabled: boolean } = { enabled: false };

vi.mock("@/hooks/useDocuments", () => ({
	useUpdateDocument: () => ({
		mutateAsync: async () => undefined,
		isPending: false,
	}),
}));

vi.mock("@/hooks/useIngest", () => ({
	useAsyncIngestFile: () => ({
		mutateAsync: async () => undefined,
		isPending: false,
	}),
}));

vi.mock("@/hooks/useRlac", () => ({
	useRlacEnabled: () => rlacState.enabled,
	usePrincipals: () => ({
		data: [] as PrincipalRecord[],
		error: null,
		isLoading: false,
		isError: false,
	}),
}));

vi.mock("@/lib/viewAs", () => ({
	getViewAsPrincipal: () => null,
	subscribeViewAs: (_cb: (next: string | null) => void) => () => undefined,
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

import { EditDocumentDialog } from "./EditDocumentDialog";

function makeDoc(
	overrides: Partial<RagDocumentRecord> = {},
): RagDocumentRecord {
	return {
		workspaceId: "00000000-0000-4000-8000-000000000001",
		knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
		documentId: "00000000-0000-4000-8000-000000000003",
		sourceDocId: null,
		sourceFilename: "spec.md",
		fileType: "text/markdown",
		fileSize: 2048,
		contentHash: "sha256:abc",
		chunkTotal: 3,
		ingestedAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T11:00:00.000Z",
		status: "ready",
		errorMessage: null,
		metadata: {},
		visibleTo: null,
		ownerPrincipalId: null,
		...overrides,
	};
}

beforeEach(() => {
	rlacState.enabled = false;
});

describe("EditDocumentDialog", () => {
	it("renders nothing visible when doc is null (dialog closed)", () => {
		const { container } = render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={null}
				onOpenChange={() => {}}
			/>,
		);
		expect(container.querySelector("[role='dialog']")).toBeNull();
	});

	it("renders the rename input and the Replace + Save controls when a doc is provided", () => {
		rlacState.enabled = false;
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({ sourceFilename: "spec.md" })}
				onOpenChange={() => {}}
			/>,
		);

		// Dialog header copy.
		expect(screen.getByText("Edit document")).toBeInTheDocument();
		expect(screen.getByText("Name")).toBeInTheDocument();

		// Rename input is seeded with the doc's current filename.
		const input = screen.getByPlaceholderText(
			"document.md",
		) as HTMLInputElement;
		expect(input.value).toBe("spec.md");

		// Metadata save and replace controls render. Save is disabled
		// (metadata not dirty); Replace is enabled.
		const save = screen.getByRole("button", { name: /Save changes/ });
		expect(save).toBeDisabled();
		expect(
			screen.getByRole("button", { name: /Replace…/ }),
		).toBeInTheDocument();

		// VisibilityPicker is gated on rlacEnabled — should not render here.
		expect(screen.queryByText("Visible to")).toBeNull();
	});

	it("mounts the VisibilityPicker when rlacEnabled is true", () => {
		rlacState.enabled = true;
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc()}
				onOpenChange={() => {}}
			/>,
		);
		// VisibilityPicker renders the "Visible to" label.
		expect(screen.getByText("Visible to")).toBeInTheDocument();
	});
});
