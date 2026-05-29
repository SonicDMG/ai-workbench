/**
 * Behaviour tests for EditDocumentDialog. The dialog wraps two distinct
 * flows (metadata patch via PATCH /documents, and file replacement via
 * async ingest with overwriteOnNameConflict); the tests below capture
 * the spies handed to the mocked hooks and assert that user actions —
 * typing, clicking Save, picking a file — call them with the right
 * payload shape. Render-only assertions live here too where the
 * conditional rendering itself is the behavior (dialog open state),
 * but every flow that mutates anything is exercised end-to-end
 * through the form.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RagDocumentRecord } from "@/lib/schemas";

const mocks = vi.hoisted(() => ({
	updateMutate: vi.fn(async (_args: unknown) => undefined),
	ingestMutate: vi.fn(async (_args: unknown) => undefined),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));
const onOpenChange = vi.fn();

vi.mock("@/hooks/useDocuments", () => ({
	useUpdateDocument: () => ({
		mutateAsync: mocks.updateMutate,
		isPending: false,
	}),
}));

vi.mock("@/hooks/useIngest", () => ({
	useAsyncIngestFile: () => ({
		mutateAsync: mocks.ingestMutate,
		isPending: false,
	}),
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
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
	mocks.updateMutate.mockClear();
	mocks.updateMutate.mockResolvedValue(undefined);
	mocks.ingestMutate.mockClear();
	mocks.ingestMutate.mockResolvedValue(undefined);
	mocks.toastSuccess.mockClear();
	mocks.toastError.mockClear();
	onOpenChange.mockClear();
});

describe("EditDocumentDialog", () => {
	it("renders nothing visible when doc is null (dialog closed)", () => {
		const { container } = render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={null}
				onOpenChange={onOpenChange}
			/>,
		);
		expect(container.querySelector("[role='dialog']")).toBeNull();
	});

	it("seeds the rename input from the doc and keeps Save disabled until the name changes", () => {
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({ sourceFilename: "spec.md" })}
				onOpenChange={onOpenChange}
			/>,
		);
		const input = screen.getByPlaceholderText(
			"document.md",
		) as HTMLInputElement;
		expect(input.value).toBe("spec.md");
		expect(screen.getByRole("button", { name: /Save changes/ })).toBeDisabled();
	});

	it("enables Save and PATCHes the new filename when the user renames a document", async () => {
		const user = userEvent.setup();
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({ sourceFilename: "spec.md" })}
				onOpenChange={onOpenChange}
			/>,
		);
		const input = screen.getByPlaceholderText("document.md");
		await user.clear(input);
		await user.type(input, "renamed.md");

		const save = screen.getByRole("button", { name: /Save changes/ });
		expect(save).toBeEnabled();
		await user.click(save);

		expect(mocks.updateMutate).toHaveBeenCalledTimes(1);
		expect(mocks.updateMutate).toHaveBeenCalledWith({
			documentId: "00000000-0000-4000-8000-000000000003",
			patch: { sourceFilename: "renamed.md" },
		});
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Document updated");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("surfaces an error toast and keeps the dialog open when the update fails", async () => {
		const user = userEvent.setup();
		mocks.updateMutate.mockRejectedValueOnce(new Error("nope"));
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({ sourceFilename: "spec.md" })}
				onOpenChange={onOpenChange}
			/>,
		);
		const input = screen.getByPlaceholderText("document.md");
		await user.clear(input);
		await user.type(input, "renamed.md");
		await user.click(screen.getByRole("button", { name: /Save changes/ }));

		expect(mocks.updateMutate).toHaveBeenCalledTimes(1);
		expect(mocks.toastSuccess).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledTimes(1);
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("triggers async ingest with overwriteOnNameConflict when the user picks a replacement file", async () => {
		const user = userEvent.setup();
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc({ sourceFilename: "spec.md" })}
				onOpenChange={onOpenChange}
			/>,
		);
		// Dialog content lives in a Radix Portal, so the hidden file
		// input is attached under document.body — not the render()
		// container. Find it from the document root.
		const fileInput = document.body.querySelector("input[type='file']");
		if (!(fileInput instanceof HTMLInputElement)) {
			throw new Error("expected hidden file input under document.body");
		}

		const file = new File(["hello"], "fresh.md", { type: "text/markdown" });
		await user.upload(fileInput, file);

		expect(mocks.ingestMutate).toHaveBeenCalledTimes(1);
		const call = mocks.ingestMutate.mock.calls[0]?.[0] as {
			file: File;
			filename: string;
			overwriteOnNameConflict: boolean;
		};
		expect(call.file.name).toBe("fresh.md");
		expect(call.filename).toBe("spec.md"); // current staged name wins
		expect(call.overwriteOnNameConflict).toBe(true);
		expect(mocks.toastSuccess).toHaveBeenCalledWith("Document replaced");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("rejects unsupported file types inline without calling ingest", async () => {
		const user = userEvent.setup();
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc()}
				onOpenChange={onOpenChange}
			/>,
		);
		const fileInput = document.body.querySelector("input[type='file']");
		if (!(fileInput instanceof HTMLInputElement)) {
			throw new Error("expected hidden file input under document.body");
		}
		const bogus = new File(["x"], "weird.xyz", {
			type: "application/x-not-real",
		});
		await user.upload(fileInput, bogus);

		expect(mocks.ingestMutate).not.toHaveBeenCalled();
		expect(screen.getByText(/not a supported type/i)).toBeInTheDocument();
	});

	it("closes the dialog when the footer Close button is clicked", async () => {
		const user = userEvent.setup();
		render(
			<EditDocumentDialog
				workspace="ws-1"
				knowledgeBaseId="kb-1"
				doc={makeDoc()}
				onOpenChange={onOpenChange}
			/>,
		);
		// The Dialog primitive renders its own aria-label="Close" X
		// button in the corner; the footer button has the literal text
		// "Close" instead. Pick the latter by visible text so we
		// exercise the explicit affordance, not the chrome.
		const footerClose = screen
			.getAllByRole("button", { name: /Close/ })
			.find((b) => b.textContent?.trim() === "Close");
		if (!footerClose) {
			throw new Error("expected a footer button with visible text 'Close'");
		}
		await user.click(footerClose);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
