import {
	Box,
	ChevronDown,
	ChevronRight,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { PRESET_NONE } from "@/hooks/useServicePresetState";
import { CUSTOM_OPTION } from "@/lib/service-catalog";

/**
 * Shared shells for the three execution-service subpanels (embedding,
 * chunking, reranking). Each subpanel composes a {@link ServiceCard}
 * that wraps its list/error/loading/empty states, plus
 * {@link PresetPicker}, {@link SelectWithCustom}, {@link ServiceRow},
 * and {@link Field} for the create-form bodies.
 */

interface PresetOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

export function PresetPicker({
	id,
	help,
	value,
	onChange,
	options,
}: {
	id: string;
	help?: string;
	value: string;
	onChange: (v: string) => void;
	options: readonly PresetOption[];
}) {
	const selected = options.find((o) => o.value === value);
	return (
		<div className="flex flex-col gap-1.5">
			<FieldLabel htmlFor={id} help={help}>
				Preset
			</FieldLabel>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger id={id}>
					<SelectValue placeholder="Pick a preset (or fill in below)" />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={PRESET_NONE}>None — custom</SelectItem>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{selected?.description ? (
				<p className="text-xs text-slate-500">{selected.description}</p>
			) : null}
		</div>
	);
}

interface SelectOption {
	readonly value: string;
	readonly label: string;
}

export function SelectWithCustom({
	label,
	help,
	id,
	value,
	custom,
	onChange,
	onCustomChange,
	options,
	customPlaceholder,
	disabled,
}: {
	label: string;
	help?: string;
	id: string;
	value: string;
	custom: boolean;
	onChange: (v: string) => void;
	onCustomChange: (v: string) => void;
	options: readonly SelectOption[];
	customPlaceholder?: string;
	disabled?: boolean;
}) {
	// Force the Select to display "Other…" when in custom mode by
	// using CUSTOM_OPTION as the controlled value. The text input
	// underneath drives the actual draft state. Parent components
	// already clear the dependent value when the parent option changes
	// (e.g. setProvider clears modelName) so we don't need a sync
	// effect here.
	const selectValue = custom
		? CUSTOM_OPTION
		: options.some((o) => o.value === value)
			? value
			: "";
	return (
		<div className="flex flex-col gap-1.5">
			<FieldLabel htmlFor={id} help={help}>
				{label}
			</FieldLabel>
			<Select
				value={selectValue}
				onValueChange={onChange}
				disabled={disabled || (options.length === 0 && !custom)}
			>
				<SelectTrigger id={id}>
					<SelectValue placeholder={`Pick a ${label.toLowerCase()}`} />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
					<SelectItem value={CUSTOM_OPTION}>Other…</SelectItem>
				</SelectContent>
			</Select>
			{custom ? (
				<Input
					id={`${id}-custom`}
					value={value}
					onChange={(e) => onCustomChange(e.target.value)}
					placeholder={customPlaceholder}
				/>
			) : null}
		</div>
	);
}

export interface ServiceCardProps<T> {
	label: string;
	countLabel: string;
	rows: readonly T[] | undefined;
	loading: boolean;
	error: string | null;
	onRetry: () => void;
	expanded: boolean;
	onToggle: () => void;
	onCreate: () => void;
	renderRow: (row: T) => React.ReactNode;
	children: React.ReactNode;
}

export function ServiceCard<T>(props: ServiceCardProps<T>) {
	const rows = props.rows ?? [];
	return (
		<div className="rounded-lg border border-slate-200 bg-white">
			<div className="flex items-center gap-3 p-3">
				<button
					type="button"
					onClick={props.onToggle}
					className="flex flex-1 items-center gap-2 text-left"
					aria-expanded={props.expanded}
				>
					{props.expanded ? (
						<ChevronDown className="h-4 w-4 text-slate-400" />
					) : (
						<ChevronRight className="h-4 w-4 text-slate-400" />
					)}
					<Box className="h-4 w-4 text-slate-400" aria-hidden />
					<span className="font-medium text-slate-900">{props.label}</span>
					<span className="text-xs text-slate-500">
						{rows.length} {props.countLabel}
						{rows.length === 1 ? "" : "s"}
					</span>
				</button>
				<Button variant="secondary" size="sm" onClick={props.onCreate}>
					<Plus className="h-4 w-4" /> New
				</Button>
			</div>
			{props.expanded ? (
				<div className="border-t border-slate-100 bg-slate-50/50 p-3 flex flex-col gap-2">
					{props.loading ? (
						<LoadingState label={`Loading ${props.label.toLowerCase()}…`} />
					) : props.error ? (
						<ErrorState
							title="Couldn't load"
							message={props.error}
							actions={
								<Button variant="secondary" onClick={props.onRetry}>
									<RefreshCw className="h-4 w-4" /> Retry
								</Button>
							}
						/>
					) : rows.length === 0 ? (
						<p className="text-xs text-slate-500">
							None yet. Click <span className="font-medium">New</span> to add
							one.
						</p>
					) : (
						rows.map((row) => props.renderRow(row))
					)}
				</div>
			) : null}
			{props.children}
		</div>
	);
}

export function ServiceRow({
	title,
	subtitle,
	status,
	onDelete,
}: {
	title: string;
	subtitle: string;
	status: string;
	onDelete: () => void;
}) {
	return (
		<div className="flex items-center gap-2 rounded-md bg-white border border-slate-200 px-2 py-1.5 text-sm">
			<span className="font-medium text-slate-900 truncate">{title}</span>
			<span className="text-xs text-slate-500 truncate">{subtitle}</span>
			<span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
				{status}
			</span>
			<Button
				variant="ghost"
				size="sm"
				onClick={onDelete}
				aria-label={`Delete ${title}`}
			>
				<Trash2 className="h-4 w-4 text-red-600" />
			</Button>
		</div>
	);
}

export function Field({
	label,
	help,
	id,
	value,
	onChange,
	placeholder,
	type,
}: {
	label: string;
	help?: string;
	id: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	type?: string;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<FieldLabel htmlFor={id} help={help}>
				{label}
			</FieldLabel>
			<Input
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				type={type}
			/>
		</div>
	);
}
