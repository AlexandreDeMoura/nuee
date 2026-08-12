import { TERRITORY_TITLE_MAX_LENGTH } from '@nuee/shared-types';
import { useEffect, useId, useMemo, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import type { Territory } from '../api';
import { focusRing } from '../ui/focusRing';
import {
  getNewTerritoryTitleError,
  type BubbleDestinationSelection,
} from './bubbleDestinationModel';

export interface BubbleDestinationSelectorProps {
  description?: string;
  disabled?: boolean;
  newTerritoryPlacementAvailable?: boolean;
  onChange: (selection: BubbleDestinationSelection) => void;
  revealValidation?: boolean;
  selection: BubbleDestinationSelection;
  territories: readonly Territory[];
}

export function BubbleDestinationSelector({
  description = 'Choose where this bubble will live.',
  disabled = false,
  newTerritoryPlacementAvailable = true,
  onChange,
  revealValidation = false,
  selection,
  territories,
}: BubbleDestinationSelectorProps) {
  const groupName = useId();
  const hintId = useId();
  const newTitleId = useId();
  const newTitleErrorId = useId();
  const [isNewTitleTouched, setIsNewTitleTouched] = useState(false);
  const manualTerritories = useMemo(
    () =>
      territories
        .filter(({ kind }) => kind === 'manual')
        .toSorted(
          (first, second) =>
            first.title.localeCompare(second.title) ||
            first.id.localeCompare(second.id),
        ),
    [territories],
  );
  const newTitleError =
    selection.kind === 'new'
      ? getNewTerritoryTitleError(selection.title)
      : null;
  const showNewTitleError =
    selection.kind === 'new' &&
    newTitleError !== null &&
    (isNewTitleTouched || revealValidation);

  useEffect(() => {
    if (
      selection.kind === 'existing' &&
      !manualTerritories.some(({ id }) => id === selection.territory_id)
    ) {
      onChange({ kind: 'ungrouped' });
    }
  }, [manualTerritories, onChange, selection]);

  const optionClasses =
    'flex cursor-pointer items-start gap-2.5 rounded-[9px] border border-[#e1e6ec] bg-white px-3 py-2.5 text-left hover:border-[#c7d2df] hover:bg-[#fbfcfe] focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-[#3f63a8]/30 has-checked:border-[#9fb0cf] has-checked:bg-[#f3f6fb] has-disabled:cursor-not-allowed has-disabled:opacity-55';

  return (
    <fieldset
      className="m-0 border-0 p-0"
      aria-describedby={hintId}
      disabled={disabled}
    >
      <legend className="mb-1.5 text-[11px] font-semibold text-[#3a4453]">
        Destination
      </legend>
      <p
        className="mt-0 mb-2 text-[10.5px] leading-[1.45] text-[#8b97a6]"
        id={hintId}
      >
        {description}
      </p>

      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
        <label className={optionClasses}>
          <input
            className="mt-0.5 size-3.5 accent-[#3f63a8]"
            type="radio"
            name={groupName}
            checked={selection.kind === 'ungrouped'}
            onChange={() => onChange({ kind: 'ungrouped' })}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-[#354152]">
              Ungrouped
            </span>
            <span className="mt-0.5 block text-[10.5px] text-[#8b97a6]">
              Default destination
            </span>
          </span>
        </label>

        {manualTerritories.map((territory) => (
          <label className={optionClasses} key={territory.id}>
            <input
              className="mt-0.5 size-3.5 accent-[#3f63a8]"
              type="radio"
              name={groupName}
              checked={
                selection.kind === 'existing' &&
                selection.territory_id === territory.id
              }
              onChange={() =>
                onChange({ kind: 'existing', territory_id: territory.id })
              }
            />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#354152]">
              {territory.title}
            </span>
          </label>
        ))}

        <label className={optionClasses}>
          <input
            className="mt-0.5 size-3.5 accent-[#3f63a8]"
            type="radio"
            name={groupName}
            checked={selection.kind === 'new'}
            disabled={!newTerritoryPlacementAvailable}
            onChange={() => onChange({ kind: 'new', title: '' })}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-[#354152]">
              New territory
            </span>
            <span className="mt-0.5 block text-[10.5px] text-[#8b97a6]">
              Create it at the center of the current canvas view
            </span>
          </span>
        </label>
      </div>

      {selection.kind === 'new' && (
        <div className="mt-2.5 pl-6">
          <label
            className="mb-1.5 block text-[11px] font-semibold text-[#3a4453]"
            htmlFor={newTitleId}
          >
            New territory title
          </label>
          <input
            className={`w-full rounded-[9px] border bg-white px-3 py-2.5 text-[13px] text-[#1e2733] placeholder:text-[#b6c0cc] disabled:cursor-not-allowed disabled:bg-[#fafbfc] ${
              showNewTitleError
                ? 'border-[#e6c7c4] bg-[#fdf8f8] focus:border-[#b4544e]'
                : 'border-[#dbe1e9] focus:border-[#3f63a8]'
            } ${focusRing}`}
            id={newTitleId}
            type="text"
            value={selection.title}
            placeholder="Name this territory…"
            aria-describedby={
              showNewTitleError ? newTitleErrorId : undefined
            }
            aria-invalid={showNewTitleError}
            onBlur={() => setIsNewTitleTouched(true)}
            onChange={(event) =>
              onChange({ kind: 'new', title: event.target.value })
            }
          />
          <div className="mt-1 flex min-h-4 items-center justify-between gap-3 text-[11px]">
            <p
              className={`m-0 flex items-center gap-1 text-[#b4544e] ${
                showNewTitleError ? 'visible' : 'invisible'
              }`}
              id={newTitleErrorId}
            >
              <CircleAlert
                className="size-3 shrink-0"
                strokeWidth={2}
                aria-hidden="true"
              />
              {newTitleError ?? 'Valid title'}
            </p>
            <span className="shrink-0 text-[#9aa6b4]">
              {selection.title.trim().length}/{TERRITORY_TITLE_MAX_LENGTH}
            </span>
          </div>
        </div>
      )}
    </fieldset>
  );
}
