import { useCallback, useState } from "react";

/**
 * Shared state machine for the embedding / chunking / reranking
 * service-creation forms in `ServicesPanel.tsx`.
 *
 * Every subpanel had the same shape:
 *   - a `presetId` selector,
 *   - a `draft` form state initialized from a "blank" record,
 *   - a per-select-field "custom mode" boolean tracking whether the
 *     user typed a value not in the known options (e.g. a custom
 *     model name that's not in the curated list).
 *
 * This hook owns those three pieces and the `applyPreset` / `reset`
 * transitions. Subpanels still own their JSX and submit handlers —
 * the dialog body differs per service kind (different fields), but
 * the state machinery doesn't.
 */

export const PRESET_NONE = "_preset_none_";

export interface PresetSpec<TInput> {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly input: TInput;
}

/**
 * Per-select-field rule: given a preset's input, decide whether the
 * value at this field is "custom" (i.e. not in the curated dropdown
 * options for that field). The hook flips the corresponding
 * customMode entry on preset apply so the form renders the freeform
 * text input instead of the select.
 */
export interface CustomFieldRule<TInput> {
	readonly key: string;
	readonly isCustom: (input: TInput) => boolean;
}

export interface UseServicePresetStateOptions<TInput> {
	readonly blank: TInput;
	readonly presets: readonly PresetSpec<TInput>[];
	readonly customFields: readonly CustomFieldRule<TInput>[];
}

export interface UseServicePresetStateReturn<TInput> {
	readonly presetId: string;
	readonly draft: TInput;
	readonly setDraft: React.Dispatch<React.SetStateAction<TInput>>;
	readonly customMode: Readonly<Record<string, boolean>>;
	readonly setCustomMode: (key: string, value: boolean) => void;
	readonly applyPreset: (id: string) => void;
	readonly reset: () => void;
}

export function useServicePresetState<TInput>(
	opts: UseServicePresetStateOptions<TInput>,
): UseServicePresetStateReturn<TInput> {
	const { blank, presets, customFields } = opts;
	const [presetId, setPresetId] = useState<string>(PRESET_NONE);
	const [draft, setDraft] = useState<TInput>(blank);
	const [customMode, setCustomModeState] = useState<Record<string, boolean>>(
		() => {
			const init: Record<string, boolean> = {};
			for (const f of customFields) init[f.key] = false;
			return init;
		},
	);

	const setCustomMode = useCallback((key: string, value: boolean): void => {
		setCustomModeState((prev) => ({ ...prev, [key]: value }));
	}, []);

	const reset = useCallback((): void => {
		setPresetId(PRESET_NONE);
		setDraft(blank);
		setCustomModeState(() => {
			const next: Record<string, boolean> = {};
			for (const f of customFields) next[f.key] = false;
			return next;
		});
	}, [blank, customFields]);

	const applyPreset = useCallback(
		(id: string): void => {
			setPresetId(id);
			if (id === PRESET_NONE) {
				setDraft(blank);
				setCustomModeState(() => {
					const next: Record<string, boolean> = {};
					for (const f of customFields) next[f.key] = false;
					return next;
				});
				return;
			}
			const preset = presets.find((p) => p.id === id);
			if (!preset) return;
			setDraft(preset.input);
			setCustomModeState(() => {
				const next: Record<string, boolean> = {};
				for (const f of customFields) next[f.key] = f.isCustom(preset.input);
				return next;
			});
		},
		[blank, presets, customFields],
	);

	return {
		presetId,
		draft,
		setDraft,
		customMode,
		setCustomMode,
		applyPreset,
		reset,
	};
}
