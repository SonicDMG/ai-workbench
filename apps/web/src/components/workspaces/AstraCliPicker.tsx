import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { AstraCliDatabaseInfo, AstraCliInventory } from "@/lib/schemas";

/**
 * Selection emitted to the parent. The onboarding page composes this
 * into a `WorkspaceForm` prefill — name, keyspace, and the
 * `astra-cli:<profile>:<dbId>:<token|endpoint>` credentials/url refs.
 */
export interface AstraCliSelection {
	readonly profile: string;
	readonly database: AstraCliDatabaseInfo;
}

export interface AstraCliPickerProps {
	readonly inventory: AstraCliInventory;
	readonly value: AstraCliSelection | null;
	readonly onChange: (next: AstraCliSelection | null) => void;
}

/**
 * Profile + database picker rendered above the workspace form on the
 * onboarding page. When the user picks a profile + database, the
 * parent translates the selection into a `WorkspaceFormPrefill` so
 * the workspace's `credentialsRef` carries `astra-cli:` refs that
 * resolve on demand.
 *
 * Renders nothing when the inventory is unavailable — the caller is
 * expected to fall back to the existing `AstraCliDetectionCard` (which
 * surfaces the boot-time auto-detection result, if any).
 */
export function AstraCliPicker({
	inventory,
	value,
	onChange,
}: AstraCliPickerProps) {
	// Hooks first — they must run in the same order every render, even
	// when the inventory is unavailable (we early-return below). Empty
	// profiles + no-op effects are harmless when there's nothing to
	// pick from.
	const profiles = inventory.available ? inventory.profiles : [];
	const selectedProfile = useMemo(
		() => profiles.find((p) => p.name === value?.profile) ?? null,
		[profiles, value?.profile],
	);

	// Auto-select on first render: pick the default profile if the
	// inventory marks one, otherwise the first non-empty profile. This
	// mirrors the boot-time auto-detection's behavior so users who only
	// have one profile see a one-click flow. Re-fires when the inventory
	// shape changes; the `value` guard makes it idempotent for repeat
	// renders.
	useEffect(() => {
		if (value !== null) return;
		const firstWithDb =
			profiles.find((p) => p.isUsedAsDefault && p.databases.length > 0) ??
			profiles.find((p) => p.databases.length > 0);
		if (!firstWithDb) return;
		const firstDb = firstWithDb.databases[0];
		if (!firstDb) return;
		onChange({ profile: firstWithDb.name, database: firstDb });
	}, [profiles, value, onChange]);

	if (!inventory.available) return null;
	if (profiles.length === 0) return null;

	function handleProfile(name: string) {
		const profile = profiles.find((p) => p.name === name);
		if (!profile) return;
		const firstDb = profile.databases[0] ?? null;
		if (firstDb) {
			onChange({ profile: name, database: firstDb });
		} else {
			onChange(null);
		}
	}

	function handleDatabase(dbId: string) {
		if (!selectedProfile) return;
		const db = selectedProfile.databases.find((d) => d.id === dbId);
		if (!db) return;
		onChange({ profile: selectedProfile.name, database: db });
	}

	return (
		<div
			className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50/70 p-5 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
			data-testid="astra-cli-picker"
		>
			<div className="flex items-start gap-3">
				<CheckCircle2
					className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400"
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold">Astra CLI profiles detected</p>
					<p className="mt-1 text-sm text-emerald-800/90 dark:text-emerald-200/90">
						Pick a profile + database — the workspace's credentials will resolve
						on demand from your{" "}
						<code className="font-mono text-xs">astra-cli</code> configuration.
						No restart needed.
					</p>

					<div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
						<div className="flex flex-col gap-1.5 text-xs font-medium text-emerald-900/80 dark:text-emerald-200/80">
							<span id="astra-cli-picker-profile-label">Profile</span>
							<Select
								value={value?.profile ?? ""}
								onValueChange={handleProfile}
							>
								<SelectTrigger
									className="bg-white dark:bg-slate-900"
									aria-labelledby="astra-cli-picker-profile-label"
									data-testid="astra-cli-picker-profile"
								>
									<SelectValue placeholder="Select a profile…" />
								</SelectTrigger>
								<SelectContent>
									{profiles.map((p) => (
										<SelectItem key={p.name} value={p.name}>
											<span className="font-mono">{p.name}</span>
											{p.isUsedAsDefault ? (
												<span className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">
													default
												</span>
											) : null}
											{p.databases.length === 0 ? (
												<span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
													no databases
												</span>
											) : null}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="flex flex-col gap-1.5 text-xs font-medium text-emerald-900/80 dark:text-emerald-200/80">
							<span id="astra-cli-picker-database-label">Database</span>
							<Select
								value={value?.database.id ?? ""}
								onValueChange={handleDatabase}
								disabled={
									!selectedProfile || selectedProfile.databases.length === 0
								}
							>
								<SelectTrigger
									className="bg-white dark:bg-slate-900"
									aria-labelledby="astra-cli-picker-database-label"
									data-testid="astra-cli-picker-database"
								>
									<SelectValue placeholder="Select a database…" />
								</SelectTrigger>
								<SelectContent>
									{(selectedProfile?.databases ?? []).map((d) => (
										<SelectItem key={d.id} value={d.id}>
											<span className="font-mono">{d.name}</span>
											<span className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">
												{d.region}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{value ? (
						<dl
							className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs"
							data-testid="astra-cli-picker-summary"
						>
							<dt className="font-medium text-emerald-900/70 dark:text-emerald-200/70">
								endpoint
							</dt>
							<dd
								className="truncate font-mono text-emerald-900 dark:text-emerald-100"
								title={value.database.endpoint}
							>
								{value.database.endpoint}
							</dd>
							<dt className="font-medium text-emerald-900/70 dark:text-emerald-200/70">
								keyspace
							</dt>
							<dd className="truncate font-mono text-emerald-900 dark:text-emerald-100">
								{value.database.keyspace ?? "default_keyspace"}
							</dd>
							<dt className="font-medium text-emerald-900/70 dark:text-emerald-200/70">
								credentialsRef
							</dt>
							<dd
								className="truncate font-mono text-emerald-900 dark:text-emerald-100"
								title={`astra-cli:${value.profile}:${value.database.id}:token`}
							>
								astra-cli:{value.profile}:{value.database.id}
								:&lt;token|endpoint&gt;
							</dd>
						</dl>
					) : null}
				</div>
			</div>
		</div>
	);
}
