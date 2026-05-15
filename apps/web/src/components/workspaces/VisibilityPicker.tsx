import { Globe, Lock, Users } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { usePrincipals } from "@/hooks/useRlac";
import { cn } from "@/lib/utils";
import { getViewAsPrincipal, subscribeViewAs } from "@/lib/viewAs";

/**
 * RLAC: three-mode visibility picker bound to the workspace's principal
 * roster.
 *
 * Three exclusive modes drive a single `visibleTo` array:
 *
 *   - **Only You**  — `[currentPrincipal]`. Resolved from the live
 *     "view as" header so the picker reflects whoever the operator
 *     is impersonating at the moment of submission. When no
 *     principal is in flight (e.g. `auth.mode: disabled` with the
 *     picker blank) the Only-You option is disabled and the picker
 *     falls back to Custom.
 *   - **Public**    — `["*"]`. Anyone in the workspace can read.
 *   - **Custom**    — explicit named-principal set, no `"*"`. The
 *     chip strip is only shown in this mode so the radio's intent
 *     stays unambiguous.
 *
 * The picker emits `readonly string[] | null` on change. `null` is
 * only reachable through `hideDefaultOption: false` (the legacy
 * fall-through used by callers that haven't migrated yet); the
 * three explicit modes always produce a concrete array.
 */

type Mode = "only-you" | "public" | "custom";

