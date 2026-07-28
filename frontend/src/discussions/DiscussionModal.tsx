import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ArrowUp, MessageSquare, Minus } from 'lucide-react';
import { isTemporaryDiscussionTitle } from './discussionModel';
import type { VisibleDiscussion } from './useDiscussionVisibility';

const focusRing =
  '[-webkit-tap-highlight-color:transparent] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#3f63a8]/30';

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export interface DiscussionModalProps {
  actionsSlot?: ReactNode;
  composerSlot?: ReactNode;
  contextSlot?: ReactNode;
  messagesSlot?: ReactNode;
  onDraftPromptChange: (prompt: string) => void;
  onDraftSubmit?: (prompt: string) => void;
  onMinimize: () => void;
  visibleDiscussion: VisibleDiscussion;
}

export function DiscussionModal({
  actionsSlot,
  composerSlot,
  contextSlot,
  messagesSlot,
  onDraftPromptChange,
  onDraftSubmit,
  onMinimize,
  visibleDiscussion,
}: DiscussionModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const composerId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  const onMinimizeRef = useRef(onMinimize);
  const isDraft = visibleDiscussion.kind === 'draft';
  const hasTemporaryTitle =
    isDraft || isTemporaryDiscussionTitle(visibleDiscussion.title);
  const visibilityIdentity = isDraft
    ? `draft:${visibleDiscussion.key}`
    : `persisted:${visibleDiscussion.discussionId}`;
  const normalizedPrompt = isDraft ? visibleDiscussion.prompt.trim() : '';

  useEffect(() => {
    onMinimizeRef.current = onMinimize;
  }, [onMinimize]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = 'hidden';

    if (isDraft) {
      (
        draftInputRef.current ??
        dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea')
      )?.focus();
    } else {
      dialogRef.current?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onMinimizeRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;
      const focusableElements = dialog
        ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
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
  }, [isDraft, visibilityIdentity]);

  const submitDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (visibleDiscussion.kind !== 'draft') {
      return;
    }

    const prompt = visibleDiscussion.prompt.trim();

    if (prompt.length > 0) {
      onDraftSubmit?.(prompt);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#1e2733]/45 p-3 backdrop-blur-[1.5px] sm:p-6"
      data-discussion-overlay
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="flex max-h-[min(760px,calc(100vh-90px))] min-h-[420px] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-[#d9e0e8] bg-white shadow-[0_28px_72px_-24px_rgba(20,28,40,0.58)]"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-discussion-kind={visibleDiscussion.kind}
        tabIndex={-1}
      >
        <header className="shrink-0 border-b border-[#eef1f5] px-4 sm:px-5">
          <div className="flex min-h-13 items-center gap-3">
            <div className="min-w-0">
              <h2
                className={`truncate text-[15px] font-semibold ${
                  hasTemporaryTitle
                    ? 'italic text-[#8b97a6]'
                    : 'tracking-[-0.15px] text-[#1e2733]'
                }`}
                data-temporary-title={hasTemporaryTitle ? 'true' : undefined}
                id={titleId}
                title={visibleDiscussion.title}
              >
                {visibleDiscussion.title}
              </h2>
              <p className="sr-only" id={descriptionId}>
                Focus on one question. Keep what matters as knowledge later.
              </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {actionsSlot}
              <button
                className={`grid size-8 cursor-pointer place-items-center rounded-[9px] border border-[#e1e6ec] bg-white text-[#6f7d8e] hover:border-[#c7d2df] hover:bg-[#f6f8fc] hover:text-[#40516a] ${focusRing}`}
                type="button"
                aria-label="Minimize discussion"
                title="Minimize discussion"
                onClick={onMinimize}
              >
                <Minus
                  className="size-[16px]"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          {contextSlot && (
            <div className="min-w-0 border-t border-[#f1f3f6] py-2">
              {contextSlot}
            </div>
          )}
        </header>

        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#fbfcfd] px-4 py-5 sm:px-6"
          aria-live="polite"
        >
          {messagesSlot ?? (
            <div className="m-auto max-w-[380px] py-8 text-center">
              <span className="mx-auto mb-3.75 grid size-11.5 place-items-center rounded-[13px] bg-[#eef2fa] text-[#3f63a8]">
                <MessageSquare
                  className="size-5.25"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
              </span>
              <p className="text-[16px] font-semibold text-[#1e2733]">
                Ask one focused question
              </p>
              <p className="mt-1.5 text-[12.5px] leading-[1.55] text-[#8b97a6]">
                Answers stay short by default. When something&apos;s worth
                keeping, extract it as a bubble — the thread stays as reasoning
                history.
              </p>
            </div>
          )}
        </div>

        {composerSlot ??
          (isDraft && (
            <form
              className="shrink-0 border-t border-[#eef1f5] bg-white p-3.5 sm:p-4"
              onSubmit={submitDraft}
            >
              <label className="sr-only" htmlFor={composerId}>
                Discussion prompt
              </label>
              <div className="flex items-end gap-2 rounded-xl border border-[#d7dee7] bg-white p-2 shadow-[0_1px_2px_rgba(30,39,51,0.04)] focus-within:border-[#3f63a8] focus-within:ring-3 focus-within:ring-[#3f63a8]/10">
                <textarea
                  className="max-h-40 min-h-[42px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[13px] leading-[1.5] text-[#1e2733] outline-none placeholder:text-[#a7b1be]"
                  id={composerId}
                  name="prompt"
                  placeholder="What do you want to understand?"
                  ref={draftInputRef}
                  rows={1}
                  value={visibleDiscussion.prompt}
                  onChange={(event) => onDraftPromptChange(event.target.value)}
                />
                <button
                  className={`grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#3f63a8] text-white shadow-[0_5px_12px_-7px_rgba(63,99,168,0.8)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#c6cfda] disabled:shadow-none ${focusRing}`}
                  type="submit"
                  aria-label="Continue discussion"
                  disabled={
                    normalizedPrompt.length === 0 || onDraftSubmit === undefined
                  }
                  title="Continue"
                >
                  <ArrowUp
                    className="size-[16px]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              </div>
            </form>
          ))}
      </div>
    </div>
  );
}
