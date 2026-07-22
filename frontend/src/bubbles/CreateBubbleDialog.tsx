import { useEffect, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import {
  createBubble,
  getBubblePlacement,
  type Bubble,
  type BubblePlacementInput,
  type CreateBubbleInput,
} from '../api';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';
const fieldClasses =
  `w-full rounded-[9px] border bg-white px-3 py-2.5 text-[13px] text-[#1e2733] placeholder:text-[#b6c0cc] disabled:cursor-not-allowed disabled:border-[#eef1f5] disabled:bg-[#fafbfc] disabled:text-[#8b97a6] ${focusRing}`;

export type BubbleCreateRequest = (
  projectId: string,
  input: CreateBubbleInput,
) => Promise<Bubble>;

export type BubblePlacementRequest = (
  projectId: string,
  input: BubblePlacementInput,
) => Promise<{ position_x: number; position_y: number }>;

export interface CreateBubbleDialogProps {
  onCancel: () => void;
  onCreated: (bubble: Bubble) => void;
  placementInput: BubblePlacementInput;
  projectId: string;
  requestCreate?: BubbleCreateRequest;
  requestPlacement?: BubblePlacementRequest;
}

export function CreateBubbleDialog({
  onCancel,
  onCreated,
  placementInput,
  projectId,
  requestCreate = createBubble,
  requestPlacement = getBubblePlacement,
}: CreateBubbleDialogProps) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [touched, setTouched] = useState({ title: false, content: false });
  const [isCreating, setIsCreating] = useState(false);
  const [hasCreateError, setHasCreateError] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const isCreatingRef = useRef(false);
  const onCancelRef = useRef(onCancel);

  const normalizedTitle = title.trim();
  const normalizedSummary = summary.trim();
  const normalizedContent = content.trim();
  const isValid = normalizedTitle.length > 0 && normalizedContent.length > 0;
  const titleError = touched.title && normalizedTitle.length === 0;
  const contentError = touched.content && normalizedContent.length === 0;

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
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

      const focusableElements = dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
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

  const clearCreateError = () => {
    if (hasCreateError) {
      setHasCreateError(false);
    }
  };

  const handleBackdropMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isCreatingRef.current) {
      onCancel();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isValid || isCreatingRef.current) {
      setTouched({ title: true, content: true });
      return;
    }

    isCreatingRef.current = true;
    setIsCreating(true);
    setHasCreateError(false);

    try {
      const placement = await requestPlacement(projectId, placementInput);
      const bubble = await requestCreate(projectId, {
        title: normalizedTitle,
        summary: normalizedSummary.length > 0 ? normalizedSummary : null,
        content: normalizedContent,
        ...placement,
      });

      isCreatingRef.current = false;
      setIsCreating(false);
      onCreated(bubble);
    } catch {
      isCreatingRef.current = false;
      setIsCreating(false);
      setHasCreateError(true);
    }
  };

  const inputBorderClasses = (hasError: boolean) =>
    hasError
      ? 'border-[#e6c7c4] bg-[#fdf8f8] focus:border-[#b4544e]'
      : 'border-[#dbe1e9] focus:border-[#3f63a8]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1e2733]/45 p-4 backdrop-blur-[1.5px]"
      data-canvas-overlay
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        className="w-full max-w-[472px] overflow-hidden rounded-2xl border border-[#e1e6ec] bg-white shadow-[0_24px_60px_-18px_rgba(20,28,40,0.55)]"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-bubble-title"
        aria-describedby="create-bubble-description"
        aria-busy={isCreating}
        tabIndex={-1}
      >
        <form noValidate onSubmit={handleSubmit}>
          <div className="px-5 pt-5 pb-4 sm:px-[22px]">
            <div className="mb-1 flex items-center gap-3">
              <h2
                className="m-0 text-base font-semibold tracking-[-0.15px] text-[#1e2733]"
                id="create-bubble-title"
              >
                New bubble
              </h2>
              <span
                className={`ml-auto shrink-0 text-[9px] font-medium tracking-[0.06em] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] ${
                  isCreating
                    ? 'inline-flex items-center gap-1.5 text-[#3f63a8]'
                    : 'text-[#b6c0cc]'
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
                {isCreating ? 'CREATING' : 'PLACED IN VIEW'}
              </span>
            </div>

            <p
              className="mt-0 mb-[18px] text-xs leading-[1.5] text-[#8b97a6]"
              id="create-bubble-description"
            >
              Durable knowledge you&apos;re adding by hand — no discussion needed.
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
                    Couldn’t create the bubble
                  </p>
                  <p className="mt-0.5 mb-0 text-[11px] leading-[1.45] text-[#b06b66]">
                    Your title, summary, and content are safe below — try again.
                  </p>
                </div>
              </div>
            )}

            <label
              className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#3a4453]"
              htmlFor="create-bubble-name"
            >
              Title <span className="text-[#b4544e]">*</span>
            </label>
            <input
              className={`${fieldClasses} ${inputBorderClasses(titleError)}`}
              id="create-bubble-name"
              ref={titleInputRef}
              name="title"
              type="text"
              value={title}
              placeholder="Name this knowledge…"
              disabled={isCreating}
              required
              aria-invalid={titleError}
              aria-describedby={
                titleError ? 'create-bubble-name-error' : undefined
              }
              onBlur={() =>
                setTouched((current) => ({ ...current, title: true }))
              }
              onChange={(event) => {
                setTitle(event.target.value);
                clearCreateError();
              }}
            />
            <p
              className={`mt-1 mb-3 flex min-h-4 items-center gap-1 text-[11px] text-[#b4544e] ${
                titleError ? 'visible' : 'invisible'
              }`}
              id="create-bubble-name-error"
            >
              <CircleAlert className="size-3" strokeWidth={2} aria-hidden="true" />
              A title is required.
            </p>

            <label
              className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#3a4453]"
              htmlFor="create-bubble-summary"
            >
              Summary
              <span className="font-normal text-[#9aa6b4]">· optional</span>
            </label>
            <input
              className={`${fieldClasses} ${inputBorderClasses(false)}`}
              id="create-bubble-summary"
              name="summary"
              type="text"
              value={summary}
              placeholder="Leave blank to preview from content…"
              disabled={isCreating}
              aria-describedby="create-bubble-summary-hint"
              onChange={(event) => {
                setSummary(event.target.value);
                clearCreateError();
              }}
            />
            <p
              className="mt-1.5 mb-3 text-[10.5px] text-[#9aa6b4]"
              id="create-bubble-summary-hint"
            >
              If empty, the card shows the beginning of your content.
            </p>

            <label
              className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#3a4453]"
              htmlFor="create-bubble-content"
            >
              Content <span className="text-[#b4544e]">*</span>
            </label>
            <textarea
              className={`${fieldClasses} ${inputBorderClasses(contentError)} min-h-[84px] resize-y leading-[1.55]`}
              id="create-bubble-content"
              name="content"
              value={content}
              placeholder="Write the complete knowledge you want to keep…"
              disabled={isCreating}
              required
              rows={4}
              aria-invalid={contentError}
              aria-describedby={
                contentError ? 'create-bubble-content-error' : undefined
              }
              onBlur={() =>
                setTouched((current) => ({ ...current, content: true }))
              }
              onChange={(event) => {
                setContent(event.target.value);
                clearCreateError();
              }}
            />
            {contentError && (
              <p
                className="mt-1.5 mb-0 flex items-center gap-1 text-[11px] text-[#b4544e]"
                id="create-bubble-content-error"
              >
                <CircleAlert className="size-3" strokeWidth={2} aria-hidden="true" />
                Content is required.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 border-t border-[#eef1f5] bg-[#fafbfc] px-5 py-3.5 sm:px-[22px]">
            <span className="mr-auto hidden text-[10.5px] font-medium text-[#b6c0cc] [font-family:'IBM_Plex_Mono',ui-monospace,monospace] sm:inline">
              {isCreating ? 'CREATION IN PROGRESS' : 'TITLE + CONTENT REQUIRED'}
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
              {isCreating
                ? 'Creating…'
                : hasCreateError
                  ? 'Try again'
                  : 'Create bubble'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