export function VisibilityPicker({
	workspace,
	value,
	onChange,
	className,
	hideDefaultOption: _hideDefaultOption,
}: {
	readonly workspace: string;
	/** `null` = unset; treated as Only-You for the radio default when
	 * a current principal is resolvable, Custom otherwise. */
	readonly value: readonly string[] | null;
	readonly onChange: (next: readonly string[] | null) => void;
	readonly className?: string;
	/** @deprecated kept for callsite compatibility; no longer changes
	 * behavior under the three-mode picker. */
	readonly hideDefaultOption?: boolean;
}) {
	const principals = usePrincipals(workspace);

	// Track the live "view as" so "Only You" stays accurate as the
	// operator flips the header. Picker subscribes once; updates are
	// rare and cheap.
	const [currentPrincipal, setCurrentPrincipal] = useState<string | null>(() =>
		getViewAsPrincipal(),
	);
	useEffect(() => {
		const unsubscribe = subscribeViewAs((p) => setCurrentPrincipal(p));
		return unsubscribe;
	}, []);

	// "Custom-sticky" intent. Without it, the user clicking the
	// Custom radio while the value is `[currentPrincipal]` would
	// emit `[currentPrincipal]` (Custom defensively pins the current
	// principal), and the next render would re-derive that exact
	// value as "Only You" and snap the radio back. The sticky flag
	// pins the radio on Custom regardless of how the value happens
	// to look, until the user explicitly picks a different mode.
	const [customSticky, setCustomSticky] = useState(false);

	const mode: Mode = useMemo(() => {
		if (Array.isArray(value)) {
			if (value.includes("*")) return "public";
			if (customSticky) return "custom";
			if (
				currentPrincipal !== null &&
				value.length === 1 &&
				value[0] === currentPrincipal
			) {
				return "only-you";
			}
			return "custom";
		}
		return currentPrincipal !== null && !customSticky ? "only-you" : "custom";
	}, [value, currentPrincipal, customSticky]);

	const namedSet = useMemo(() => {
		if (!Array.isArray(value)) return [] as readonly string[];
		return value.filter((p) => p !== "*");
	}, [value]);

	function setMode(next: Mode): void {
		// Track explicit user intent so the radio survives renders
		// where the underlying value happens to look like another
		// mode (e.g. Custom with just `[currentPrincipal]` selected).
		setCustomSticky(next === "custom");
		if (next === "public") {
			onChange(["*"]);
			return;
		}
		if (next === "only-you") {
			if (currentPrincipal !== null) {
				onChange([currentPrincipal]);
			}
			return;
		}
		// Custom: keep any named selection that's already there, drop
		// the wildcard. Always pin the current principal — otherwise
		// the user could trap themselves out of a document they just
		// created.
		const customSet = new Set(namedSet);
		if (currentPrincipal !== null) customSet.add(currentPrincipal);
		onChange([...customSet].sort());
	}

	function toggleCustom(principalId: string): void {
		// The current principal is pinned: clicking their chip in
		// Custom mode is a no-op so the user can't accidentally lock
		// themselves out of the document they're editing.
		if (principalId === currentPrincipal) return;
		const set = new Set(namedSet);
		if (set.has(principalId)) set.delete(principalId);
		else set.add(principalId);
		// Defensively re-add the pin in case `namedSet` is somehow
		// missing it (e.g. legacy data being edited for the first time).
		if (currentPrincipal !== null) set.add(currentPrincipal);
		onChange([...set].sort());
	}

	const rows = principals.data ?? [];
	const onlyYouDisabled = currentPrincipal === null;
	const modeName = useId();

	return (
		<div
			className={cn(
				"rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40",
				className,
			)}
		>
			<div className="mb-2 flex items-center gap-2 text-slate-700 text-xs dark:text-slate-200">
				<Users className="h-3.5 w-3.5" />
				<span className="font-medium">Visible to</span>
			</div>

			<div
				className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900"
				role="radiogroup"
				aria-label="Visibility mode"
			>
				<ModeRadio
					name={modeName}
					value="only-you"
					checked={mode === "only-you"}
					disabled={onlyYouDisabled}
					onClick={() => setMode("only-you")}
					icon={<Lock className="h-3.5 w-3.5" />}
					label="Only You"
					hint={
						onlyYouDisabled
							? "Pick a 'View as' principal first"
							: `Visible to ${currentPrincipal}`
					}
				/>
				<ModeRadio
					name={modeName}
					value="public"
					checked={mode === "public"}
					onClick={() => setMode("public")}
					icon={<Globe className="h-3.5 w-3.5" />}
					label="Public"
					hint="Anyone in this workspace"
				/>
				<ModeRadio
					name={modeName}
					value="custom"
					checked={mode === "custom"}
					onClick={() => setMode("custom")}
					icon={<Users className="h-3.5 w-3.5" />}
					label="Custom"
					hint="Pick specific principals"
				/>
			</div>

			{mode === "custom" ? (
				<div className="mt-3 flex flex-wrap gap-1.5">
					{rows.length === 0 ? (
						<span className="text-slate-500 text-xs dark:text-slate-400">
							No principals in this workspace yet. Create some in workspace
							settings before assigning visibility.
						</span>
					) : (
						rows.map((p) => {
							const isSelf = p.principalId === currentPrincipal;
							const selected = isSelf || namedSet.includes(p.principalId);
							return (
								<button
									type="button"
									key={p.principalId}
									onClick={() => toggleCustom(p.principalId)}
									disabled={isSelf}
									aria-pressed={selected}
									title={
										isSelf
											? "You — always included so you don't lock yourself out"
											: undefined
									}
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
										selected
											? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white"
											: "border-slate-300 bg-white text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
										isSelf && "cursor-default opacity-90",
									)}
								>
									{isSelf ? (
										<Lock className="h-3 w-3" aria-hidden="true" />
									) : null}
									{p.principalId}
								</button>
							);
						})
					)}
				</div>
			) : null}

			<p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
				{mode === "only-you" ? (
					onlyYouDisabled ? (
						<>
							No principal is currently selected — pick one from the View-as
							chip in the header to use Only-You visibility.
						</>
					) : (
						<>
							Only <code>{currentPrincipal}</code> will be able to read these
							documents.
						</>
					)
				) : mode === "public" ? (
					<>Every principal in this workspace can read these documents.</>
				) : currentPrincipal !== null ? (
					<>
						You (<code>{currentPrincipal}</code>) are always included so you
						can't lock yourself out. Pick additional principals to share with.
					</>
				) : namedSet.length === 0 ? (
					<>
						Pick at least one principal — leaving the list empty makes the
						document invisible to everyone.
					</>
				) : (
					<>Only the selected principals can read these documents.</>
				)}
			</p>
		</div>
	);
}

function ModeRadio({
	name,
	value,
	checked,
	disabled,
	onClick,
	icon,
	label,
	hint,
}: {
	readonly name: string;
	readonly value: Mode;
	readonly checked: boolean;
	readonly disabled?: boolean;
	readonly onClick: () => void;
	readonly icon: React.ReactNode;
	readonly label: string;
	readonly hint: string;
}) {
	return (
		<label
			className={cn(
				"flex flex-col items-center justify-center rounded px-2 py-1.5 text-center text-[11px] transition-colors",
				checked
					? "bg-[var(--color-brand-600)] text-white shadow-sm"
					: "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
				disabled && "cursor-not-allowed opacity-50",
			)}
			title={hint}
		>
			<input
				type="radio"
				name={name}
				value={value}
				checked={checked}
				disabled={disabled}
				onChange={(e) => {
					if (e.currentTarget.checked) onClick();
				}}
				className="sr-only"
			/>
			<span className="flex items-center gap-1 font-medium">
				{icon}
				{label}
			</span>
		</label>
	);
}
