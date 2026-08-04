import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowUp,
  CirclePlus,
  MessageSquare,
  Minus,
  Trash2,
  X,
} from 'lucide-react';
import { focusRing } from '../ui/focusRing';
import { useModalShell } from '../ui/useModalShell';
import { isTemporaryDiscussionTitle } from './discussionModel';
import type { VisibleDiscussion } from './useDiscussionVisibility';

export interface DiscussionModalProps {
  actionsSlot?: ReactNode;
  composerSlot?: ReactNode;
  contextSlot?: ReactNode;
  inspectorSlot?: ReactNode;
  isObscured?: boolean;
  messagesSlot?: ReactNode;
  presentation?: 'discussion' | 'extraction_request';
  presentationSubtitle?: string;
  presentationTitle?: string;
  onCloseInspector?: () => void;
  onDelete?: () => void;
  onDraftPromptChange: (prompt: string) => void;
  onDraftSubmit?: (prompt: string) => void;
  onMinimize: () => void;
  visibleDiscussion: VisibleDiscussion;
}

export function DiscussionModal({
  actionsSlot,
  composerSlot,
  contextSlot,
  inspectorSlot,
  isObscured = false,
  messagesSlot,
  presentation = 'discussion',
  presentationSubtitle,
  presentationTitle,
  onCloseInspector,
  onDelete,
  onDraftPromptChange,
  onDraftSubmit,
  onMinimize,
  visibleDiscussion,
}: DiscussionModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const composerId = useId();
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  const onMinimizeRef = useRef(onMinimize);
  const onCloseInspectorRef = useRef(onCloseInspector);
  const isDraft = visibleDiscussion.kind === 'draft';
  const isExtractionRequest = presentation === 'extraction_request';
  const displayedTitle = presentationTitle ?? visibleDiscussion.title;
  const hasTemporaryTitle =
    !isExtractionRequest &&
    (isDraft || isTemporaryDiscussionTitle(visibleDiscussion.title));
  const visibilityIdentity = isDraft
    ? `draft:${visibleDiscussion.key}`
    : `persisted:${visibleDiscussion.discussionId}`;
  const normalizedPrompt = isDraft ? visibleDiscussion.prompt.trim() : '';

  useEffect(() => {
    onMinimizeRef.current = onMinimize;
  }, [onMinimize]);

  useEffect(() => {
    onCloseInspectorRef.current = onCloseInspector;
  }, [onCloseInspector]);

  const { containerRef: dialogRef } = useModalShell<HTMLDivElement>({
    onEscape: () => {
      if (onCloseInspectorRef.current) {
        onCloseInspectorRef.current();
      } else {
        onMinimizeRef.current();
      }
    },
    initialFocus: (dialog) =>
      isDraft
        ? (draftInputRef.current ??
          dialog?.querySelector<HTMLTextAreaElement>('textarea'))
        : dialog,
    resetKey: `${isDraft}:${visibilityIdentity}`,
  });

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
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#1e2733]/45 p-3.5 backdrop-blur-[1.5px] sm:p-7.25"
      data-discussion-overlay
      aria-hidden={isObscured ? 'true' : undefined}
      inert={isObscured ? true : undefined}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className={`flex max-h-[min(912px,calc(100vh-108px))] min-h-[504px] w-full flex-col overflow-hidden rounded-2xl border border-[#d9e0e8] bg-white shadow-[0_28px_72px_-24px_rgba(20,28,40,0.58)] md:flex-row ${
          inspectorSlot
            ? 'max-w-[1296px]'
            : isExtractionRequest
              ? 'max-w-[1152px]'
              : 'max-w-[912px]'
        }`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-discussion-kind={visibleDiscussion.kind}
        tabIndex={-1}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          <header
            className={`shrink-0 border-b border-[#eef1f5] px-4.75 sm:px-6 ${
              isExtractionRequest ? 'py-3.5' : ''
            }`}
          >
          <div
            className={`flex items-center gap-3.5 ${
              isExtractionRequest ? 'min-h-16.75' : 'min-h-15.5'
            }`}
          >
            {isExtractionRequest && (
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#eef3fb] text-[#4267ad]">
                <CirclePlus
                  className="size-6"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2
                className={`truncate text-[18px] font-semibold ${
                  hasTemporaryTitle
                    ? 'italic text-[#8b97a6]'
                    : 'tracking-[-0.15px] text-[#1e2733]'
                }`}
                data-temporary-title={hasTemporaryTitle ? 'true' : undefined}
                id={titleId}
                title={displayedTitle}
              >
                {displayedTitle}
              </h2>
              <p
                className={
                  isExtractionRequest
                    ? 'mt-0.5 truncate text-[13px] text-[#8290a4]'
                    : 'sr-only'
                }
                id={descriptionId}
                title={presentationSubtitle}
              >
                {presentationSubtitle ??
                  'Focus on one question. Keep what matters as knowledge later.'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {actionsSlot}
              {!isExtractionRequest && !isDraft && onDelete && (
                <button
                  className={`grid size-9.5 cursor-pointer place-items-center rounded-[11px] border border-[#ecd4d1] bg-white text-[#b4544e] hover:bg-[#fbf1f0] ${focusRing}`}
                  type="button"
                  aria-label="Delete discussion"
                  title="Delete discussion"
                  onClick={onDelete}
                >
                  <Trash2
                    className="size-[18px]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                </button>
              )}
              <button
                className={`grid size-9.5 cursor-pointer place-items-center rounded-[11px] border border-[#e1e6ec] bg-white text-[#6f7d8e] hover:border-[#c7d2df] hover:bg-[#f6f8fc] hover:text-[#40516a] ${focusRing}`}
                type="button"
                aria-label={
                  isExtractionRequest
                    ? 'Close extraction request'
                    : 'Minimize discussion'
                }
                title={
                  isExtractionRequest
                    ? 'Close extraction request'
                    : 'Minimize discussion'
                }
                onClick={onMinimize}
              >
                {isExtractionRequest ? (
                  <X
                    className="size-[19px]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                ) : (
                  <Minus
                    className="size-[19px]"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                )}
              </button>
            </div>
          </div>
          {contextSlot && (
            <div className="min-w-0 border-t border-[#f1f3f6] py-2.5">
              {contextSlot}
            </div>
          )}
          </header>

          <div
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-4.75 py-6 sm:px-7.25 ${
              isExtractionRequest ? 'bg-white' : 'bg-[#fbfcfd]'
            }`}
          >
            {messagesSlot ?? (
              <div className="m-auto max-w-[456px] py-9.5 text-center">
                <span className="mx-auto mb-4.5 grid size-13.75 place-items-center rounded-[16px] bg-[#eef2fa] text-[#3f63a8]">
                  <MessageSquare
                    className="size-6.25"
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                </span>
                <p className="text-[19px] font-semibold text-[#1e2733]">
                  Ask one focused question
                </p>
                <p className="mt-1.75 text-[15px] leading-[1.55] text-[#8b97a6]">
                  Answers stay short by default. When something&apos;s worth
                  keeping, extract it as a bubble — the thread stays as
                  reasoning history.
                </p>
              </div>
            )}
          </div>

          {composerSlot ??
            (isDraft && (
              <form
                className="shrink-0 border-t border-[#eef1f5] bg-white p-4.25 sm:p-4.75"
                onSubmit={submitDraft}
              >
                <label className="sr-only" htmlFor={composerId}>
                  Discussion prompt
                </label>
                <div className="flex items-end gap-2.5 rounded-xl border border-[#d7dee7] bg-white p-2.5 shadow-[0_1px_2px_rgba(30,39,51,0.04)] focus-within:border-[#3f63a8] focus-within:ring-3 focus-within:ring-[#3f63a8]/10">
                  <textarea
                    className="max-h-48 min-h-[50px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-[15.5px] leading-[1.5] text-[#1e2733] outline-none placeholder:text-[#a7b1be]"
                    id={composerId}
                    name="prompt"
                    placeholder="What do you want to understand?"
                    ref={draftInputRef}
                    rows={1}
                    value={visibleDiscussion.prompt}
                    onChange={(event) =>
                      onDraftPromptChange(event.target.value)
                    }
                  />
                  <button
                    className={`grid size-10.75 shrink-0 place-items-center rounded-[11px] bg-[#3f63a8] text-white shadow-[0_5px_12px_-7px_rgba(63,99,168,0.8)] hover:bg-[#33538f] disabled:cursor-not-allowed disabled:bg-[#c6cfda] disabled:shadow-none ${focusRing}`}
                    type="submit"
                    aria-label="Continue discussion"
                    disabled={
                      normalizedPrompt.length === 0 ||
                      onDraftSubmit === undefined
                    }
                    title="Continue"
                  >
                    <ArrowUp
                      className="size-[19px]"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </form>
            ))}
        </div>
        {inspectorSlot}
      </div>
    </div>
  );
}
