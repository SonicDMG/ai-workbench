import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "@/lib/schemas";
import { DocumentTable } from "./DocumentTable";

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
	return {
		workspace: "00000000-0000-4000-8000-000000000001",
		catalogUid: "00000000-0000-4000-8000-000000000002",
		documentUid: `doc-${Math.random()}`,
		sourceDocId: null,
		sourceFilename: "default.txt",
		fileType: "text/plain",
		fileSize: 1024,
		md5Hash: null,
		chunkTotal: 4,
		ingestedAt: "2026-04-25T10:00:00.000Z",
		updatedAt: "2026-04-25T10:00:00.000Z",
		status: "ready",
		errorMessage: null,
		metadata: {},
		...overrides,
	};
}

describe("DocumentTable", () => {
	it("renders the empty-state when there are no documents", () => {
		render(<DocumentTable docs={[]} />);
		expect(screen.getByText(/No documents yet/)).toBeInTheDocument();
	});

	it("renders a row per document with the file-type badge and size", () => {
		render(
			<DocumentTable
				docs={[
					makeDoc({ sourceFilename: "alpha.md", fileSize: 2048 }),
					makeDoc({ sourceFilename: "bravo.json", fileSize: 4096 }),
				]}
			/>,
		);
		expect(screen.getByText("alpha.md")).toBeInTheDocument();
		expect(screen.getByText("bravo.json")).toBeInTheDocument();
		expect(screen.getByText("2.0 KB")).toBeInTheDocument();
		expect(screen.getByText("4.0 KB")).toBeInTheDocument();
		// Both file-type badges render with their distinct labels.
		expect(screen.getByText("MD")).toBeInTheDocument();
		expect(screen.getByText("JSON")).toBeInTheDocument();
	});

	it("filters by source filename / source-doc id", async () => {
		const user = userEvent.setup();
		render(
			<DocumentTable
				docs={[
					makeDoc({ sourceFilename: "alpha.md" }),
					makeDoc({ sourceFilename: "bravo.json", sourceDocId: "ext-42" }),
				]}
			/>,
		);

		await user.type(screen.getByLabelText(/Filter documents/), "ext-42");
		expect(screen.queryByText("alpha.md")).not.toBeInTheDocument();
		expect(screen.getByText("bravo.json")).toBeInTheDocument();
	});

	it("toggles sort direction when the active column is clicked again", async () => {
		const user = userEvent.setup();
		render(
			<DocumentTable
				docs={[
					makeDoc({
						sourceFilename: "z.md",
						ingestedAt: "2026-04-25T10:00:00Z",
					}),
					makeDoc({
						sourceFilename: "a.md",
						ingestedAt: "2026-04-25T11:00:00Z",
					}),
				]}
			/>,
		);

		// Default sort: ingestedAt desc — newest first → a.md before z.md.
		const rowsInitial = screen.getAllByRole("row").slice(1); // skip header
		expect(rowsInitial[0]).toHaveTextContent("a.md");

		await user.click(screen.getByRole("button", { name: /Name/ }));
		// First click on Name: asc → a.md first (still).
		const rowsByName = screen.getAllByRole("row").slice(1);
		expect(rowsByName[0]).toHaveTextContent("a.md");

		await user.click(screen.getByRole("button", { name: /Name/ }));
		// Second click on Name: desc → z.md first.
		const rowsByNameDesc = screen.getAllByRole("row").slice(1);
		expect(rowsByNameDesc[0]).toHaveTextContent("z.md");
	});

	it("calls onSelect when a row is clicked", async () => {
		const onSelect = vi.fn();
		const doc = makeDoc({ sourceFilename: "click-me.md" });
		render(<DocumentTable docs={[doc]} onSelect={onSelect} />);
		// Clicking the cell propagates to the row.
		fireEvent.click(screen.getByText("click-me.md"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect.mock.calls[0]?.[0].documentUid).toBe(doc.documentUid);
	});

	it("renders a delete button when onDelete is provided and stops row-click propagation", async () => {
		const onSelect = vi.fn();
		const onDelete = vi.fn();
		const user = userEvent.setup();
		const doc = makeDoc({ sourceFilename: "drop-me.md" });
		render(
			<DocumentTable docs={[doc]} onSelect={onSelect} onDelete={onDelete} />,
		);

		await user.click(
			screen.getByRole("button", { name: /Delete drop-me\.md/ }),
		);
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(onDelete.mock.calls[0]?.[0].documentUid).toBe(doc.documentUid);
		// Row-click handler must NOT fire — destructive actions
		// shouldn't pop the metadata dialog at the same time.
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("disables the delete button for the row whose deletion is in flight", () => {
		const onDelete = vi.fn();
		const doc = makeDoc({ sourceFilename: "wait.md" });
		render(
			<DocumentTable
				docs={[doc]}
				onDelete={onDelete}
				deletingDocumentId={doc.documentUid}
			/>,
		);
		const btn = screen.getByRole("button", { name: /Delete wait\.md/ });
		expect(btn).toBeDisabled();
	});

	it("omits the delete column entirely when onDelete is not provided", () => {
		render(
			<DocumentTable
				docs={[makeDoc({ sourceFilename: "alpha.md" })]}
				onSelect={() => {}}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /Delete alpha\.md/ }),
		).not.toBeInTheDocument();
	});
});
