import { useEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { CircleAlert, CircleHelp, LoaderCircle } from 'lucide-react';
import {
  createProject,
  type CreateProjectInput,
  type Project,
} from '../api';

const DESCRIPTION_LIMIT = 280;

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';
const fieldClasses =
  `w-full rounded-[9px] border bg-white px-3 py-2.5 text-[13px] text-[#1e2733] placeholder:text-[#b6c0cc] disabled:cursor-not-allowed disabled:border-[#eef1f5] disabled:bg-[#fafbfc] disabled:text-[#8b97a6] ${focusRing}`;

type CreateProjectRequest = (input: CreateProjectInput) => Promise<Project>;

export interface CreateProjectDialogProps {
  onCancel: () => void;
  onCreated: (project: Project) => void;
  requestCreate?: CreateProjectRequest;
}

export function CreateProjectDialog({
  onCancel,
  onCreated,
  requestCreate = createProject,
}: CreateProjectDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState({ title: false, description: false });
  const [isCreating, setIsCreating] = useState(false);
  const [hasCreateError, setHasCreateError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const isCreatingRef = useRef(false);
  const onCancelRef = useRef(onCancel);

  const normalizedTitle = title.trim();
  const normalizedDescription = description.trim();
  const isValid = normalizedTitle.length > 0 && normalizedDescription.length > 0;
  const titleError = touched.title && normalizedTitle.length === 0;
  const descriptionError = touched.description && normalizedDescription.length === 0;

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    titleInputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();

        if (!isCreatingRef.current) {
          onCancelRef.current();
        }

        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;
      const focusableElements = dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isCreatingRef.current) {
      onCancel();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValid || isCreatingRef.current) {
      setTouched({ title: true, description: true });
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setHasCreateError(false);

    try {
      const project = await requestCreate({
        title: normalizedTitle,
        description: normalizedDescription,
      });

      isCreatingRef.current = false;
      setIsCreating(false);
      onCreated(project);
    } catch {
      isCreatingRef.current = false;
      setIsCreating(false);
      setHasCreateError(true);
    }
  };

  const clearCreateError = () => {
    if (hasCreateError) {
      setHasCreateError(false);
    }
  };

  const inputBorderClasses = (hasError: boolean) =>
    hasError
      ? 'border-[#e6c7c4] bg-[#fdf8f8] focus:border-[#b4544e]'
      : 'border-[#dbe1e9] focus:border-[#3f63a8]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="w-full max-w-[456px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        aria-describedby="create-project-description"
        aria-busy={isCreating}
        tabIndex={-1}
      >
        <form noValidate onSubmit={handleSubmit}>
          <div className="px-5 pt-5 pb-[18px] sm:px-6 sm:pt-[22px]">
            <div className="mb-1.5 flex items-center gap-3">
              <h2
                className="m-0 text-[17px] font-semibold tracking-[-0.2px] text-[#1e2733]"
                id="create-project-title"
              >
                New project
              </h2>
              <span
                className={`ml-auto shrink-0 text-[9.5px] font-medium tracking-[0.06em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
                  isCreating
                    ? 'inline-flex items-center gap-1.5 text-[#3f63a8]'
                    : isValid
                      ? 'text-[#b6c0cc]'
                      : 'rounded-[5px] bg-[#f7ecec] px-[7px] py-[3px] text-[#b4544e]'
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
                {isCreating ? 'CREATING' : isValid ? '2 FIELDS · NO SETUP' : 'INCOMPLETE'}
              </span>
            </div>

            <p
              className="mt-0 mb-5 text-[12.5px] leading-[1.5] text-[#8b97a6]"
              id="create-project-description"
            >
              Just enough to start thinking. Nothing is pre-filled and no goals are assumed.
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
                    Couldn’t create the project
                  </p>
                  <p className="mt-0.5 mb-0 text-[11px] leading-[1.45] text-[#b06b66]">
                    The server didn’t respond. Your title and description are safe below — try again.
                  </p>
                </div>
              </div>
            )}

            <label
              className="mb-[7px] flex items-center gap-1 text-[11.5px] font-semibold text-[#3a4453]"
              htmlFor="create-project-name"
            >
              Title <span className="text-[#b4544e]">*</span>
            </label>
            <input
              className={`${fieldClasses} ${inputBorderClasses(titleError)} mb-1`}
              id="create-project-name"
              ref={titleInputRef}
              name="title"
              type="text"
              value={title}
              placeholder="Name your project…"
              disabled={isCreating}
              required
              aria-invalid={titleError}
              aria-describedby={titleError ? 'create-project-name-error' : undefined}
              onBlur={() => setTouched((current) => ({ ...current, title: true }))}
              onChange={(event) => {
                setTitle(event.target.value);
                clearCreateError();
              }}
            />
            <p
              className={`mt-1 mb-3.5 flex min-h-4 items-center gap-1 text-[11px] text-[#b4544e] ${
                titleError ? 'visible' : 'invisible'
              }`}
              id="create-project-name-error"
            >
              <CircleAlert className="size-3" strokeWidth={2} aria-hidden="true" />
              A title is required.
            </p>

            <label
              className="mb-[7px] flex items-center gap-1 text-[11.5px] font-semibold text-[#3a4453]"
              htmlFor="create-project-summary"
            >
              Short description <span className="text-[#b4544e]">*</span>
              <span className="ml-auto text-[10px] font-medium text-[#9aa6b4] [font-family:'IBM_Plex_Mono',ui-monospace,monospace]">
                {description.length} / {DESCRIPTION_LIMIT}
              </span>
            </label>
            <textarea
              className={`${fieldClasses} ${inputBorderClasses(descriptionError)} min-h-16 resize-y leading-[1.55]`}
              id="create-project-summary"
              name="description"
              value={description}
              placeholder="What are you exploring?"
              disabled={isCreating}
              required
              maxLength={DESCRIPTION_LIMIT}
              rows={3}
              aria-invalid={descriptionError}
              aria-describedby={
                descriptionError
                  ? 'create-project-summary-error create-project-context-hint'
                  : 'create-project-context-hint'
              }
              onBlur={() => setTouched((current) => ({ ...current, description: true }))}
              onChange={(event) => {
                setDescription(event.target.value);
                clearCreateError();
              }}
            />
            {descriptionError && (
              <p
                className="mt-[7px] mb-0 flex items-center gap-1 text-[11px] text-[#b4544e]"
                id="create-project-summary-error"
              >
                <CircleAlert className="size-3" strokeWidth={2} aria-hidden="true" />
                A short description is required.
              </p>
            )}
            <p
              className="mt-[9px] mb-0 flex items-start gap-1.5 text-[11px] leading-[1.4] text-[#8b97a6]"
              id="create-project-context-hint"
            >
              <CircleHelp className="mt-px size-[13px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
              Captured as context in every discussion. You can edit it anytime from the Project panel.
            </p>
          </div>

          <div className="flex items-center gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-5 py-3.5 sm:px-6">
            <span className="mr-auto hidden text-[10.5px] font-medium text-[#b6c0cc] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] sm:inline">
              {isCreating ? 'Creation in progress' : 'ESC to cancel'}
            </span>
            <button
              className={`min-h-9 rounded-[9px] border border-[#e1e6ec] bg-white px-[15px] py-2 text-[12.5px] font-semibold text-[#5c6a7a] disabled:cursor-not-allowed disabled:border-[#eef1f5] disabled:text-[#c4cdd8] ${focusRing}`}
              type="button"
              disabled={isCreating}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className={`inline-flex min-h-9 items-center justify-center gap-[7px] rounded-[9px] bg-[#3f63a8] px-[18px] py-2 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(63,99,168,0.7)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#c4cdd8] disabled:shadow-none ${focusRing}`}
              type="submit"
              disabled={!isValid || isCreating}
            >
              {isCreating && (
                <LoaderCircle
                  className="size-3 animate-spin motion-reduce:animate-none"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              )}
              {isCreating ? 'Creating…' : hasCreateError ? 'Try again' : 'Create project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
