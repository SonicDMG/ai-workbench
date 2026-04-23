import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Lightweight key/value editor for the `credentialsRef` map.
 * Values must be SecretRef strings (`env:VAR` or `file:/path`); this
 * component does soft validation inline. The API layer prunes empty
 * rows before the PUT/POST.
 */
export function CredentialsEditor({
	value,
	onChange,
	disabled,
}: {
	value: Record<string, string>;
	onChange: (next: Record<string, string>) => void;
	disabled?: boolean;
}) {
	const initialRows =
		Object.keys(value).length === 0
			? [{ key: "", val: "" }]
			: Object.entries(value).map(([key, val]) => ({ key, val }));
	const [rows, setRows] = useState(initialRows);

	function emit(next: typeof rows) {
		setRows(next);
		const out: Record<string, string> = {};
		for (const r of next) {
			if (r.key.trim() && r.val.trim()) out[r.key.trim()] = r.val.trim();
		}
		onChange(out);
	}

	function updateRow(i: number, key: string, val: string) {
		const next = [...rows];
		next[i] = { key, val };
		emit(next);
	}

	function addRow() {
		emit([...rows, { key: "", val: "" }]);
	}

	function removeRow(i: number) {
		const next = rows.filter((_, idx) => idx !== i);
		emit(next.length === 0 ? [{ key: "", val: "" }] : next);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-baseline justify-between">
				<Label>Credentials</Label>
				<p className="text-xs text-slate-500">
					Values must be <code className="font-mono">provider:path</code> — e.g.{" "}
					<code className="font-mono">env:ASTRA_TOKEN</code>
				</p>
			</div>
			<div className="flex flex-col gap-2">
				{rows.map((row, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: rows are intentionally unkeyed user input
						key={i}
						className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-2"
					>
						<Input
							placeholder="token"
							value={row.key}
							disabled={disabled}
							onChange={(e) => updateRow(i, e.target.value, row.val)}
						/>
						<Input
							placeholder="env:ASTRA_TOKEN"
							value={row.val}
							disabled={disabled}
							onChange={(e) => updateRow(i, row.key, e.target.value)}
							aria-invalid={
								row.val.length > 0 && !/^[a-z][a-z0-9]*:.+/i.test(row.val)
							}
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={() => removeRow(i)}
							disabled={disabled}
							aria-label={`Remove credential ${row.key || i + 1}`}
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				))}
			</div>
			<div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={addRow}
					disabled={disabled}
				>
					<Plus className="h-4 w-4" />
					Add credential
				</Button>
			</div>
		</div>
	);
}
