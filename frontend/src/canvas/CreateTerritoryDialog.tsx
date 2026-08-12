import { TERRITORY_TITLE_MAX_LENGTH } from '@nuee/shared-types';
import { useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import {
  createTerritory,
  type CreateTerritoryInput,
  type Territory,
  type TerritoryCreateRequest,
} from '../api';
import { focusRing } from '../ui/focusRing';
import { useModalShell } from '../ui/useModalShell';

interface CreateTerritoryDialogProps {
  onCancel: () => void;
  onCreated: (territory: Territory) => void;
  placement: Pick<CreateTerritoryInput, 'position_x' | 'position_y'>;
  projectId: string;
  requestCreate?: TerritoryCreateRequest;
}

export function CreateTerritoryDialog({
  onCancel,
  onCreated,
  placement,
  projectId,
  requestCreate = createTerritory,
}: CreateTerritoryDialogProps) {
  const [title, setTitle] = useState('');
  const [isTouched, setIsTouched] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [hasCreateError, setHasCreateError] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const isCreatingRef = useRef(false);
  const normalizedTitle = title.trim();
  const titleError =
    normalizedTitle.length === 0
      ? 'Enter a territory title.'
      : normalizedTitle.length > TERRITORY_TITLE_MAX_LENGTH
        ? `Use ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`
        : null;
  const { containerRef } = useModalShell({
    initialFocus: () => titleInputRef.current,
    onEscape: () => {
      if (!isCreatingRef.current) {
        onCancel();
      }
    },
  });

  function cancelFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !isCreatingRef.current) {
      onCancel();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsTouched(true);

    if (titleError || isCreatingRef.current) {
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setHasCreateError(false);

    try {
      const territory = await requestCreate(projectId, {
        title: normalizedTitle,
        ...placement,
      });

      isCreatingRef.current = false;
      setIsCreating(false);
      onCreated(territory);
    } catch {
      isCreatingRef.current = false;
      setIsCreating(false);
      setHasCreateError(true);
    }
  }

  const showTitleError = isTouched && titleError !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
      data-canvas-overlay
      onMouseDown={cancelFromBackdrop}
    >
      <div
        className="w-full max-w-[430px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-territory-title"
        aria-describedby="create-territory-description"
        aria-busy={isCreating}
        tabIndex={-1}
      >
        <form noValidate onSubmit={handleSubmit}>
          <div className="px-[22px] pt-5 pb-4">
            <div className="mb-1 flex items-center gap-3">
              <h2
                className="m-0 text-base font-semibold tracking-[-0.15px] text-[#1e2733]"
                id="create-territory-title"
              >
                New territory
              </h2>
              <span
                className={`ml-auto inline-flex min-h-4 shrink-0 items-center gap-1.5 text-[9px] font-medium tracking-[0.06em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
                  isCreating ? 'text-[#3f63a8]' : 'text-[#b6c0cc]'
                }`}
                aria-live="polite"
              >
                {isCreating && (
                  <LoaderCircle
                    className="size-[11px] animate-spin motion-reduce:animate-none"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                )}
                {isCreating ? 'CREATING' : 'MANUAL'}
              </span>
            </div>

            <p
              className="mt-0 mb-[18px] text-xs leading-[1.5] text-[#8b97a6]"
              id="create-territory-description"
            >
              Create an empty group at the center of your current canvas view.
            </p>

            {hasCreateError && (
              <div
                className="mb-4 flex items-start gap-2.5 rounded-[9px] border border-[#ecd4d1] bg-[#fbf1f0] px-3 py-2.5"
                role="alert"
              >
                <CircleAlert
                  className="mt-px size-[15px] shrink-0 text-[#b4544e]"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
                <div>
                  <p className="m-0 text-xs font-semibold text-[#a44a44]">
                    Couldn’t create the territory
                  </p>
                  <p className="mt-0.5 mb-0 text-[11px] leading-[1.45] text-[#b06b66]">
                    Your title is safe below — try again.
                  </p>
                </div>
              </div>
            )}

            <label
              className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#3a4453]"
              htmlFor="create-territory-name"
            >
              Title <span className="text-[#b4544e]">*</span>
            </label>
            <input
              className={`w-full rounded-[9px] border bg-white px-3 py-2.5 text-[13px] text-[#1e2733] placeholder:text-[#b6c0cc] disabled:cursor-not-allowed disabled:border-[#eef1f5] disabled:bg-[#fafbfc] disabled:text-[#8b97a6] ${
                showTitleError
                  ? 'border-[#e6c7c4] bg-[#fdf8f8] focus:border-[#b4544e]'
                  : 'border-[#dbe1e9] focus:border-[#3f63a8]'
              } ${focusRing}`}
              id="create-territory-name"
              ref={titleInputRef}
              name="title"
              type="text"
              value={title}
              placeholder="Name this territory…"
              disabled={isCreating}
              required
              aria-invalid={showTitleError}
              aria-describedby={
                showTitleError ? 'create-territory-name-error' : undefined
              }
              onBlur={() => setIsTouched(true)}
              onChange={(event) => {
                setTitle(event.target.value);
                setHasCreateError(false);
              }}
            />
            <div className="mt-1 flex min-h-4 items-center justify-between gap-3 text-[11px]">
              <p
                className={`m-0 flex items-center gap-1 text-[#b4544e] ${
                  showTitleError ? 'visible' : 'invisible'
                }`}
                id="create-territory-name-error"
              >
                <CircleAlert
                  className="size-3 shrink-0"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {titleError ?? 'Valid title'}
              </p>
              <span className="shrink-0 text-[#9aa6b4]">
                {normalizedTitle.length}/{TERRITORY_TITLE_MAX_LENGTH}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[#e7ebf0] bg-[#fafbfc] px-[22px] py-3.5">
            <button
              className={`min-h-9 cursor-pointer rounded-[9px] px-3.5 text-[12.5px] font-semibold text-[#6f7b8a] hover:bg-[#eef1f5] hover:text-[#3d4a5a] disabled:cursor-default disabled:opacity-50 ${focusRing}`}
              type="button"
              disabled={isCreating}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className={`inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-[#3f63a8] px-4 text-[12.5px] font-semibold text-white hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#aebbd1] ${focusRing}`}
              type="submit"
              disabled={isCreating}
            >
              {isCreating ? 'Creating…' : 'Create territory'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
