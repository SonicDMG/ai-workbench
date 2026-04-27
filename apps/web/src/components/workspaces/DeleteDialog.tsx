import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Two-step delete confirm: user must type the workspace name to arm
 * the destructive button. Keeps accidental clicks from nuking prod.
 */
export function DeleteDialog({
	open,
	onOpenChange,
	workspaceName,
	submitting,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	workspaceName: string;
	submitting?: boolean;
	onConfirm: () => void;
}) {
	const [typed, setTyped] = useState("");
	const armed = typed === workspaceName;

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				onOpenChange(o);
				if (!o) setTyped("");
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete this workspace?</DialogTitle>
					<DialogDescription>
						This cascades. All knowledge bases, services, filters, and documents
						under this workspace will be deleted. This can't be undone.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="confirm-name">
						Type <span className="font-mono text-red-600">{workspaceName}</span>{" "}
						to confirm
					</Label>
					<Input
						id="confirm-name"
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						autoComplete="off"
						placeholder={workspaceName}
					/>
				</div>
				<DialogFooter>
					<Button
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={submitting}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						disabled={!armed || submitting}
						onClick={onConfirm}
					>
						{submitting ? "Deleting…" : "Delete workspace"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
